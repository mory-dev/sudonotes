import { useEffect, useState } from "react";

import { useStore } from "../store";

/** A single AI-assistance toggle. Hover the info icon for a short explanation;
 *  no API key is needed — calls go through the sudonotes proxy. */
export function AiPanel() {
  const settings = useStore((s) => s.aiSettings);
  const load = useStore((s) => s.loadAiSettings);
  const save = useStore((s) => s.saveAiSettings);

  const [tip, setTip] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="ai-panel panel-section">
      <header className="section-header">
        <span>AI assistance</span>
        <button
          className="ai-info"
          onMouseEnter={() => setTip(true)}
          onMouseLeave={() => setTip(false)}
          title="About AI assistance"
          aria-label="About AI assistance"
        >
          ?
        </button>
      </header>

      <label className="ai-toggle">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => void save(event.target.checked)}
        />
        <span>Enable cloud analysis &amp; tagging</span>
      </label>

      {tip && (
        <p className="ai-tip">
          Analyzes prompt/model fit, suggests refinements, and auto-tags notes. Runs through
          the sudonotes API — free while costs stay reasonable with DeepSeek.
        </p>
      )}
    </section>
  );
}
