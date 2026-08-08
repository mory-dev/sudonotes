import { useEffect, useState } from "react";

import { siVim } from "simple-icons";

import { api } from "../api";
import { useStore } from "../store";

/** Vim's official mark, from simple-icons — the same source the provider logos
 *  come from. Filled rather than stroked, so it needs its own class. */
const VimMark = () => (
  <svg className="vim-mark" viewBox="0 0 24 24" aria-hidden="true">
    <path d={siVim.path} />
  </svg>
);

const CogMark = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.9v1.6M8 12.5v1.6M13.1 8h-1.6M4.5 8H2.9M11.6 4.4l-1.1 1.1M5.5 10.5l-1.1 1.1M11.6 11.6l-1.1-1.1M5.5 5.5 4.4 4.4" />
  </svg>
);

/** The bottom-right counterpart to the sidebar's vault footer: the handful of
 *  things worth knowing at a glance, plus the way into settings.
 *
 *  It floats over the layout rather than taking a row of its own, so it stays
 *  put whether or not a note (and with it the right panel) is open. */
export function StatusBar() {
  const aiEnabled = useStore((s) => s.aiSettings.enabled);
  const setSettings = useStore((s) => s.setSettings);

  const [version, setVersion] = useState("");
  // Vim mode is not implemented yet; the control is here so the status bar has
  // its intended shape, and it only toggles its own appearance.
  const [vim, setVim] = useState(false);

  useEffect(() => {
    api
      .appVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  return (
    <footer className="status-bar">
      <button
        className={vim ? "status-item toggle on" : "status-item toggle"}
        aria-pressed={vim}
        data-tooltip="Vim mode — not wired up yet"
        onClick={() => setVim((on) => !on)}
      >
        <VimMark />
      </button>

      <span className="status-sep" />

      <span
        className="status-item"
        data-tooltip={
          aiEnabled
            ? "AI assistance is on for this vault"
            : "AI assistance is off — tagging falls back to a local keyword pass"
        }
      >
        <span className={aiEnabled ? "status-dot on" : "status-dot"} />
        AI
      </span>

      {version && (
        <>
          <span className="status-sep" />
          <span className="status-item version">v{version}</span>
        </>
      )}

      <span className="status-sep" />

      <button
        className="status-item icon"
        data-tooltip="Settings"
        aria-label="Settings"
        onClick={() => setSettings(true)}
      >
        <CogMark />
      </button>
    </footer>
  );
}
