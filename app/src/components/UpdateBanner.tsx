import { useEffect, useState } from "react";

import { check, type Update } from "@tauri-apps/plugin-updater";

/** Don't hit the releases endpoint more than once a day. */
const CHECK_KEY = "sudonotes.lastUpdateCheck";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Auto-update banner: checks the GitHub releases for a newer build on startup
 *  (and once a day after that), and offers to download and install it. */
export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<"idle" | "downloading" | "installing" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const found = await check();
        if (!cancelled && found) setUpdate(found);
      } catch {
        // Not under Tauri, offline, or the endpoint is unreachable — stay quiet.
      }
    };
    const last = Number(localStorage.getItem(CHECK_KEY)) || 0;
    if (Date.now() - last > CHECK_INTERVAL_MS) {
      localStorage.setItem(CHECK_KEY, String(Date.now()));
      run();
    }
    return () => {
      cancelled = true;
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
        }
      });
      setStatus("installing");
    } catch {
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
          <span>Couldn't download the update.</span>
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
