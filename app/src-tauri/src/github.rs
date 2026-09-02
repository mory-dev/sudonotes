//! GitHub: device-flow sign-in, issue creation, and issue status.
//!
//! Unlike the AI features, which are proxied through a server that holds the
//! provider key, this talks to GitHub directly as the signed-in user — so it is
//! the one place the app holds a real credential. That credential goes to the
//! OS keychain, never to a file in the vault or the config directory.
//!
//! Authentication is the OAuth device flow against the sudonotes GitHub App.
//! Device flow needs only the (public) client id, so there is no client secret
//! to ship and no server component: issues are created by the user's own
//! account, on the repositories they chose when installing the App.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::project::GithubRemote;

/// The sudonotes GitHub App's client id. Public by design — device flow has no
/// client secret — but it is per-App, so a fork needs its own. Overridable via
/// the environment for development against a test App, mirroring
/// `SUDONOTES_API_BASE` in `ai.rs`.
const CLIENT_ID: &str = "Iv23lirq6DLgB1bS3LeS";

/// The App's slug, as it appears in `github.com/apps/<slug>`. Needed to send a
/// user somewhere they can grant access to a repository — signing in and
/// installing are separate acts on GitHub, and only the second one can be
/// granted per-repository.
const APP_SLUG: &str = "sudonotes-agent";

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const API_BASE: &str = "https://api.github.com";
const API_VERSION: &str = "2022-11-28";
const USER_AGENT: &str = concat!("sudonotes/", env!("CARGO_PKG_VERSION"));

const KEYCHAIN_SERVICE: &str = "sudonotes";
const KEYCHAIN_ACCOUNT: &str = "github";

/// Refresh this long before a token actually expires, so a call never races the
/// expiry it just checked.
const REFRESH_MARGIN: Duration = Duration::from_secs(120);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

type Result<T> = std::result::Result<T, String>;

fn client_id() -> Result<String> {
    let id = std::env::var("SUDONOTES_GITHUB_CLIENT_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| CLIENT_ID.to_string());
    if id.is_empty() {
        return Err("GitHub sign-in is not configured in this build".into());
    }
    Ok(id)
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// --- stored credential ------------------------------------------------------

/// What the keychain holds, as one JSON blob under a single entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Tokens {
    access_token: String,
    /// Absent when the App is configured to issue non-expiring tokens.
    #[serde(default)]
    refresh_token: Option<String>,
    /// Unix seconds. Absent means the token does not expire.
    #[serde(default)]
    expires_at: Option<u64>,
    /// Cached so the settings panel can show `@login` without a network call.
    #[serde(default)]
    login: Option<String>,
}

impl Tokens {
    fn stale(&self) -> bool {
        self.expires_at
            .is_some_and(|at| now() + REFRESH_MARGIN.as_secs() >= at)
    }
}

fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("no usable credential store: {e}"))
}

/// The stored credential, or `None` when signed out.
///
/// An unusable keychain reads as signed out here; `keychain_error` is what
/// tells those two apart for the UI.
fn load() -> Option<Tokens> {
    let raw = entry().ok()?.get_password().ok()?;
    serde_json::from_str(&raw).ok()
}

fn store(tokens: &Tokens) -> Result<()> {
    let raw = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&raw)
        .map_err(|e| format!("could not save the GitHub sign-in: {e}"))
}

fn clear() {
    if let Ok(entry) = entry() {
        let _ = entry.delete_credential();
    }
}

/// Why the credential store cannot be used, when it cannot.
///
/// On Linux this is the Secret Service over D-Bus, which a confined package or
/// a headless session may not be able to reach. A broken keychain disables the
/// GitHub features and nothing else — it must never stop a vault from opening.
fn keychain_error() -> Option<String> {
    match entry() {
        Err(e) => Some(e),
        Ok(entry) => match entry.get_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => None,
            Err(e) => Some(format!("the credential store is unavailable: {e}")),
        },
    }
}

// --- per-vault preferences --------------------------------------------------

/// Per-vault, like the AI settings: one vault may retire closed ideas while
/// another keeps them. The sign-in itself is per-install and lives in the
/// keychain, not here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSettings {
    /// Remove a bubble once its issue closes.
    ///
    /// Off by default, and deliberately so: it deletes text the user wrote, and
    /// nothing else in the app does that without asking.
    #[serde(default)]
    pub auto_delete_closed: bool,
}

const SETTINGS_FILE: &str = "github.json";

fn settings_path(root: &std::path::Path) -> std::path::PathBuf {
    root.join(crate::vault::INDEX_DIR).join(SETTINGS_FILE)
}

