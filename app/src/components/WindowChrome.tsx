import { useEffect, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

import { api } from "../api";

/** The native title bar is disabled, so the window is dragged and controlled
 *  from here. Guarded throughout so the UI still renders in a plain browser. */
function appWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export function WindowChrome() {
  const [maximized, setMaximized] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    const win = appWindow();
    if (!win) return;

    let stop: (() => void) | undefined;
    const sync = () => void win.isMaximized().then(setMaximized).catch(() => {});

    sync();
    void win.onResized(sync).then((unlisten) => {
      stop = unlisten;
    });

    return () => stop?.();
  }, []);

  // The version shown in the hover tooltip; empty when running outside Tauri.
  useEffect(() => {
    api
      .appVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  // Square off the corners when maximized — a rounded maximized window looks broken.
  useEffect(() => {
    document.documentElement.dataset.maximized = String(maximized);
  }, [maximized]);

  return (
    // The title text itself is pointer-events: none (it must not fight the drag
    // region), so the version tooltip lives on the chrome bar that actually
    // receives the hover.
    <div className="chrome" data-tauri-drag-region data-tooltip={version ? `sudonotes v${version}` : "sudonotes"}>
      <span className="chrome-title" data-tauri-drag-region>
        <span className="chrome-dot" />
        sudonotes
      </span>

      <div className="chrome-controls">
        <button
          className="chrome-button"
          data-tooltip="Minimize"
          aria-label="Minimize"
          onClick={() => void appWindow()?.minimize()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" />
          </svg>
        </button>

        <button
          className="chrome-button"
          data-tooltip={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => void appWindow()?.toggleMaximize()}
        >
          {maximized ? (
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2.5 2.5h5v5h-5z" />
              <path d="M0.5 7.5v-7h7" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0.5 0.5h9v9h-9z" />
            </svg>
          )}
        </button>

        <button
          className="chrome-button close"
          data-tooltip="Close"
          aria-label="Close"
          onClick={() => void appWindow()?.close()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
