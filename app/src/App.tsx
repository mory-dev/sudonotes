import { useEffect, useState } from "react";

import { listen } from "@tauri-apps/api/event";

import { ContextMenu } from "./components/ContextMenu";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Editor } from "./components/Editor";
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
import { useStore } from "./store";

import "./App.css";

/** Keep the splash on screen long enough to read, even on a fast start. */
const MIN_SPLASH_MS = 900;

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
  const setNotice = useStore((s) => s.setNotice);
  const loadAiSettings = useStore((s) => s.loadAiSettings);
  const restoreVault = useStore((s) => s.restoreVault);
  const hasChildren = useStore((s) => s.children.length > 0);

  const [booting, setBooting] = useState(true);

  useEffect(() => {
    void loadAiSettings();
  }, [loadAiSettings]);

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

  // Never lose an in-flight edit when the window goes away.
  useEffect(() => {
    const flush = () => void useStore.getState().flushSave();
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
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
          <button className="icon-button" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}

      <UpdateBanner />
    </div>
  );
}
