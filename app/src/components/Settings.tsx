import { useEffect, useState } from "react";

import { api } from "../api";
import { useStore } from "../store";

/** Application settings, opened from the status bar's cog.
 *
 *  The AI switch used to be a permanent section of the right panel, where it
 *  spent a lot of vertical space on a preference that is set once per vault. */
export function Settings() {
  const open = useStore((s) => s.settingsOpen);
  const setSettings = useStore((s) => s.setSettings);
  const settings = useStore((s) => s.aiSettings);
  const save = useStore((s) => s.saveAiSettings);

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
