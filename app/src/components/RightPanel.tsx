import { useStore } from "../store";
import { AiPanel } from "./AiPanel";
import { ModelPicker } from "./ModelPicker";
import { IdeaMark, PromptMark, TypeBadge } from "./NoteMarks";
import { ProjectLink } from "./ProjectLink";
import { TagChip } from "./TagChip";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="meta-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Backlinks() {
  const backlinks = useStore((s) => s.backlinks);
  const select = useStore((s) => s.select);
  const title = useStore((s) => s.active?.title);

  return (
    <section className="panel-section">
      <header className="section-header">
        <span>
          Linked from <span className="count">{backlinks.length}</span>
        </span>
      </header>

      {backlinks.length === 0 ? (
        <p className="empty">
          Nothing links here yet. Write <code>[[{title ?? "Note title"}]]</code> in another
          note, or right-click a selection to link it.
        </p>
      ) : (
        <ul className="note-list">
          {backlinks.map((note) => (
            <li key={note.id} data-type={note.type}>
              <button className="note-item" onClick={() => void select(note.id)}>
                <span className="pick-mark">
                  {note.type === "prompt" ? <PromptMark /> : <IdeaMark />}
                </span>
                {note.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Metadata() {
  const note = useStore((s) => s.active);
  const openLink = useStore((s) => s.openLink);
  const updateModel = useStore((s) => s.updateModel);

  if (!note) return null;

  return (
    <section className="panel-section metadata" data-type={note.type}>
      <header className="section-header">
        <span>Details</span>
      </header>

      {note.summary && <p className="meta-summary">{note.summary}</p>}

      <dl className="meta-list">
        <Row label="Type">
          <TypeBadge type={note.type} />
        </Row>

        {note.collection && (
          <Row label="Collection">
            <button className="meta-link" onClick={() => void openLink(note.collection!)}>
              {note.collection}
              {note.position != null && <span className="count">#{note.position}</span>}
            </button>
          </Row>
        )}

        <Row label="Tags">
          {note.tags.length > 0 ? (
            <ul className="meta-tags">
              {note.tags.map((tag) => (
                <li key={tag}>
                  <TagChip tag={tag} onClick={() => useStore.getState().openPalette(tag)} />
                </li>
              ))}
            </ul>
          ) : (
            <span className="muted">None</span>
          )}
        </Row>

        {note.type === "prompt" || note.type === "idea" ? (
          <Row label="Model">
            <ModelPicker value={note.model ?? ""} onChange={(value) => void updateModel(value || null)} />
          </Row>
        ) : null}

        <Row label="Created">{formatDate(note.created)}</Row>
        <Row label="Updated">{formatDate(note.updated)}</Row>

        <Row label="File">
          <span className="meta-path" title={note.path}>
            {note.path}
          </span>
        </Row>
      </dl>
    </section>
  );
}

export function RightPanel() {
  const isIdea = useStore((s) => s.active?.type === "idea");

  return (
    <aside className="right-panel">
      <div className="panel-split">
        <Backlinks />
      </div>
      <div className="panel-split">
        {isIdea && <ProjectLink />}
        <Metadata />
      </div>
      <div className="panel-split">
        <AiPanel />
      </div>
    </aside>
  );
}
