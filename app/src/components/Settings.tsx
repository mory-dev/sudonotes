import { useEffect, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { openUrl } from "@tauri-apps/plugin-opener";
import { siGithub } from "simple-icons";

import { api, type BackupSettings, type DeviceCode, type GithubSettings } from "../api";
import { useStore } from "../store";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const DEFAULT_KEEP = 12;
const DEFAULT_INTERVAL_MINUTES = 60;

/** Compressed snapshots of the vault, kept outside it.
 *
 *  The whole point is surviving the vault folder being lost, so the archives go
 *  to the app's data directory. Nothing here writes into the vault. */
function BackupSection() {
  const setError = useStore((s) => s.setError);
  const setNotice = useStore((s) => s.setNotice);
  const hasVault = useStore((s) => !!s.vaultPath);
  const vaultPath = useStore((s) => s.vaultPath);
  const setSettings = useStore((s) => s.setSettings);
  const requestConfirm = useStore((s) => s.requestConfirm);
  const openVault = useStore((s) => s.openVault);

  const [state, setState] = useState<BackupSettings | null>(null);
  const [busy, setBusy] = useState(false);
  // Drafts of the retention settings, committed on blur/Enter so typing "100"
  // does not fire an API call per keystroke.
  const [keep, setKeep] = useState(DEFAULT_KEEP);
  const [intervalMinutes, setIntervalMinutes] = useState(DEFAULT_INTERVAL_MINUTES);

  useEffect(() => {
    api
      .backupState()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  useEffect(() => {
    if (!state) return;
    setKeep(state.keep);
    setIntervalMinutes(state.intervalMinutes);
  }, [state]);

  const toggle = async (enabled: boolean) => {
    try {
      setState(await api.setBackupEnabled(enabled));
    } catch (e) {
      setError(String(e));
    }
  };

  const saveRetention = async () => {
    if (!state) return;
    const keepValue = Number.isFinite(keep) ? keep : state.keep;
    const intervalValue = Number.isFinite(intervalMinutes) ? intervalMinutes : state.intervalMinutes;
    if (keepValue === state.keep && intervalValue === state.intervalMinutes) return;
    try {
      setState(await api.setBackupRetention(keepValue, intervalValue));
    } catch (e) {
      setError(String(e));
    }
  };

  /** Pick a `.bak`, pick a destination, confirm the overwrite, unpack.
   *
   *  Restoring is destructive: notes already in the destination are replaced.
   *  So the choice is confirmed first, and the destination's current notes are
   *  snapshotted into the backup directory before anything is overwritten. When
   *  a vault is already open, it is the destination — no folder picker. The
   *  caller decides afterwards whether to open the result. */
  const restore = async () => {
    // Start in the configured backups folder, since that is where the archives
    // the user is about to pick are written.
    const archive = await open({
      title: "Choose a backup",
      multiple: false,
      defaultPath: state?.directory,
      filters: [{ name: "sudonotes backup", extensions: ["bak", "zip"] }],
    });
    if (typeof archive !== "string") return;

    let destination = vaultPath;
    if (!destination) {
      const picked = await open({
        directory: true,
        title: "Choose where to restore the vault",
      });
      if (typeof picked !== "string") return;
      destination = picked;
    }

    setSettings(false);
    requestConfirm(
      `Restore the backup over ${destination}? Notes already in that folder will be replaced — its current contents are saved as a backup first.`,
      async () => {
        setBusy(true);
        try {
          const count = await api.restoreBackup(archive, destination);
          setSettings(false);
          // Reloading a vault that was just overwritten makes the app reflect
          // the restored notes; reopening a fresh folder offers to make it vault.
          const alreadyOpen = destination === vaultPath;
          requestConfirm(
            alreadyOpen
              ? `Restored ${count} notes over the open vault. Reload it now?`
              : `Restored ${count} notes into ${destination}. Open it as your vault?`,
            () => void openVault(destination),
            alreadyOpen ? "Reload" : "Open it",
          );
        } catch (e) {
          setError(String(e));
        } finally {
          setBusy(false);
        }
      },
      "Restore over it",
    );
  };

  const runNow = async () => {
    setBusy(true);
    try {
      const info = await api.backupNow();
      setNotice(`Backed up ${info.notes} notes (${formatBytes(info.bytes)}).`);
      setState(await api.backupState());
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;

  return (
    <section className="settings-section">
      <h3>Backups</h3>
      <label className="ai-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span>Snapshot this vault automatically</span>
      </label>
      <p className="ai-tip">
        A compressed <code>.bak</code> of every note, written to the app's own folder — outside
        the vault, so losing the vault does not lose these. It is a ZIP: rename it to{" "}
        <code>.zip</code> to open it. The interval and keep-count below apply to automatic runs;
        the oldest archives are deleted once the keep-count is reached.
      </p>

      <dl className="settings-meta">
        <div className="meta-row">
          <dt>Keep</dt>
          <dd className="backup-number">
            <input
              type="number"
              min={1}
              max={100}
              value={keep}
              disabled={busy}
              onChange={(event) => setKeep(Number(event.target.value))}
              onBlur={() => void saveRetention()}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
            />
            <span>backups</span>
          </dd>
        </div>
        <div className="meta-row">
          <dt>Every</dt>
          <dd className="backup-number">
            <input
              type="number"
              min={5}
              max={10080}
              step={5}
              value={intervalMinutes}
              disabled={busy}
              onChange={(event) => setIntervalMinutes(Number(event.target.value))}
              onBlur={() => void saveRetention()}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
            />
            <span>minutes</span>
          </dd>
        </div>
        <div className="meta-row">
          <dt>Last</dt>
          <dd>
            {state.last
              ? `${formatWhen(state.last.created)} · ${formatBytes(state.last.bytes)}`
              : "None yet"}
          </dd>
        </div>
        <div className="meta-row">
          <dt>Folder</dt>
          <dd>
            <span className="meta-path" data-tooltip={state.directory}>
              {state.directory}
            </span>
          </dd>
        </div>
      </dl>

      <div className="settings-actions">
        <button className="ai-analyze" onClick={() => void runNow()} disabled={busy || !hasVault}>
          {busy ? "Backing up…" : "Back up now"}
        </button>
        <button className="ai-analyze" onClick={() => void restore()} disabled={busy}>
          Restore a backup…
        </button>
      </div>
    </section>
  );
}

/** Connecting the app to GitHub, so bubbles can become issues.
 *
 *  Sign-in is the OAuth device flow: GitHub hands out a short code, the user
 *  approves it in a browser, and the resulting token goes to the OS keychain.
 *  Which repositories are reachable is decided on GitHub when installing the
 *  sudonotes App, not here. */
function GithubSection() {
  const setError = useStore((s) => s.setError);
  const setNotice = useStore((s) => s.setNotice);
  // Shared, not local: the bubble menu decides what to offer from the same state.
  const auth = useStore((s) => s.githubAuth);
  const setAuth = useStore((s) => s.setGithubAuth);
  const loadAuth = useStore((s) => s.loadGithubAuth);

  const [code, setCode] = useState<DeviceCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<GithubSettings | null>(null);

  useEffect(() => {
    void loadAuth();
    api
      .getGithubSettings()
      .then(setPrefs)
      .catch(() => setPrefs(null));
  }, [loadAuth]);

  const setAutoDelete = async (enabled: boolean) => {
    try {
      setPrefs(await api.setGithubAutoDelete(enabled));
    } catch (e) {
      setError(String(e));
    }
  };


  const connect = async () => {
    setBusy(true);
    try {
      const device = await api.githubDeviceCode();
      setCode(device);
      // The code is pre-copied because it has to be typed into a page that is
      // about to take focus.
      await navigator.clipboard.writeText(device.userCode).catch(() => {});
      await openUrl(device.verificationUri);
      // Resolves only once the user approves, denies, or the code expires.
      const next = await api.githubAwaitLogin();
      setAuth(next);

      // Signing in grants nothing by itself. An account with no installation
      // anywhere cannot file an issue on any repository, so carry straight on
      // to picking them rather than letting the next attempt fail with a 403.
      if (next.connected && !(await api.githubHasInstallation().catch(() => true))) {
        setNotice("Now choose which repositories sudonotes may open issues on.");
        await openUrl(await api.githubInstallUrl());
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setCode(null);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    try {
      setAuth(await api.githubLogout());
    } catch (e) {
      setError(String(e));
    }
  };

  if (!auth) return null;

  return (
    <section className="settings-section">
      <h3 className="settings-heading-mark">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={siGithub.path} />
        </svg>
        GitHub
      </h3>

      {auth.error ? (
        <p className="ai-tip">
          GitHub sign-in is unavailable on this machine: {auth.error} sudonotes stores its GitHub
          token in the operating system&apos;s credential store, and cannot reach one here.
          Everything else works as normal.
        </p>
      ) : auth.connected ? (
        <>
          <dl className="settings-meta">
            <div className="meta-row">
              <dt>Account</dt>
              <dd>{auth.login ? `@${auth.login}` : "Connected"}</dd>
            </div>
          </dl>
          <p className="ai-tip">
            Issues are created by your own account. Signing in does not by itself grant access to
            any repository — that is chosen separately, per account, with the button below. Linked
            issues refresh themselves whenever you come back to the app.
          </p>
          {prefs && (
            <>
              <label className="ai-toggle">
                <input
                  type="checkbox"
                  checked={prefs.autoDeleteClosed}
                  onChange={(event) => void setAutoDelete(event.target.checked)}
                />
                <span>Delete a bubble when its issue closes</span>
              </label>
              <p className="ai-tip">
                Off by default, because it removes text you wrote. A closed issue always mutes its
                bubble; this deletes it as well. Undo is offered on the toast that follows, for as
                long as the app stays open.
              </p>
            </>
          )}

          <div className="settings-actions">
            <button
              className="ai-analyze"
              onClick={() => void api.githubInstallUrl().then((url) => openUrl(url))}
            >
              Choose repositories…
            </button>
            <button className="ai-analyze" onClick={() => void disconnect()} disabled={busy}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="ai-tip">
            Connect an account to turn idea bubbles into GitHub issues and see when those issues
            close. The token is kept in your operating system&apos;s credential store.
          </p>
          {code ? (
            <dl className="settings-meta">
              <div className="meta-row">
                <dt>Code</dt>
                <dd>
                  <strong className="github-code">{code.userCode}</strong> — copied, and waiting for
                  you to approve it on GitHub.
                </dd>
              </div>
            </dl>
          ) : null}
          <div className="settings-actions">
            <button className="ai-analyze" onClick={() => void connect()} disabled={busy}>
              {busy ? "Waiting for GitHub…" : "Connect GitHub"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Application settings, opened from the status bar's cog.
 *
 *  The AI switch used to be a permanent section of the right panel, where it
 *  spent a lot of vertical space on a preference that is set once per vault. */
function UpdateSection() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<
    "idle" | "checking" | "available" | "downloading" | "installing" | "current" | "error"
  >("idle");
  const [progress, setProgress] = useState(0);

  const checkForUpdates = async () => {
    setStatus("checking");
    setUpdate(null);
    try {
      const found = await check();
      if (found) {
        setUpdate(found);
        setStatus("available");
      } else {
        setStatus("current");
      }
    } catch (e) {
      console.error("Could not check for updates", e);
      setStatus("error");
    }
  };

  const install = async () => {
    if (!update) return;
    setStatus("downloading");
    setProgress(0);
    let total = 0;
    let received = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total > 0) {
            setProgress(Math.min(100, Math.round((received / total) * 100)));
          }
        } else if (event.event === "Finished") {
          setStatus("installing");
        }
      });
      setStatus("installing");
      await relaunch();
    } catch (e) {
      console.error("Could not install the update", e);
      setStatus("error");
    }
  };

  const busy = status === "checking" || status === "downloading" || status === "installing";

  return (
    <section className="settings-section">
      <h3>Updates</h3>
      {status === "error" ? (
        <p className="ai-tip">Couldn't check for updates right now. Please try again later.</p>
      ) : status === "available" && update ? (
        <p className="ai-tip">
          <strong>{update.version}</strong> is available — update sudonotes.
        </p>
      ) : status === "current" ? (
        <p className="ai-tip">sudonotes is up to date.</p>
      ) : null}
      <div className="settings-actions">
        <button
          className="ai-analyze"
          onClick={() => void (status === "available" && update ? install() : checkForUpdates())}
          disabled={busy}
        >
          {status === "checking"
            ? "Checking…"
            : status === "downloading"
            ? `Downloading… ${progress > 0 ? `${progress}%` : ""}`
            : status === "installing"
            ? "Applying update…"
            : status === "available"
            ? "Download and install"
            : "Check for updates"}
        </button>
      </div>
    </section>
  );
}

export function Settings() {
  const open = useStore((s) => s.settingsOpen);
  const setSettings = useStore((s) => s.setSettings);
  const settings = useStore((s) => s.aiSettings);
  const save = useStore((s) => s.saveAiSettings);
  const saveBubbleMetadataVisible = useStore((s) => s.saveBubbleMetadataVisible);

  const [version, setVersion] = useState("");

  useEffect(() => {
    if (!open) return;
    api
      .appVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setSettings]);

  if (!open) return null;

  return (
    <div className="confirm-layer" onMouseDown={() => setSettings(false)}>
      <div
        className="settings"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="settings-head">
          <h2>Settings</h2>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={() => setSettings(false)}
          >
            ×
          </button>
        </header>

        <section className="settings-section">
          <h3>AI assistance</h3>
          <label className="ai-toggle">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(event) => void save(event.target.checked)}
            />
            <span>Enable prompt refinements &amp; tagging</span>
          </label>
          <p className="ai-tip">
            While this is on, the text of a note is sent to the sudonotes service to be tagged
            and reviewed. It is not stored or logged there. The setting belongs to this vault, and
            with it off, tagging falls back to a local keyword pass.
          </p>
        </section>

        <section className="settings-section">
          <h3>Editor</h3>
          <label className="ai-toggle">
            <input
              type="checkbox"
              checked={settings.showBubbleMetadata}
              onChange={(event) => void saveBubbleMetadataVisible(event.target.checked)}
            />
            <span>Show metadata below idea bubbles</span>
          </label>
          <p className="ai-tip">
            Displays each bubble&apos;s tags and assigned model in a quiet footer. This is on by
            default and can be hidden without removing the metadata.
          </p>
        </section>

        <GithubSection />

        <BackupSection />

        <UpdateSection />

        <section className="settings-section">
          <h3>About</h3>
          <dl className="settings-meta">
            <div className="meta-row">
              <dt>Version</dt>
              <dd>{version ? `sudonotes ${version}` : "sudonotes"}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