/// A vault's preferences. Missing or unreadable means defaults, never an error.
pub fn settings(root: &std::path::Path) -> GithubSettings {
    std::fs::read_to_string(settings_path(root))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(GithubSettings {
            auto_delete_closed: false,
        })
}

pub fn save_settings(root: &std::path::Path, auto_delete_closed: bool) -> Result<GithubSettings> {
    let next = GithubSettings { auto_delete_closed };
    let path = settings_path(root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())?;
    Ok(next)
}

// --- what the frontend sees -------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubAuth {
    pub connected: bool,
    pub login: Option<String>,
    /// Set when signing in is impossible on this machine, so the settings panel
    /// can explain why rather than failing on click.
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueRef {
    /// `owner/repo#123` — the durable key stored in note frontmatter.
    pub key: String,
    pub number: u64,
    pub state: String,
    pub title: String,
    pub url: String,
}

/// The key a bubble stores for an issue.
pub fn issue_key(remote: &GithubRemote, number: u64) -> String {
    format!("{}#{number}", remote.slug())
}

/// Split `owner/repo#123` back into its parts.
pub fn parse_issue_key(key: &str) -> Option<(GithubRemote, u64)> {
    let (slug, number) = key.rsplit_once('#')?;
    let (owner, repo) = slug.split_once('/')?;
    if owner.is_empty() || repo.is_empty() || repo.contains('/') {
        return None;
    }
    Some((
        GithubRemote {
            owner: owner.to_string(),
            repo: repo.to_string(),
        },
        number.parse().ok()?,
    ))
}

pub fn auth() -> GithubAuth {
    match load() {
        Some(tokens) => GithubAuth {
            connected: true,
            login: tokens.login,
            error: None,
        },
        None => GithubAuth {
            connected: false,
            login: None,
            error: keychain_error(),
        },
    }
}

pub fn sign_out() {
    clear();
}

// --- device flow ------------------------------------------------------------

struct Pending {
    device_code: String,
    interval: u64,
    /// Unix seconds after which GitHub will reject the device code.
    expires_at: u64,
}

static PENDING: OnceLock<Mutex<Option<Pending>>> = OnceLock::new();

fn pending() -> &'static Mutex<Option<Pending>> {
    PENDING.get_or_init(|| Mutex::new(None))
}

/// Ask GitHub for a device code. The caller shows `user_code` and opens
/// `verification_uri`; `finish_login` then waits for the user to approve.
pub async fn begin_login() -> Result<DeviceCode> {
    let response: Value = reqwest::Client::new()
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .json(&json!({ "client_id": client_id()? }))
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("could not reach GitHub: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub refused the sign-in request: {e}"))?
        .json()
        .await
        .map_err(|e| format!("unexpected reply from GitHub: {e}"))?;

    let field = |name: &str| {
        response
            .get(name)
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| format!("GitHub omitted {name}"))
    };
    let expires_in = response
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(900);
    let code = DeviceCode {
        user_code: field("user_code")?,
        verification_uri: field("verification_uri")?,
        expires_in,
    };

    *pending().lock().map_err(|e| e.to_string())? = Some(Pending {
        device_code: field("device_code")?,
        // GitHub rejects polling faster than `interval`, and says so by
        // answering `slow_down` rather than by failing.
        interval: response.get("interval").and_then(Value::as_u64).unwrap_or(5),
        expires_at: now() + expires_in,
    });

    Ok(code)
}

