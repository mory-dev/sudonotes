import { useEffect, useState } from "react";

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { ContextMenu } from "./components/ContextMenu";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Editor } from "./components/Editor";
import { IssueDraftDialog } from "./components/IssueDraft";
import { IdeaMark, PromptMark } from "./components/NoteMarks";
import { NotePicker } from "./components/NotePicker";
import { PromptCards } from "./components/PromptCards";
import { RightPanel } from "./components/RightPanel";
import { SearchPalette } from "./components/SearchPalette";
import { Settings } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { Splash } from "./components/Splash";
import { SplitPreview } from "./components/SplitPreview";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { TooltipLayer } from "./components/TooltipLayer";
import { UpdateBanner } from "./components/UpdateBanner";
import { Welcome } from "./components/Welcome";
import { WindowChrome } from "./components/WindowChrome";
import { api } from "./api";
import { flushPendingHistory } from "./historyStorage";
import { useStore } from "./store";

import "./App.css";

/** Keep the splash on screen long enough to read, even on a fast start. */
const MIN_SPLASH_MS = 900;

/** Toasts (errors and notices) retire themselves after this long. */
const TOAST_DISMISS_MS = 5000;

/** Longer, for a toast whose action is the only way to reverse something. */
const ACTION_TOAST_DISMISS_MS = 20000;

/** Backstop for refreshing linked GitHub issues when the window never loses
 *  focus — on a second monitor, say. Regaining focus is the real trigger. */
const ISSUE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Enough to coalesce a burst of alt-tabbing, short enough that coming back
 *  from closing an issue feels immediate. One request per repository, so even
 *  continuous switching stays far under the rate limit. */
const FOCUS_SYNC_THROTTLE_MS = 8 * 1000;

/** Browser chrome the webview still offers but a desktop note app has no use
 *  for: print, open-file, view-source, downloads, bookmark, find-next. Ctrl+P
 *  in particular was reaching the print dialog. The editor's own keymap sees
 *  these first, so suppressing here only cancels the webview's default. */
const SUPPRESSED_MOD_KEYS = new Set(["p", "o", "u", "j", "d", "g"]);

/** The friendly landing page shown when nothing is open yet. */
function EmptyState() {
  const create = useStore((s) => s.create);
  return (
    <div className="blank">
      <div className="blank-marks">
        <span className="blank-mark prompt" data-tooltip="Prompts">
          <PromptMark />
        </span>
        <span className="blank-mark idea" data-tooltip="Ideas">
          <IdeaMark />
        </span>
      </div>
      <h2>Prompts and ideas, in one place</h2>
      <p className="muted">
        Capture the prompts you keep rewriting and the ideas behind them — then refine and
        link them together.
      </p>
      <div className="blank-actions">
        <button className="primary blank-prompt" onClick={() => void create("prompt", "")}>
          <PromptMark />
          New prompt
        </button>
        <button className="primary blank-idea" onClick={() => void create("idea", "")}>
          <IdeaMark />
          New idea
        </button>
      </div>
      <p className="blank-hint">
        <kbd>Ctrl N</kbd> new note · <kbd>Ctrl K</kbd> search · <kbd>Ctrl Shift F</kbd> find in note
      </p>
    </div>
  );
}

