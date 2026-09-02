import { useEffect, useState } from "react";

import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { api } from "../api";

/** Don't poll the releases endpoint too frequently while the app stays open. */
const CHECK_KEY = "sudonotes.lastSuccessfulUpdateCheck";
/** A new installation must check immediately, even if the previous version checked recently. */
const CHECK_VERSION_KEY = "sudonotes.lastUpdateCheckAppVersion";
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const CHECK_RETRY_MS = 15 * 60 * 1000;

// React Strict Mode mounts effects twice in development. Share an in-flight
// request so that it still produces one check instead of two concurrent calls.
let updateCheckInFlight: Promise<Update | null> | null = null;

function fetchAvailableUpdate() {
  updateCheckInFlight ??= check().finally(() => {
    updateCheckInFlight = null;
  });
  return updateCheckInFlight;
}

/** Auto-update toast: checks on startup and periodically while the app remains
 * open, then offers a sleek floating toast in the bottom-right corner to download,
 * install, and relaunch into the new version. */
export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<"idle" | "downloading" | "installing" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const schedule = (delay: number) => {
      if (!cancelled) {
        timer = window.setTimeout(() => void run(), Math.max(0, delay));
      }
    };

    async function run(force = false) {
      // The timestamp is intentionally shared between versions to avoid noisy
      // polling, but a version upgrade always gets one fresh check. This is
      // what makes an update toast appear on first launch after a release,
      // even when the old version checked within the last 24 hours.
      let currentVersion: string | null = null;
      try {
        currentVersion = await api.appVersion();
      } catch {
        // Browser/dev builds do not expose the Tauri command; use the normal
        // time-based check in that environment.
      }
      const versionChanged =
        currentVersion !== null && localStorage.getItem(CHECK_VERSION_KEY) !== currentVersion;
      const last = Number(localStorage.getItem(CHECK_KEY)) || 0;
      const untilNextCheck = CHECK_INTERVAL_MS - (Date.now() - last);
      if (!force && !versionChanged && untilNextCheck > 0) {
        schedule(untilNextCheck);
        return;
      }

      try {
        const found = await fetchAvailableUpdate();
        if (cancelled) return;

        // A failed request must not suppress retries for the next 24 hours.
        localStorage.setItem(CHECK_KEY, String(Date.now()));
        if (currentVersion !== null) {
          localStorage.setItem(CHECK_VERSION_KEY, currentVersion);
        }
        setUpdate(found);
        schedule(CHECK_INTERVAL_MS);
      } catch (error) {
        console.error("Could not check for a sudonotes update", error);
        schedule(CHECK_RETRY_MS);
      }
    }

    // Always check once when the app starts. A previous check may have happened
    // before a new release was published, so the normal interval must not hide
    // an available update on launch.
    void run(true);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  if (!update || dismissed) return null;

  const install = async () => {
    setStatus("downloading");
    setProgress(0);
    let total = 0;
    let received = 0;
    try {
      if (typeof update.downloadAndInstall === "function") {
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
        await relaunch();
      } else {
        await openUrl("https://sudonotes.com/download");
        setStatus("idle");
      }
    } catch (error) {
      console.error("Could not install the sudonotes update", error);
      setStatus("error");
    }
  };

  const busy = status === "downloading" || status === "installing";

  return (
    <aside
      className="update-toast update-banner"
      role="status"
      aria-label="Application update available"
    >
      <div className="update-toast-header">
        <div className="update-toast-title-row">
          <span className="update-toast-badge">{update.version}</span>
          <span className="update-toast-title">
            {status === "downloading"
              ? "Downloading update…"
              : status === "installing"
              ? "Applying update…"
              : status === "error"
              ? "Update failed"
              : "Update available"}
          </span>
        </div>
        {!busy && (
          <button
            className="icon-button update-toast-close update-banner-close"
            data-tooltip="Dismiss"
            aria-label="Dismiss update notification"
            onClick={() => setDismissed(true)}
          >
            ×
          </button>
        )}
      </div>

      <div className="update-toast-body">
        {busy ? (
          <>
            <p className="update-toast-desc">
              {status === "downloading"
                ? `Downloading ${update.version}… ${progress > 0 ? `${progress}%` : ""}`
                : "Applying update… the app will restart itself."}
            </p>
            <div className="update-toast-progress-track">
              <div
                className={`update-toast-progress-fill ${
                  status === "installing" || progress === 0 ? "indeterminate" : ""
                }`}
                style={status === "downloading" && progress > 0 ? { width: `${progress}%` } : undefined}
              />
            </div>
          </>
        ) : status === "error" ? (
          <>
            <p className="update-toast-desc">Couldn't apply the update automatically.</p>
            <div className="update-toast-actions">
              <button
                className="primary update-toast-action update-banner-action"
                onClick={() => void install()}
              >
                Try again
              </button>
              <button
                className="secondary update-toast-secondary"
                onClick={() => void openUrl("https://sudonotes.com/download")}
              >
                Manual download
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="update-toast-desc">
              A new version of sudonotes is ready to install.
            </p>
            <div className="update-toast-actions">
              <button
                className="primary update-toast-action update-banner-action"
                onClick={() => void install()}
              >
                Update now
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

export const UpdateToast = UpdateBanner;
