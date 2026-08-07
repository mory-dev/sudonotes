/** Shown while the app restores the last vault and builds its index. */
export function Splash() {
  return (
    <div className="splash">
      <div className="splash-mark">
        <span className="splash-prompt">$</span>
        <span className="splash-word">sudonotes</span>
        <span className="splash-caret" />
      </div>
      <div className="splash-bar">
        <span />
      </div>
    </div>
  );
}
