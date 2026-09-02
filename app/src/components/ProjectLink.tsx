import { useEffect, useState } from "react";

import { open as pickFolder } from "@tauri-apps/plugin-dialog";

import { api, type ProjectInfo } from "../api";
import { useStore } from "../store";

/** Link an idea to a software project. The note is mirrored into that project's
 *  root and gitignored, so a coding agent can read it in place. */
export function ProjectLink() {
  const note = useStore((s) => s.active);
  const select = useStore((s) => s.select);
  const setError = useStore((s) => s.setError);
  const setNotice = useStore((s) => s.setNotice);
  const requestChoice = useStore((s) => s.requestChoice);

  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const linked = note?.project ?? null;

  useEffect(() => {
    if (!linked) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    api
      .projectInfo(linked)
      .then((result) => !cancelled && setInfo(result))
      .catch(() => !cancelled && setInfo(null));
    return () => {
      cancelled = true;
    };
  }, [linked]);

  if (!note || note.type !== "idea") return null;

  const apply = async (path: string, force: boolean) => {
    setBusy(true);
    try {
      const result = await api.linkProject(note.id, path, force);
      setInfo(result.info);
      await select(note.id);
      setNotice(
        `Linked to ${result.info.name}${result.info.isGitRepo ? " and gitignored" : ""}`,
      );
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importExisting = async (path: string) => {
    setBusy(true);
    try {
      const result = await api.importProjectIdea(note.id, path);
      setInfo(result);
      await select(note.id);
      setNotice(`Imported the existing IDEAS.md as this note's content`);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    const picked = await pickFolder({ directory: true, title: "Choose the project folder" });
    if (typeof picked !== "string") return;

    try {
      const result = await api.linkProject(note.id, picked, false);
      if (result.conflict) {
        requestChoice({
          message: `IDEAS.md already exists in ${result.info.name}. Use the existing file as the baseline, or replace it with this note?`,
          options: [
            {
              label: "Use the existing file",
              description: "Import its content into this note",
              onSelect: () => void importExisting(picked),
            },
            {
              label: "Replace it with this note",
              description: "Overwrite IDEAS.md in the project",
              danger: true,
              onSelect: () => void apply(picked, true),
            },
          ],
          cancelLabel: "Cancel",
        });
        return;
      }
      await apply(picked, false);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    }
  };

  const unlink = async (removeFile: boolean) => {
    setBusy(true);
    try {
      await api.unlinkProject(note.id, removeFile);
      setInfo(null);
      await select(note.id);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="project-link">
      <header className="section-header">
        <span>Project</span>
      </header>

      {!linked ? (
        <>
          <p className="empty">
            Link this idea to a project folder. It gets written there as Markdown and added
            to <code>.gitignore</code>, so you can build on it in place.
          </p>
          <button className="secondary wide" onClick={() => void link()} disabled={busy}>
            Choose project folder…
          </button>
        </>
      ) : (
        <>
          <div className={info?.exists === false ? "project-card missing" : "project-card"}>
            {info?.icon ? (
              <img className="project-icon" src={info.icon} alt="" />
            ) : (
              <span className="project-icon placeholder">
                {(info?.name ?? "?").charAt(0).toUpperCase()}
              </span>
            )}
            <div className="project-text">
              <strong>{info?.name ?? linked}</strong>
              <span className="project-path" data-tooltip={linked}>
                {linked}
              </span>
            </div>
            {info?.remote && (
              <span
                className="project-remote"
                data-tooltip={`github.com/${info.remote.owner}/${info.remote.repo}`}
              >
                {info.remote.owner}/{info.remote.repo}
              </span>
            )}
          </div>

          {info?.exists === false ? (
            <p className="empty">That folder no longer exists.</p>
          ) : (
            <p className="empty">
              Saved as <code>IDEAS.md</code> in the project root
              {info?.isGitRepo ? ", and gitignored" : " (not a git repo, nothing ignored)"}.
            </p>
          )}

          <div className="project-actions">
            <button className="secondary" onClick={() => void link()} disabled={busy}>
              Change
            </button>
            <button className="secondary" onClick={() => void unlink(false)} disabled={busy}>
              Unlink
            </button>
            <button className="secondary danger" onClick={() => void unlink(true)} disabled={busy}>
              Unlink &amp; delete
            </button>
          </div>
        </>
      )}
    </section>
  );
}
