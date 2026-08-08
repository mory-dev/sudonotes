import { useEffect, useState } from "react";

import { useStore } from "../store";

const FIT_LABEL: Record<string, string> = {
  excellent: "Excellent fit",
  good: "Good fit",
  uncertain: "Uncertain",
  poor: "Poor fit",
  not_applicable: "Not applicable",
};

/** The AI switch, and the one AI call the user asks for by hand. Hover the info
 *  icon for what enabling it actually does; no API key is needed — calls go
 *  through the sudonotes proxy. */
export function AiPanel() {
  const settings = useStore((s) => s.aiSettings);
  const load = useStore((s) => s.loadAiSettings);
  const save = useStore((s) => s.saveAiSettings);
  const active = useStore((s) => s.active);
  const analysis = useStore((s) => s.analysis);
  const analyzing = useStore((s) => s.analyzing);
  const analyze = useStore((s) => s.analyze);

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
        <span>Enable prompt refinements &amp; tagging</span>
      </label>

      {tip && (
        <p className="ai-tip">
          While this is on, the text of a note is sent to the sudonotes service to be tagged
          and reviewed. It is not stored or logged there. The setting belongs to this vault, and
          with it off, tagging falls back to a local keyword pass.
        </p>
      )}

      {settings.enabled && active && (
        <button className="ai-analyze" onClick={() => void analyze()} disabled={analyzing}>
          {analyzing ? "Reviewing…" : "Review this note"}
        </button>
      )}

      {analysis && (
        <div className="ai-result">
          <p className={`ai-fit ai-fit-${analysis.fit}`}>
            {FIT_LABEL[analysis.fit] ?? analysis.fit}
          </p>
          {analysis.fitReason && <p className="ai-tip">{analysis.fitReason}</p>}

          {analysis.issues.length > 0 && (
            <>
              <p className="ai-result-head">Issues</p>
              <ul className="ai-list">
                {analysis.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </>
          )}

          {analysis.refinements.length > 0 && (
            <>
              <p className="ai-result-head">Refinements</p>
              <ul className="ai-list">
                {analysis.refinements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}

          {analysis.alternatives.length > 0 && (
            <>
              <p className="ai-result-head">Try instead</p>
              <ul className="ai-list">
                {analysis.alternatives.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