/// Poll until the user approves the device code, then store the token.
///
/// Resolves only on a terminal outcome: approval, denial, or expiry.
pub async fn finish_login() -> Result<GithubAuth> {
    let (device_code, mut interval, expires_at) = {
        let guard = pending().lock().map_err(|e| e.to_string())?;
        let waiting = guard.as_ref().ok_or("no sign-in is in progress")?;
        (
            waiting.device_code.clone(),
            waiting.interval,
            waiting.expires_at,
        )
    };
    let id = client_id()?;

    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if now() >= expires_at {
            *pending().lock().map_err(|e| e.to_string())? = None;
            return Err("the sign-in code expired — start again".into());
        }

        let response: Value = reqwest::Client::new()
            .post(TOKEN_URL)
            .header("Accept", "application/json")
            .header("User-Agent", USER_AGENT)
            .json(&json!({
                "client_id": id,
                "device_code": device_code,
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            }))
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| format!("could not reach GitHub: {e}"))?
            .json()
            .await
            .map_err(|e| format!("unexpected reply from GitHub: {e}"))?;

        // Device flow reports progress through a 200 with an `error` field, so
        // the pending states have to be read out of the body, not the status.
        match response.get("error").and_then(Value::as_str) {
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                interval = response
                    .get("interval")
                    .and_then(Value::as_u64)
                    .unwrap_or(interval + 5);
                continue;
            }
            Some("expired_token") => {
                *pending().lock().map_err(|e| e.to_string())? = None;
                return Err("the sign-in code expired — start again".into());
            }
            Some("access_denied") => {
                *pending().lock().map_err(|e| e.to_string())? = None;
                return Err("sign-in was cancelled on GitHub".into());
            }
            Some(other) => return Err(format!("GitHub rejected the sign-in: {other}")),
            None => {}
        }

        let access_token = response
            .get("access_token")
            .and_then(Value::as_str)
            .ok_or("GitHub returned no access token")?
            .to_string();
        let mut tokens = Tokens {
            access_token,
            refresh_token: response
                .get("refresh_token")
                .and_then(Value::as_str)
                .map(str::to_string),
            expires_at: response
                .get("expires_in")
                .and_then(Value::as_u64)
                .map(|seconds| now() + seconds),
            login: None,
        };
        tokens.login = whoami(&tokens.access_token).await;
        store(&tokens)?;
        *pending().lock().map_err(|e| e.to_string())? = None;

        return Ok(GithubAuth {
            connected: true,
            login: tokens.login,
            error: None,
        });
    }
}

/// The signed-in account's handle. Best effort: a failure here costs a label in
/// the settings panel, not the sign-in.
async fn whoami(access_token: &str) -> Option<String> {
    reqwest::Client::new()
        .get(format!("{API_BASE}/user"))
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
        .header("User-Agent", USER_AGENT)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .ok()?
        .json::<Value>()
        .await
        .ok()?
        .get("login")
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// Trade the refresh token for a fresh access token.
///
/// A refresh that fails is terminal: the stored credential is dropped so the
/// user is told to reconnect rather than seeing every action fail.
async fn refresh(tokens: &Tokens) -> Result<Tokens> {
    let Some(refresh_token) = tokens.refresh_token.clone() else {
        clear();
        return Err("the GitHub sign-in expired — reconnect in Settings".into());
    };

    let response: Value = reqwest::Client::new()
        .post(TOKEN_URL)
        .header("Accept", "application/json")
        .header("User-Agent", USER_AGENT)
        .json(&json!({
            "client_id": client_id()?,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("could not reach GitHub: {e}"))?
        .json()
        .await
        .map_err(|e| format!("unexpected reply from GitHub: {e}"))?;

    let Some(access_token) = response.get("access_token").and_then(Value::as_str) else {
        clear();
        return Err("the GitHub sign-in expired — reconnect in Settings".into());
    };

    let next = Tokens {
        access_token: access_token.to_string(),
        refresh_token: response
            .get("refresh_token")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(Some(refresh_token)),
        expires_at: response
            .get("expires_in")
            .and_then(Value::as_u64)
            .map(|seconds| now() + seconds),
        login: tokens.login.clone(),
    };
    store(&next)?;
    Ok(next)
}

// --- authenticated API calls ------------------------------------------------

/// A usable access token, refreshed first if it is at or near expiry.
async fn access_token() -> Result<String> {
    let tokens = load().ok_or("connect GitHub in Settings first")?;
    if tokens.stale() {
        return Ok(refresh(&tokens).await?.access_token);
    }
    Ok(tokens.access_token)
}

/// One authenticated GitHub API call, retried once against a refreshed token if
/// GitHub rejects the first attempt.
async fn call(method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value> {
    let mut token = access_token().await?;

    for attempt in 0..2 {
        let mut request = reqwest::Client::new()
            .request(method.clone(), format!("{API_BASE}{path}"))
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", API_VERSION)
            .header("User-Agent", USER_AGENT)
            .timeout(REQUEST_TIMEOUT);
        if let Some(ref payload) = body {
            request = request.json(payload);
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("could not reach GitHub: {e}"))?;

        if response.status() == reqwest::StatusCode::UNAUTHORIZED && attempt == 0 {
            let tokens = load().ok_or("the GitHub sign-in expired — reconnect in Settings")?;
            token = refresh(&tokens).await?.access_token;
            continue;
        }

        let status = response.status();
        let payload: Value = response.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            // GitHub explains refusals in the body; the status alone would turn
            // "you did not grant Issues access" into a bare 403.
            let detail = payload
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("no details");
            return Err(match status {
                // Naming the repository matters: the usual cause is that the
                // App is installed somewhere other than the repo `origin`
                // actually points at, and without it the message sends people
                // to check the repository they had in mind rather than the one
                // that was tried.
                reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::FORBIDDEN => format!(
                    "GitHub refused access to {} ({status}: {detail}). Check that the sudonotes App \
                     is installed on that exact repository, that its Issues permission is \
                     read & write, and — if you changed permissions after installing — that the \
                     update has been approved under Settings → Applications on GitHub.",
                    repo_of(path).unwrap_or_else(|| path.to_string())
                ),
                _ => format!("GitHub returned {status}: {detail}"),
            });
        }
        return Ok(payload);
    }

    Err("the GitHub sign-in expired — reconnect in Settings".into())
}

/// `owner/repo` out of an API path like `/repos/owner/repo/issues`, for error
/// messages that have to say which repository was refused.
fn repo_of(path: &str) -> Option<String> {
    let rest = path.strip_prefix("/repos/")?;
    let mut parts = rest.split('/');
    let owner = parts.next().filter(|part| !part.is_empty())?;
    let repo = parts.next().filter(|part| !part.is_empty())?;
    Some(format!("{owner}/{repo}"))
}

fn issue_from(remote: &GithubRemote, value: &Value) -> Option<IssueRef> {
    let number = value.get("number").and_then(Value::as_u64)?;
    Some(IssueRef {
        key: issue_key(remote, number),
        number,
        state: value
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("open")
            .to_string(),
        title: value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        url: value
            .get("html_url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
    })
}

/// Where to send someone to grant access to a repository.
///
/// Naming the account matters once the App is installed anywhere: a bare
/// `installations/new` is redirected by GitHub to whichever installation
/// already exists, so someone trying to add a repo under a *second* account
/// lands in the settings of the first one. `suggested_target_id` pins the page
/// to the account that actually owns the repository.
///
/// Falls back to the bare URL when the owner is unknown or cannot be looked up;
/// that is still the right page, just not preselected.
pub async fn install_url(owner: Option<&str>) -> String {
    let base = format!("https://github.com/apps/{APP_SLUG}/installations/new");
    let Some(owner) = owner.filter(|owner| !owner.is_empty()) else {
        return base;
    };
    match account_id(owner).await {
        Some(id) => format!("{base}/permissions?suggested_target_id={id}"),
        None => base,
    }
}

/// A user or organization's numeric id. `/users/{name}` answers for both, and
/// the id is what the install page accepts as a target.
async fn account_id(owner: &str) -> Option<u64> {
    call(reqwest::Method::GET, &format!("/users/{owner}"), None)
        .await
        .ok()?
        .get("id")
        .and_then(Value::as_u64)
}

/// The App installations this user has granted, if any.
async fn installation_ids() -> Result<Vec<u64>> {
    let installations = call(reqwest::Method::GET, "/user/installations", None).await?;
    Ok(installations
        .get("installations")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_u64))
                .collect()
        })
        .unwrap_or_default())
}

