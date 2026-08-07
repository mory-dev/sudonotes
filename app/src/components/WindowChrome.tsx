import { useEffect, useState } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";

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

  // Square off the corners when maximized — a rounded maximized window looks broken.
  useEffect(() => {
    document.documentElement.dataset.maximized = String(maximized);
  }, [maximized]);

  return (
    <div className="chrome" data-tauri-drag-region>
      <span className="chrome-title" data-tauri-drag-region>
        <span className="chrome-dot" />
        sudonotes
      </span>

      <div className="chrome-controls">
        <button
          className="chrome-button"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => void appWindow()?.minimize()}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M0 5h10" />
          </svg>
        </button>

        <button
          className="chrome-button"
          title={maximized ? "Restore" : "Maximize"}
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
          title="Close"
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
