import { useStore } from "../store";

const FIT_LABEL: Record<string, string> = {
  excellent: "Excellent fit",
  good: "Good fit",
  uncertain: "Uncertain",
  poor: "Poor fit",
  not_applicable: "Not applicable",
};

/** The one AI call the user asks for by hand, and its result.
 *
 *  This used to sit under a permanent "AI assistance" panel carrying the switch
 *  and its explanation; both moved to the settings dialog, since a per-vault
 *  preference does not need a section of the right panel next to every note.
 *  What is left is per-note, so it stays here — a single button until there is
 *  something to show. */
export function AiReview() {
  const settings = useStore((s) => s.aiSettings);
  const active = useStore((s) => s.active);
  const analysis = useStore((s) => s.analysis);
  const analyzing = useStore((s) => s.analyzing);
  const analyze = useStore((s) => s.analyze);

  if (!settings.enabled || !active) return null;

  return (
    <section className="panel-section ai-review">
      <button className="ai-analyze" onClick={() => void analyze()} disabled={analyzing}>
        {analyzing ? "Reviewing…" : "Review this note"}
      </button>

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
