import { useCallback, useEffect, useState } from "react";

import { openUrl } from "@tauri-apps/plugin-opener";

import { api, type IssueDraft as Draft } from "../api";
import { useStore } from "../store";

/** Review a drafted GitHub issue before filing it.
 *
 *  The draft always arrives with the bubble's own words in it — the model may
 *  add a title and a line of context, but the backend puts the original text
 *  back if it was paraphrased. Editing here is the last word either way. */
export function IssueDraftDialog() {
  const request = useStore((s) => s.issueDraft);
  const close = useStore((s) => s.closeIssueDraft);
  const active = useStore((s) => s.active);
  const setError = useStore((s) => s.setError);
  const setNoticeAction = useStore((s) => s.setNoticeAction);
  const noteBubbleIssue = useStore((s) => s.noteBubbleIssue);
  const refresh = useStore((s) => s.refresh);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  /** null while unknown, false when the App is not installed on this repo. */
  const [access, setAccess] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const remote = active?.remote ?? null;
  const owner = remote?.owner ?? null;
  const repo = remote?.repo ?? null;

  /** Authorising the App and installing it on a repository are separate acts on
   *  GitHub. Asking first turns a 403 after writing an issue into a prompt
   *  before writing one. */
  const checkAccess = useCallback(async () => {
    if (!owner || !repo) return;
    setChecking(true);
    try {
      setAccess(await api.githubRepoAccess(owner, repo));
    } catch {
      // Offline or the check itself was refused. Let the attempt decide rather
      // than blocking on a check that may be wrong.
      setAccess(true);
    } finally {
      setChecking(false);
    }
  }, [owner, repo]);

  useEffect(() => {
    if (!request) {
      setDraft(null);
      setFailed(false);
      setAccess(null);
      return;
    }
    let cancelled = false;
    setDraft(null);
    setFailed(false);
    setAccess(null);
    void checkAccess();
    // Drafting runs alongside the access check: it is the slower of the two,
    // and the text is worth having ready the moment access is granted.
    api
      .draftBubbleIssue(request.noteId, request.label)
      .then((result) => !cancelled && setDraft(result))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [request, checkAccess]);

  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, close]);

  // Granting access happens in a browser, so the app finds out by watching
  // rather than by being told. Coming back to the window is the strong signal —
  // the slow interval is only there for a second monitor, where the app never
  // lost focus in the first place.
  useEffect(() => {
    if (access !== false) return;
    const onFocus = () => void checkAccess();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(onFocus, 5000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [access, checkAccess]);

  if (!request) return null;

  const create = async () => {
    if (!draft || !draft.title.trim()) return;
    setBusy(true);
    try {
      const issue = await api.createBubbleIssue(
        request.noteId,
        request.label,
        draft.title.trim(),
        draft.body,
      );
      noteBubbleIssue(request.label, issue);
      close();
      // Offered rather than opened: filing an issue does not mean the user
      // wants to leave the app, but it is the one thing they might want next.
      setNoticeAction(`Created ${issue.key}`, "Open", () => void openUrl(issue.url));
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="confirm-layer" onMouseDown={() => close()}>
      <div
        className="settings issue-draft"
        role="dialog"
        aria-modal="true"
        aria-label="Create a GitHub issue"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-head">
          <h2>New issue</h2>
          <button className="icon-button" aria-label="Cancel" onClick={() => close()}>
            ×
          </button>
        </header>

        <section className="settings-section">
          {remote ? (
            <p className="ai-tip">
              Filed on{" "}
              <a
                href={`https://github.com/${remote.owner}/${remote.repo}`}
                onClick={(event) => {
                  event.preventDefault();
                  void openUrl(`https://github.com/${remote.owner}/${remote.repo}`);
                }}
              >
                {remote.owner}/{remote.repo}
              </a>{" "}
              as you.
            </p>
          ) : (
            <p className="ai-tip">This idea is not linked to a GitHub project.</p>
          )}

          {access === false ? (
            <>
              <p className="ai-tip">
                You are signed in, but sudonotes has not been given access to{" "}
                <strong>
                  {owner}/{repo}
                </strong>{" "}
                yet. Granting access is a separate step on GitHub, and you choose there exactly
                which repositories it covers.
              </p>
              <div className="settings-actions">
                <button
                  className="ai-analyze"
                  onClick={() => {
                    // Passing the owner is what keeps a repo under a second
                    // account from opening the first account's settings.
                    void api
                      .githubInstallUrl(owner ?? undefined)
                      .then((url) => openUrl(url));
                  }}
                >
                  Grant access on {owner}…
                </button>
                <span className="ai-tip">
                  {checking ? "Checking…" : "Waiting — this continues on its own once you have."}
                </span>
              </div>
            </>
          ) : failed ? (
            <p className="ai-tip">Could not read that bubble. Close this and try again.</p>
          ) : !draft ? (
            <p className="ai-tip">Drafting…</p>
          ) : (
            <>
              <label className="issue-field">
                <span>Title</span>
                <input
                  type="text"
                  value={draft.title}
                  disabled={busy}
                  autoFocus
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </label>
              <label className="issue-field">
                <span>Body</span>
                <textarea
                  rows={14}
                  value={draft.body}
                  disabled={busy}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                />
              </label>
            </>
          )}

          <div className="settings-actions">
            {access !== false && (
              <button
                className="ai-analyze"
                onClick={() => void create()}
                disabled={busy || !draft || !draft.title.trim() || !remote}
              >
                {busy ? "Creating…" : "Create issue"}
              </button>
            )}
            <button className="ai-analyze" onClick={() => close()} disabled={busy}>
              Cancel
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
