import { useEffect, useRef } from "react";

import { useStore } from "../store";

/** Styled replacement for the native dialog, so destructive actions (delete)
 *  and choices (IDEAS.md conflicts) stay in the app's look and feel. */
export function ConfirmDialog() {
  const dialog = useStore((s) => s.confirm);
  const cancelConfirm = useStore((s) => s.cancelConfirm);

  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!dialog) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, cancelConfirm]);

  if (!dialog) return null;

  const choose = (onSelect: () => void) => {
    cancelConfirm();
    onSelect();
  };

  return (
    <div className="confirm-layer" onMouseDown={cancelConfirm}>
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="confirm-message">{dialog.message}</p>
        <div className={dialog.options.length === 1 ? "confirm-actions single" : "confirm-actions"}>
          {dialog.options.map((option, i) => (
            <button
              key={i}
              className={option.danger ? "danger" : "primary"}
              onClick={() => choose(option.onSelect)}
            >
              {option.label}
              {option.description && (
                <span className="confirm-hint">{option.description}</span>
              )}
            </button>
          ))}
          {dialog.cancelLabel && (
            <button ref={cancelRef} className="secondary" onClick={cancelConfirm}>
              {dialog.cancelLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
