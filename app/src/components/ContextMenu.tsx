import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useStore } from "../store";

const MENU_MARGIN = 8;

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1" />
      <path d="M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9 2h5v5" />
      <path d="M14 2 7 9" />
      <path d="M12.5 9.5v4h-11v-11h4" />
    </svg>
  );
}

function NewIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 1.5h6l3 3v11h-9z" />
      <path d="M8 7v5M5.5 9.5h5" />
    </svg>
  );
}

function ClipIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 2.5h5v2h-5z" />
      <path d="M10.5 3.5h2v11h-9v-11h2" />
    </svg>
  );
}

function Item({
  icon,
  label,
  hint,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <li>
      <button className="menu-item" onClick={onClick} disabled={disabled}>
        <span className="menu-icon">{icon}</span>
        <span className="menu-label">{label}</span>
        {hint && <kbd>{hint}</kbd>}
      </button>
    </li>
  );
}

export function ContextMenu() {
  const menuAt = useStore((s) => s.menuAt);
  const closeMenu = useStore((s) => s.closeMenu);
  const setLinkPicker = useStore((s) => s.setLinkPicker);
  const requestLink = useStore((s) => s.requestLink);
  const openLink = useStore((s) => s.openLink);
  const create = useStore((s) => s.create);
  const activeType = useStore((s) => s.active?.type);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    if (!menuAt || !ref.current) return;
    const { offsetWidth, offsetHeight } = ref.current;
    setPos({
      x: Math.min(menuAt.x, window.innerWidth - offsetWidth - MENU_MARGIN),
      y: Math.min(menuAt.y, window.innerHeight - offsetHeight - MENU_MARGIN),
    });
  }, [menuAt]);

  useEffect(() => {
    if (!menuAt) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuAt, closeMenu]);

  if (!menuAt) return null;

  const selection = window.getSelection()?.toString().trim() ?? "";

  const wrapAsLink = () => {
    closeMenu();
    if (selection) requestLink(selection);
  };

  const newNoteFromSelection = () => {
    closeMenu();
    if (!selection) return;
    // Create the note, then link to it from here.
    void create(activeType ?? "prompt", selection).then(() => requestLink(selection));
  };

  const clipboard = (command: "copy" | "cut") => {
    closeMenu();
    document.execCommand(command);
  };

  return (
    <div className="menu-layer" onMouseDown={closeMenu} onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={ref}
        className="menu"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ul>
          {menuAt.link && (
            <>
              <Item
                icon={<OpenIcon />}
                label={`Open "${menuAt.link}"`}
                hint="Ctrl click"
                onClick={() => {
                  closeMenu();
                  void openLink(menuAt.link!);
                }}
              />
              <li className="menu-divider" />
            </>
          )}

          <Item
            icon={<LinkIcon />}
            label="Link selection to a note…"
            onClick={() => setLinkPicker(true)}
            disabled={!menuAt.hasSelection}
          />
          <Item
            icon={<LinkIcon />}
            label="Wrap selection as link"
            hint="[ [ "
            onClick={wrapAsLink}
            disabled={!menuAt.hasSelection}
          />
          <Item
            icon={<NewIcon />}
            label="New note from selection"
            onClick={newNoteFromSelection}
            disabled={!menuAt.hasSelection}
          />

          <li className="menu-divider" />

          <Item
            icon={<ClipIcon />}
            label="Copy"
            hint="Ctrl C"
            onClick={() => clipboard("copy")}
            disabled={!menuAt.hasSelection}
          />
          <Item
            icon={<ClipIcon />}
            label="Cut"
            hint="Ctrl X"
            onClick={() => clipboard("cut")}
            disabled={!menuAt.hasSelection}
          />
        </ul>
      </div>
    </div>
  );
}
