import { useEffect, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import { api, type BackupSettings } from "../api";
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

/** Compressed snapshots of the vault, kept outside it.
 *
 *  The whole point is surviving the vault folder being lost, so the archives go
 *  to the app's data directory. Nothing here writes into the vault. */
function BackupSection() {
  const setError = useStore((s) => s.setError);
  const setNotice = useStore((s) => s.setNotice);
  const hasVault = useStore((s) => !!s.vaultPath);
  const setSettings = useStore((s) => s.setSettings);
  const requestConfirm = useStore((s) => s.requestConfirm);
  const openVault = useStore((s) => s.openVault);

  const [state, setState] = useState<BackupSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .backupState()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  const toggle = async (enabled: boolean) => {
    try {
      setState(await api.setBackupEnabled(enabled));
    } catch (e) {
      setError(String(e));
    }
  };

  /** Pick a `.bak`, pick an empty folder, unpack into it, offer to open it.
   *
   *  Two dialogs rather than one because a restore must not be able to land on
   *  top of a vault: the destination is chosen explicitly and the command
   *  refuses anything that is not empty. The current vault is never touched. */
  const restore = async () => {
    const archive = await open({
      title: "Choose a backup",
      multiple: false,
      filters: [{ name: "sudonotes backup", extensions: ["bak", "zip"] }],
    });
    if (typeof archive !== "string") return;

    const destination = await open({
      directory: true,
      title: "Choose an empty folder to restore into",
    });
    if (typeof destination !== "string") return;

    setBusy(true);
    try {
      const count = await api.restoreBackup(archive, destination);
      setSettings(false);
      requestConfirm(
        `Restored ${count} notes into ${destination}. Open it as your vault?`,
        () => void openVault(destination),
        "Open it",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
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
        <code>.zip</code> to open it. Runs at most every few hours, and the twenty most recent
        are kept.
      </p>

      <dl className="settings-meta">
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

        <BackupSection />

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
