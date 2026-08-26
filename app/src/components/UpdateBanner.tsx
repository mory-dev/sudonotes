import { useEffect, useState } from "react";

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

/** Auto-update banner: checks on startup and once a day while the app remains
 * open, then offers to download, install, and relaunch into the new version. */
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
      // what makes an update banner appear on first launch after a release,
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
    } catch (error) {
      console.error("Could not install the sudonotes update", error);
      setStatus("error");
    }
  };

  const busy = status === "downloading" || status === "installing";

  return (
    <div className="update-banner" role="status">
      {busy ? (
        <span>
          {status === "downloading"
            ? `Downloading ${update.version}… ${progress > 0 ? `${progress}%` : ""}`
            : "Applying update… the app will restart itself."}
        </span>
      ) : status === "error" ? (
        <>
          <span>Couldn't apply the update.</span>
          <button className="secondary" onClick={() => setStatus("idle")}>
            Try again
          </button>
        </>
      ) : (
        <>
          <span>
            <strong>{update.version}</strong> is available — update sudonotes.
          </span>
          <button className="primary update-banner-action" onClick={() => void install()}>
            Update
          </button>
        </>
      )}
      {!busy && (
        <button
          className="icon-button update-banner-close"
          data-tooltip="Dismiss"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
      )}
    </div>
  );
}
