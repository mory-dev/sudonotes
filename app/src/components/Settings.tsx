import { useEffect, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

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
    const archive = await open({
      title: "Choose a backup",
      multiple: false,
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
