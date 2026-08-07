import { useEffect, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import { api, type PathInfo } from "../api";
import { useStore } from "../store";
import { VaultExplainer } from "./VaultExplainer";

export function Welcome() {
  const openVault = useStore((s) => s.openVault);

  const [path, setPath] = useState("");
  const [info, setInfo] = useState<PathInfo | null>(null);

  // Start with a suggested location so first run is one click, not a file dialog.
  useEffect(() => {
    api
      .suggestVaultPath()
      .then(setPath)
      .catch(() => setPath(""));
  }, []);

  useEffect(() => {
    if (!path.trim()) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .inspectPath(path)
        .then((result) => !cancelled && setInfo(result))
        .catch(() => !cancelled && setInfo(null));
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path]);

  const browse = async () => {
    const picked = await open({ directory: true, title: "Choose a vault folder" });
    if (typeof picked === "string") setPath(picked);
  };

  const submit = () => {
    if (path.trim()) void openVault(path.trim());
  };

  const hint = !info
    ? " "
    : !info.exists
      ? "This folder will be created."
      : info.noteCount > 0
        ? `Existing vault — ${info.noteCount} note${info.noteCount === 1 ? "" : "s"} found.`
        : "Existing folder — prompts and ideas will be added inside it.";

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>
          <span className="splash-prompt">$</span> sudonotes
        </h1>

        <p className="lede">A home for the prompts and ideas you keep rewriting.</p>

        <VaultExplainer />

        <label className="field-label" htmlFor="vault-path">
          Vault folder
        </label>
        <div className="path-row">
          <input
            id="vault-path"
            className="path-input"
            value={path}
            spellCheck={false}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Choose where to keep your notes"
          />
          <button className="secondary" onClick={() => void browse()}>
            Browse…
          </button>
        </div>
        <p className="hint">{hint}</p>

        <button className="primary" onClick={submit} disabled={!path.trim()}>
          {info?.exists && info.noteCount > 0 ? "Open vault" : "Create vault"}
        </button>
      </div>
    </div>
  );
}