export default function App() {
  const vaultPath = useStore((s) => s.vaultPath);
  const active = useStore((s) => s.active);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const notice = useStore((s) => s.notice);
  const noticeAction = useStore((s) => s.noticeAction);
  const setNotice = useStore((s) => s.setNotice);
  const loadAiSettings = useStore((s) => s.loadAiSettings);
  const loadGithubAuth = useStore((s) => s.loadGithubAuth);
  const restoreVault = useStore((s) => s.restoreVault);
  const hasChildren = useStore((s) => s.children.length > 0);

  const [booting, setBooting] = useState(true);

  useEffect(() => {
    void loadAiSettings();
    void loadGithubAuth();
  }, [loadAiSettings, loadGithubAuth]);

  useEffect(() => {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;

    void restoreVault().finally(() => {
      timer = setTimeout(
        () => setBooting(false),
        Math.max(0, MIN_SPLASH_MS - (Date.now() - startedAt)),
      );
    });

    return () => clearTimeout(timer);
  }, [restoreVault]);

  // Global shortcuts. The editor binds Ctrl+F/K itself; this covers the rest of
  // the window and suppresses the webview's own find bar.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      // Mod+Shift+V arms a one-block paste for whichever surface receives the
      // paste that follows; every other key disarms it, so a stale flag can
      // never hijack a later paste.
      const oneBlock = mod && event.shiftKey && event.key.toLowerCase() === "v";
      if (useStore.getState().oneBlockPaste !== oneBlock) {
        useStore.setState({ oneBlockPaste: oneBlock });
      }
      if (!mod) return;
      const { setPalette, openFind, create, flushSave, active: current } = useStore.getState();
      const key = event.key.toLowerCase();

      if (event.shiftKey && key === "f") {
        event.preventDefault();
        if (current) {
          openFind();
        }
      } else if (!event.shiftKey && (key === "f" || key === "k")) {
        event.preventDefault();
        setPalette(true);
      } else if (!event.shiftKey && key === "n") {
        event.preventDefault();
        void create(current?.type ?? "prompt", "");
      } else if (!event.shiftKey && key === "s") {
        event.preventDefault();
        void flushSave();
      } else if (SUPPRESSED_MOD_KEYS.has(key)) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Reload and the developer tools are webview affordances too, but they sit on
  // function keys rather than a modifier. F5/Ctrl+R would throw away unsaved
  // edits and restart the whole app, which no user is asking for from a note.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const reload = event.key === "F5" || ((event.ctrlKey || event.metaKey) && event.key === "r");
      if (reload) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Ctrl +/- scales the whole UI; the choice persists between sessions. The
  // app is designed at 14px, but the size most people end up settling on is a
  // couple of steps smaller — start there instead of at 100%.
  useEffect(() => {
    const KEY = "sudonotes.fontScale.v2";
    const DEFAULT_SCALE = 0.8;
    const apply = (scale: number) => {
      document.documentElement.style.zoom = String(scale);
    };
    apply(Number(localStorage.getItem(KEY)) || DEFAULT_SCALE);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key !== "+" && event.key !== "=" && event.key !== "-" && event.key !== "0") {
        return;
      }
      event.preventDefault();
      const current = Number(localStorage.getItem(KEY)) || DEFAULT_SCALE;
      let next = current;
      if (event.key === "0") next = 1;
      else if (event.key === "+" || event.key === "=") next = Math.min(1.6, current + 0.1);
      else next = Math.max(0.7, current - 0.1);
      localStorage.setItem(KEY, String(next));
      apply(next);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Files edited outside the app are the source of truth too.
  useEffect(() => {
    const unlisten = listen("vault-changed", () => {
      void useStore.getState().reloadExternal();
    });
    return () => void unlisten.then((stop) => stop());
  }, []);

  // Linked GitHub issues close without telling us, so their state is polled.
  // One request per repository per run keeps this far inside the rate limit.
  useEffect(() => {
    if (!vaultPath) return;
    // Reported once per session: a repository that cannot be reached will fail
    // on every run, and a toast on each one would be a nag rather than news.
    let reportedFailure = false;
    const sync = async () => {
      try {
        const result = await api.syncGithubIssues();
        if (result.failed > 0 && !reportedFailure) {
          reportedFailure = true;
          useStore
            .getState()
            .setError(
              `Could not check linked issues on ${result.failed} repository${result.failed === 1 ? "" : " repositories"}. Their bubbles will keep showing the last known state.`,
            );
        }
        if (result.removed > 0) {
          useStore
            .getState()
            .setNoticeAction(
              `Removed ${result.removed} bubble${result.removed === 1 ? "" : "s"} for closed issues`,
              "Undo",
              () => void undoCleanup(),
            );
        }
      } catch {
        // Signed out, offline, or GitHub is down. Nothing to say about it.
      }
    };
    const undoCleanup = async () => {
      try {
        // The editor's queued body is the one with the bubble already gone. It
        // has to be dropped before the restore, or it lands afterwards and
        // deletes the bubble a second time — and while it is queued the note
        // counts as dirty, which suppresses the reload entirely.
        useStore.getState().discardPendingSave();
        const restored = await api.undoIssueCleanup();
        if (restored === 0) {
          useStore
            .getState()
            .setError("Nothing left to restore — the undo buffer only lasts while the app is open.");
          return;
        }
        await useStore.getState().reloadExternal();
      } catch (e) {
        useStore.getState().setError(String(e));
      }
    };

    // Issues are closed in a browser, so returning to the window is the moment
    // the answer is most likely to have changed — far more useful than any
    // interval. Throttled, because alt-tabbing is not a request to poll, and
    // deliberately not tied to typing: a sync per keystroke would be absurd for
    // something that changes a few times a day.
    let lastRun = 0;
    const syncIfDue = () => {
      const now = Date.now();
      if (now - lastRun < FOCUS_SYNC_THROTTLE_MS) return;
      lastRun = now;
      void sync();
    };

    syncIfDue();
    window.addEventListener("focus", syncIfDue);
    const timer = window.setInterval(syncIfDue, ISSUE_SYNC_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", syncIfDue);
      window.clearInterval(timer);
    };
  }, [vaultPath]);

  // A toast never outlives its point: an error or notice dismisses itself
  // after a few seconds, or as soon as a newer one replaces it.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), TOAST_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [error, setError]);

  useEffect(() => {
    if (!notice) return;
    // A notice offering an action has to outlast a glance: five seconds is not
    // long enough to read "removed 3 bubbles", decide, and reach for Undo.
    const timer = setTimeout(
      () => setNotice(null),
      noticeAction ? ACTION_TOAST_DISMISS_MS : TOAST_DISMISS_MS,
    );
    return () => clearTimeout(timer);
  }, [notice, noticeAction, setNotice]);

  // Never lose an in-flight edit when the window goes away. `beforeunload`
  // cannot wait for anything: the flush is asynchronous and the process was
  // free to exit before the write landed, so the last half-second of typing
  // could simply be gone. Tauri's close request can be held open, so the save
  // is allowed to finish and the window is then closed explicitly.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let closing = false;
    let cancelled = false;

    void (async () => {
      try {
        const appWindow = getCurrentWindow();
        const stop = await appWindow.onCloseRequested(async (event) => {
          if (closing) return;
          event.preventDefault();
          closing = true;
          try {
            await useStore.getState().flushSave();
            await flushPendingHistory();
          } catch {
            // A failed flush must not trap the user in a window that will not
            // close; the error has already been surfaced by the store.
          }
          await appWindow.destroy();
        });
        // Unmounted while the listener was being registered, so detach it now
        // rather than leave it behind.
        if (cancelled) stop();
        else unlisten = stop;
      } catch {
        // No Tauri window — a browser build or a test. The `beforeunload`
        // listener below is all that is available there.
      }
    })();

    // Kept as a backstop for the browser-hosted build and for a reload, where
    // no Tauri close request is raised at all.
    const flush = () => void useStore.getState().flushSave();
    window.addEventListener("beforeunload", flush);
    return () => {
      cancelled = true;
      window.removeEventListener("beforeunload", flush);
      unlisten?.();
    };
  }, []);

  const content = booting ? (
    <Splash />
  ) : !vaultPath ? (
    <Welcome />
  ) : (
    // Without an open note there is no right panel, so the grid drops that
    // column instead of leaving a gap that pushes the content off centre.
    <div className={active ? "app" : "app no-panel"}>
      <Sidebar />
      <main className="main">
        {active ? (
          <>
            <TitleBar />
            {/* Prompts always head a collection; an idea shows its editor until
                it has been split into blocks. */}
            {!active.collection && (active.type === "prompt" || hasChildren) ? (
              <PromptCards />
            ) : (
              <Editor />
            )}
          </>
        ) : (
          <EmptyState />
        )}
      </main>
      {active && <RightPanel />}
      <StatusBar />
    </div>
  );

  return (
    <div className="shell">
      <WindowChrome />
      <div className="shell-body">{content}</div>

      <SearchPalette />
      <SplitPreview />
      <ContextMenu />
      <NotePicker />
      <ConfirmDialog />
      <IssueDraftDialog />
      <Settings />
      <TooltipLayer />

      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="icon-button" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      {notice && (
        <div className="toast success" role="status">
          <span>{notice}</span>
          {noticeAction && (
            <button
              className="toast-action"
              onClick={() => {
                noticeAction.run();
                setNotice(null);
              }}
            >
              {noticeAction.label}
            </button>
          )}
          <button className="icon-button" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      <UpdateBanner />
    </div>
  );
}
