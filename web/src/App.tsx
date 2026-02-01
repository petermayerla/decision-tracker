import { useState, useEffect, useRef } from "react";
import {
  fetchDecisions,
  addDecision,
  patchDecision,
  startDecision,
  completeDecision,
  generateSuggestions,
  resetDecisions,
  type Decision,
  type DecisionPatch,
  type Suggestion,
} from "./api";

const FILTERS = ["all", "todo", "in-progress", "done"] as const;
type Filter = (typeof FILTERS)[number];

const STATUS_DOT: Record<Decision["status"], string> = {
  todo: "status-dot status-dot-todo",
  "in-progress": "status-dot status-dot-progress",
  done: "status-dot status-dot-done",
};

function clarityScore(d: Decision): number {
  let score = 0;
  if (d.title) score += 25;
  if (d.outcome) score += 25;
  if (d.metric) score += 25;
  if (d.horizon) score += 25;
  return score;
}

export function App() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [suggestionsExpandedId, setSuggestionsExpandedId] = useState<number | null>(null);
  const [suggestionsMap, setSuggestionsMap] = useState<Record<number, Suggestion[]>>({});
  const [generating, setGenerating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const status = filter === "all" ? undefined : filter;
    const result = await fetchDecisions(status);
    if (result.ok) setDecisions(result.value);
  };

  useEffect(() => { load(); }, [filter]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleAdd = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return;
    setBusy(true);
    const result = await addDecision(title.trim());
    setBusy(false);
    if (result.ok) {
      setTitle("");
      inputRef.current?.focus();
      load();
    } else {
      setError(result.error.message);
    }
  };

  const handleStart = async (id: number) => {
    setError(null);
    setBusy(true);
    const result = await startDecision(id);
    setBusy(false);
    if (result.ok) load();
    else setError(result.error.message);
  };

  const handleDone = async (id: number) => {
    setError(null);
    setBusy(true);
    const result = await completeDecision(id);
    setBusy(false);
    if (result.ok) load();
    else setError(result.error.message);
  };

  const handleSaveDetails = async (id: number, patch: DecisionPatch) => {
    setError(null);
    setBusy(true);
    const result = await patchDecision(id, patch);
    setBusy(false);
    if (result.ok) {
      setEditingId(null);
      load();
    } else {
      setError(result.error.message);
    }
  };

  const toggleExpanded = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setEditingId(null);
    } else {
      setExpandedId(id);
      setEditingId(null);
    }
  };

  const toggleSuggestions = (id: number) => {
    setSuggestionsExpandedId(suggestionsExpandedId === id ? null : id);
  };

  const handleGenerate = async (d: Decision) => {
    setError(null);
    setGenerating(true);
    const result = await generateSuggestions(d);
    setGenerating(false);
    if (result.ok) {
      setSuggestionsMap((prev) => ({ ...prev, [d.id]: result.value.suggestions }));
    } else {
      setError(result.error.message);
    }
  };

  const handleApplySuggestion = async (d: Decision, s: Suggestion) => {
    const patch: DecisionPatch = {};
    if (s.outcome && !d.outcome) patch.outcome = s.outcome;
    if (s.metric && !d.metric) patch.metric = s.metric;
    if (s.horizon && !d.horizon) patch.horizon = s.horizon;
    if (Object.keys(patch).length === 0) return;
    setError(null);
    setBusy(true);
    const result = await patchDecision(d.id, patch);
    setBusy(false);
    if (result.ok) load();
    else setError(result.error.message);
  };

  const handleReset = async () => {
    if (!window.confirm("Reset all decisions to seed data?")) return;
    setError(null);
    setBusy(true);
    const result = await resetDecisions();
    setBusy(false);
    if (result.ok) {
      setExpandedId(null);
      setEditingId(null);
      setSuggestionsExpandedId(null);
      setSuggestionsMap({});
      load();
    } else {
      setError(result.error.message);
    }
  };

  const handleAddSuggestion = async (suggestionTitle: string, parentId: number) => {
    setError(null);
    setBusy(true);
    const result = await addDecision(suggestionTitle, { parentId, kind: "action" });
    setBusy(false);
    if (result.ok) load();
    else setError(result.error.message);
  };

  return (
    <div className="container">
      <div className="header-row">
        <h1>Decisions</h1>
        <button className="btn btn-reset" disabled={busy} onClick={handleReset}>Reset</button>
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button
            key={f}
            className={`filter-btn ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f}
          </button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="decision-list">
        {decisions.filter((d) => !d.parentId).length === 0 ? (
          <div className="empty">No decisions yet.</div>
        ) : (
          decisions.filter((d) => !d.parentId).map((d) => {
            const isExpanded = expandedId === d.id;
            const isEditing = editingId === d.id;
            const hasDetails = !!(d.outcome || d.metric || d.horizon);
            const isSuggestionsOpen = suggestionsExpandedId === d.id;
            const suggestions = suggestionsMap[d.id];
            const childActions = decisions.filter((a) => a.parentId === d.id);
            return (
              <div key={d.id} className={isExpanded || isSuggestionsOpen ? "decision-group decision-group-expanded" : "decision-group"}>
                <div className="decision-card">
                  <ClarityRing score={clarityScore(d)} />
                  <span className="decision-id">#{d.id}</span>
                  <span className="decision-title">{d.title}</span>
                  {d.status === "todo" && (
                    <button className="btn btn-start" disabled={busy} onClick={() => handleStart(d.id)}>Start</button>
                  )}
                  {d.status === "in-progress" && (
                    <button className="btn btn-done" disabled={busy} onClick={() => handleDone(d.id)}>Done</button>
                  )}
                </div>

                <div className="details-summary-row">
                  {hasDetails ? (
                    <span className="details-summary-text">
                      {[d.outcome, d.metric, d.horizon].filter(Boolean).join(" \u00b7 ")}
                    </span>
                  ) : (
                    <span className="details-summary-placeholder">Add details (outcome, metric, horizon)</span>
                  )}
                </div>

                <div className="card-toggles">
                  <button
                    className={`toggle-btn ${isExpanded ? "toggle-btn-open" : ""}`}
                    onClick={() => toggleExpanded(d.id)}
                  >
                    {isExpanded ? "\u25bc" : "\u25b6"} Details
                  </button>
                  {d.status !== "done" && (
                    <button
                      className={`toggle-btn ${isSuggestionsOpen ? "toggle-btn-open" : ""}`}
                      onClick={() => toggleSuggestions(d.id)}
                    >
                      {isSuggestionsOpen ? "\u25bc" : "\u25b6"} Suggestions
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div className="details-panel">
                    {isEditing ? (
                      <DetailsEditForm
                        decision={d}
                        busy={busy}
                        onSave={(patch) => handleSaveDetails(d.id, patch)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <div className="details-view">
                        <DetailRow label="Outcome" value={d.outcome} />
                        <DetailRow label="Metric" value={d.metric} />
                        <DetailRow label="Horizon" value={d.horizon} />
                        <button
                          className="btn btn-edit"
                          onClick={() => setEditingId(d.id)}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {isSuggestionsOpen && (
                  <div className="suggestions-panel">
                    <button
                      className="btn btn-generate"
                      disabled={generating}
                      onClick={() => handleGenerate(d)}
                    >
                      {generating ? "Generating\u2026" : "Generate"}
                    </button>
                    {suggestions && suggestions.length > 0 && (
                      <div className="suggestions-list">
                        {suggestions.map((s, i) => (
                          <div className="suggestion-card" key={i}>
                            <div className="suggestion-content">
                              <span className="suggestion-title">{s.title}</span>
                              <span className="suggestion-rationale">{s.rationale}</span>
                            </div>
                            <div className="suggestion-actions">
                              {(s.outcome || s.metric || s.horizon) && (
                                <button
                                  className="btn btn-apply-suggestion"
                                  disabled={busy}
                                  onClick={() => handleApplySuggestion(d, s)}
                                >
                                  Apply
                                </button>
                              )}
                              <button
                                className="btn btn-add-suggestion"
                                disabled={busy}
                                onClick={() => handleAddSuggestion(s.title, d.id)}
                              >
                                + Add
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {childActions.length > 0 && (
                  <div className="action-list">
                    {childActions.map((a) => (
                      <div key={a.id} className="action-item">
                        <span className={STATUS_DOT[a.status]} />
                        <span className="action-title">{a.title}</span>
                        {a.status === "todo" && (
                          <button className="btn btn-start" disabled={busy} onClick={() => handleStart(a.id)}>Start</button>
                        )}
                        {a.status === "in-progress" && (
                          <button className="btn btn-done" disabled={busy} onClick={() => handleDone(a.id)}>Done</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <p className="summary">
        {(() => {
          const goals = decisions.filter((d) => !d.parentId);
          const actions = decisions.filter((d) => d.parentId);
          if (goals.length === 0) return "0 goals";
          return `${goals.length} goals, ${actions.length} actions (${goals.filter((d) => d.status === "todo").length} todo, ${goals.filter((d) => d.status === "in-progress").length} in-progress, ${goals.filter((d) => d.status === "done").length} done) \u00b7 Avg clarity ${Math.round(goals.reduce((sum, d) => sum + clarityScore(d), 0) / goals.length)}%`;
        })()}
      </p>

      <div className="add-bar">
        <form className="add-form" onSubmit={handleAdd}>
          <input
            type="text"
            placeholder="How would you like to drive impact?"
            value={title}
            ref={inputRef}
            onChange={(e) => { setTitle(e.target.value); setError(null); }}
          />
          <button type="submit" className="btn btn-add" disabled={busy || !title.trim()}>
            Add decision
          </button>
        </form>
      </div>
    </div>
  );
}

function ClarityRing({ score }: { score: number }) {
  const r = 9;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 75 ? "var(--status-done)" : score >= 50 ? "var(--status-progress)" : "var(--status-todo)";
  return (
    <svg className="clarity-ring" width="24" height="24" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
      <circle cx="12" cy="12" r={r} fill="none" stroke={color} strokeWidth="2.5"
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform="rotate(-90 12 12)" />
    </svg>
  );
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      {value
        ? <span className="detail-value">{value}</span>
        : <span className="detail-placeholder">Not defined</span>}
    </div>
  );
}

function DetailsEditForm({
  decision, busy, onSave, onCancel,
}: {
  decision: Decision;
  busy: boolean;
  onSave: (patch: DecisionPatch) => void;
  onCancel: () => void;
}) {
  const [outcome, setOutcome] = useState(decision.outcome ?? "");
  const [metric, setMetric] = useState(decision.metric ?? "");
  const [horizon, setHorizon] = useState(decision.horizon ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const patch: DecisionPatch = {};
    if (outcome.trim()) patch.outcome = outcome.trim();
    if (metric.trim()) patch.metric = metric.trim();
    if (horizon.trim()) patch.horizon = horizon.trim();
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    onSave(patch);
  };

  return (
    <form className="details-edit-form" onSubmit={handleSubmit}>
      <label className="detail-edit-field">
        <span className="detail-label">Outcome</span>
        <input className="detail-input" type="text" placeholder='e.g. "Stakeholders aligned on pricing"' value={outcome} onChange={(e) => setOutcome(e.target.value)} />
      </label>
      <label className="detail-edit-field">
        <span className="detail-label">Metric</span>
        <input className="detail-input" type="text" placeholder='e.g. "Conversion rate (%)"' value={metric} onChange={(e) => setMetric(e.target.value)} />
      </label>
      <label className="detail-edit-field">
        <span className="detail-label">Horizon</span>
        <input className="detail-input" type="text" placeholder='e.g. "this week"' value={horizon} onChange={(e) => setHorizon(e.target.value)} />
      </label>
      <div className="detail-edit-actions">
        <button type="submit" className="btn btn-save" disabled={busy}>Save</button>
        <button type="button" className="btn btn-cancel" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
