import { useState, type ReactNode } from "react";

import {
  DropboxMark,
  GitMark,
  ICloudMark,
  NotepadMark,
  ObsidianMark,
  VSCodeMark,
} from "./BrandMarks";

type Facet = "folder" | "markdown" | "portable";

const FolderIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M1.5 3.5h4l1.2 1.5h7.8v7.5h-13z" />
  </svg>
);

const FileIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 1.5h6l3 3v10h-9z" />
    <path d="M9.5 1.5v3h3" />
  </svg>
);

const ShareIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="4" cy="8" r="2" />
    <circle cx="12" cy="4" r="2" />
    <circle cx="12" cy="12" r="2" />
    <path d="M5.8 7l4.4-2.2M5.8 9l4.4 2.2" />
  </svg>
);

const FACETS: { id: Facet; label: string; hint: string; icon: ReactNode }[] = [
  {
    id: "folder",
    label: "Just a folder",
    hint: "Two subfolders, nothing exotic",
    icon: <FolderIcon />,
  },
  {
    id: "markdown",
    label: "Plain Markdown",
    hint: "One file per note, readable anywhere",
    icon: <FileIcon />,
  },
  {
    id: "portable",
    label: "Yours to keep",
    hint: "No account, no database, no lock-in",
    icon: <ShareIcon />,
  },
];

function TreeVisual() {
  return (
    <pre className="tree">
      <span className="tree-root">.sudonotes/</span>
      {"\n├─ "}
      <span className="tree-dir">prompts/</span>
      {"\n│  ├─ "}
      <span className="tree-file">code-reviewer.md</span>
      {"\n│  └─ "}
      <span className="tree-file">commit-message.md</span>
      {"\n└─ "}
      <span className="tree-dir">ideas/</span>
      {"\n   └─ "}
      <span className="tree-file">prompt-library.md</span>
    </pre>
  );
}

function MarkdownVisual() {
  return (
    <div className="file-card">
      <div className="file-card-head">
        <FileIcon />
        code-reviewer.md
      </div>
      <pre className="file-card-body">
        <span className="md-rule">---</span>
        {"\n"}
        <span className="md-key">title</span>: Code reviewer{"\n"}
        <span className="md-key">tags</span>: [code, review]{"\n"}
        <span className="md-rule">---</span>
        {"\n\n"}
        You are a meticulous staff engineer{"\n"}
        reviewing a pull request.{"\n\n"}
        Part of my <span className="md-link">[[Prompt library]]</span>.
      </pre>
    </div>
  );
}

const TOOLS = [
  { label: "VS Code", mark: <VSCodeMark /> },
  { label: "Obsidian", mark: <ObsidianMark /> },
  { label: "Notepad", mark: <NotepadMark /> },
  { label: "git", mark: <GitMark /> },
  { label: "Dropbox", mark: <DropboxMark /> },
  { label: "iCloud", mark: <ICloudMark /> },
];

function PortableVisual() {
  return (
    <div className="portable">
      <p className="portable-lede">The same folder opens in whatever you already use:</p>
      <ul className="pills">
        {TOOLS.map((tool) => (
          <li key={tool.label}>
            {tool.mark}
            {tool.label}
          </li>
        ))}
      </ul>
      <p className="portable-foot">
        Nothing to sign up for. Delete sudonotes tomorrow and your notes are still
        sitting there as files.
      </p>
    </div>
  );
}

const PANELS: Record<Facet, ReactNode> = {
  folder: <TreeVisual />,
  markdown: <MarkdownVisual />,
  portable: <PortableVisual />,
};

export function VaultExplainer() {
  const [facet, setFacet] = useState<Facet>("folder");

  return (
    <section className="explainer">
      <h2>What is a vault?</h2>
      <p className="explainer-lede">
        A vault is just a folder on your computer. Hover to see what goes in it.
      </p>

      <div className="explainer-body">
        <ul className="facets">
          {FACETS.map((item) => (
            <li key={item.id}>
              <button
                className={item.id === facet ? "facet active" : "facet"}
                onMouseEnter={() => setFacet(item.id)}
                onFocus={() => setFacet(item.id)}
                onClick={() => setFacet(item.id)}
                aria-pressed={item.id === facet}
              >
                <span className="facet-icon">{item.icon}</span>
                <span className="facet-text">
                  <strong>{item.label}</strong>
                  <em>{item.hint}</em>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/* Keyed so the panel replays its entrance animation on each switch. */}
        <div className="panel" key={facet}>
          {PANELS[facet]}
        </div>
      </div>
    </section>
  );
}