/// Whether the user has installed the App anywhere at all.
///
/// Distinct from being signed in, and worth knowing straight after sign-in: an
/// account with no installation cannot file anything anywhere, so it is the one
/// moment where sending someone to GitHub unprompted is helpful rather than rude.
pub async fn has_any_installation() -> Result<bool> {
    Ok(!installation_ids().await?.is_empty())
}

/// Whether the signed-in user's installations actually cover this repository.
///
/// Being signed in says nothing about this: authorising the App and installing
/// it on a repository are separate steps, and the second is what grants access.
/// Checking up front turns a 403 at the end of writing an issue into a prompt
/// before it is written.
pub async fn has_repo_access(remote: &GithubRemote) -> Result<bool> {
    let wanted = remote.slug().to_ascii_lowercase();

    for id in installation_ids().await? {
        let mut page = 1;
        loop {
            let value = call(
                reqwest::Method::GET,
                &format!("/user/installations/{id}/repositories?per_page=100&page={page}"),
                None,
            )
            .await?;
            let repositories = value
                .get("repositories")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();

            if repositories.iter().any(|repo| {
                repo.get("full_name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.eq_ignore_ascii_case(&wanted))
            }) {
                return Ok(true);
            }

            // A short page is the last one; anything else risks looping forever
            // on an installation covering hundreds of repositories.
            if repositories.len() < 100 {
                break;
            }
            page += 1;
        }
    }

    Ok(false)
}

/// File an issue, carrying the bubble's tags across as real labels.
///
/// Labels that do not exist yet are created by GitHub. A repository can still
/// refuse them — some org setups restrict label creation — and losing the issue
/// over a label would be a poor trade, so a refusal is retried once without
/// them rather than surfaced.
pub async fn create_issue(
    remote: &GithubRemote,
    title: &str,
    body: &str,
    labels: &[String],
) -> Result<IssueRef> {
    let path = format!("/repos/{}/{}/issues", remote.owner, remote.repo);

    let mut created = None;
    if !labels.is_empty() {
        match call(
            reqwest::Method::POST,
            &path,
            Some(json!({ "title": title, "body": body, "labels": labels })),
        )
        .await
        {
            Ok(value) => created = Some(value),
            Err(error) => eprintln!("warning: filing with labels failed, retrying without: {error}"),
        }
    }

    let created = match created {
        Some(value) => value,
        None => {
            call(
                reqwest::Method::POST,
                &path,
                Some(json!({ "title": title, "body": body })),
            )
            .await?
        }
    };

    issue_from(remote, &created).ok_or_else(|| "GitHub did not return the new issue".to_string())
}

/// Current state of the given issue numbers in one repository.
///
/// One list call covers up to 100 issues; anything not in that page is fetched
/// individually, which keeps a vault tracking a handful of old issues from
/// costing a request each on every sync.
pub async fn fetch_issues(remote: &GithubRemote, numbers: &[u64]) -> Result<Vec<IssueRef>> {
    let listed = call(
        reqwest::Method::GET,
        &format!(
            "/repos/{}/{}/issues?state=all&per_page=100&sort=updated",
            remote.owner, remote.repo
        ),
        None,
    )
    .await?;

    let mut found: Vec<IssueRef> = listed
        .as_array()
        .map(|items| {
            items
                .iter()
                // Pull requests come back from the issues endpoint too, and a
                // bubble never links one.
                .filter(|item| item.get("pull_request").is_none())
                .filter_map(|item| issue_from(remote, item))
                .filter(|issue| numbers.contains(&issue.number))
                .collect()
        })
        .unwrap_or_default();

    for number in numbers {
        if found.iter().any(|issue| issue.number == *number) {
            continue;
        }
        // A single missing issue (deleted, transferred, or now out of scope)
        // must not fail the whole sync.
        if let Ok(value) = call(
            reqwest::Method::GET,
            &format!("/repos/{}/{}/issues/{number}", remote.owner, remote.repo),
            None,
        )
        .await
        {
            if let Some(issue) = issue_from(remote, &value) {
                found.push(issue);
            }
        }
    }

    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_an_issue_key() {
        let remote = GithubRemote {
            owner: "mory-dev".into(),
            repo: "sudonotes".into(),
        };
        let key = issue_key(&remote, 42);
        assert_eq!(key, "mory-dev/sudonotes#42");

        let (parsed, number) = parse_issue_key(&key).unwrap();
        assert_eq!(parsed, remote);
        assert_eq!(number, 42);
    }

    #[test]
    fn rejects_malformed_issue_keys() {
        for key in [
            "mory-dev/sudonotes",
            "sudonotes#42",
            "#42",
            "mory-dev/sudonotes#",
            "mory-dev/sudonotes#abc",
            "a/b/c#1",
            "/sudonotes#1",
        ] {
            assert!(parse_issue_key(key).is_none(), "accepted {key}");
        }
    }

    #[test]
    fn names_the_repository_an_api_path_targets() {
        assert_eq!(
            repo_of("/repos/mory-dev/sudonotes/issues"),
            Some("mory-dev/sudonotes".into())
        );
        assert_eq!(
            repo_of("/repos/mory-dev/sudonotes/issues?state=all&per_page=100"),
            Some("mory-dev/sudonotes".into())
        );
        assert_eq!(repo_of("/user"), None);
        assert_eq!(repo_of("/repos/mory-dev"), None);
    }

    #[test]
    fn reads_an_issue_out_of_an_api_payload() {
        let remote = GithubRemote {
            owner: "o".into(),
            repo: "r".into(),
        };
        let issue = issue_from(
            &remote,
            &json!({
                "number": 7,
                "state": "closed",
                "title": "Mute closed bubbles",
                "html_url": "https://github.com/o/r/issues/7"
            }),
        )
        .unwrap();

        assert_eq!(issue.key, "o/r#7");
        assert_eq!(issue.state, "closed");
        assert_eq!(issue.url, "https://github.com/o/r/issues/7");
        assert!(issue_from(&remote, &json!({ "state": "open" })).is_none());
    }
}
