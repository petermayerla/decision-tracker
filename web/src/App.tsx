import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchDecisions,
  addDecision,
  patchDecision,
  startDecision,
  completeDecision,
  generateSuggestions,
  resetDecisions,
  fetchBriefing,
  type Decision,
  type DecisionPatch,
  type Suggestion,
  type SuggestionLifecycle,
  type RawSuggestion,
  type Reflection,
  type MorningBriefing,
  type BriefingFocusItem,
} from "./api";

const FILTERS = ["all", "todo", "in-progress", "done"] as const;
type Filter = (typeof FILTERS)[number];

const SUGGESTION_FILTERS = ["new", "applied", "dismissed"] as const;
type SuggestionFilter = (typeof SUGGESTION_FILTERS)[number];

// Simple deterministic hash for stable suggestion IDs
function hashSuggestionId(goalId: number, kind: string | undefined, title: string): string {
  const str = `${goalId}:${kind ?? ""}:${title}`;
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return `s_${goalId}_${(h >>> 0).toString(36)}`;
}

// Per-goal suggestion store persisted in localStorage
type SuggestionStore = Record<number, Suggestion[]>;

const LS_KEY = "suggestions-by-goal";

function loadSuggestionStore(): SuggestionStore {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveSuggestionStore(store: SuggestionStore) {
  localStorage.setItem(LS_KEY, JSON.stringify(store));
}

function mergeSuggestions(
  goalId: number,
  incoming: RawSuggestion[],
  existing: Suggestion[],
): Suggestion[] {
  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const raw of incoming) {
    const id = hashSuggestionId(goalId, raw.kind, raw.title);
    if (!byId.has(id)) {
      byId.set(id, { ...raw, id, lifecycle: "new" });
    }
    // else: keep existing lifecycle state
  }
  return [...byId.values()];
}

// ── Reflection prompts (shown on completion) ──

type ReflectionPrompt = { id: string; text: string };

function generateReflections(d: Decision, childActions: Decision[]): ReflectionPrompt[] {
  const prompts: ReflectionPrompt[] = [];
  const n = d.title.toLowerCase().replace(/\s+/g, " ").trim();

  // 1. Outcome reflection — did the stated outcome hold?
  if (d.outcome) {
    prompts.push({
      id: `ref_${d.id}_outcome`,
      text: `You set out to achieve "${d.outcome}". Looking back, what actually happened — and where did it diverge from the plan?`,
    });
  } else {
    prompts.push({
      id: `ref_${d.id}_outcome`,
      text: `What was the actual outcome of "${n}"? If you had to state it in one sentence, what would it be?`,
    });
  }

  // 2. Metric reflection — was the metric useful?
  if (d.metric) {
    prompts.push({
      id: `ref_${d.id}_metric`,
      text: `You tracked "${d.metric}". Did that number tell you what you needed to know, or would a different measure have been more useful?`,
    });
  } else {
    // No metric — ask what they'd track if they did it again
    prompts.push({
      id: `ref_${d.id}_noMetric`,
      text: `If you were starting "${n}" again, what single number would you track from the beginning?`,
    });
  }

  // 3. Context-dependent third prompt
  const doneActions = childActions.filter((a) => a.status === "done").length;
  const totalActions = childActions.length;

  if (totalActions > 0 && doneActions < totalActions) {
    // Some actions left incomplete
    prompts.push({
      id: `ref_${d.id}_actions`,
      text: `${totalActions - doneActions} of ${totalActions} actions weren't completed. Were they unnecessary, or is there unfinished work worth carrying forward?`,
    });
  } else if (d.horizon) {
    // Had a timeline — ask about pacing
    prompts.push({
      id: `ref_${d.id}_horizon`,
      text: `Your timeline was "${d.horizon}". Was the pacing right, or would you budget time differently next time?`,
    });
  } else {
    // General reusable-insight prompt
    prompts.push({
      id: `ref_${d.id}_reuse`,
      text: `What's one thing you learned here that would change how you approach a similar decision in the future?`,
    });
  }

  return prompts;
}

// ── Reflection answer store (localStorage) ──

type ReflectionStore = Record<number, Reflection>;

const REFLECTION_LS_KEY = "reflections-store";

function loadReflectionStore(): ReflectionStore {
  try {
    return JSON.parse(localStorage.getItem(REFLECTION_LS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveReflectionStore(store: ReflectionStore) {
  localStorage.setItem(REFLECTION_LS_KEY, JSON.stringify(store));
}

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
  const [suggestionStore, setSuggestionStore] = useState<SuggestionStore>(loadSuggestionStore);
  const [sugFilterMap, setSugFilterMap] = useState<Record<number, SuggestionFilter>>({});
  const [generating, setGenerating] = useState(false);
  const [reflectionStore, setReflectionStore] = useState<ReflectionStore>(loadReflectionStore);
  const [briefing, setBriefing] = useState<MorningBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingDismissed, setBriefingDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateSuggestionStore = useCallback((updater: (prev: SuggestionStore) => SuggestionStore) => {
    setSuggestionStore((prev) => {
      const next = updater(prev);
      saveSuggestionStore(next);
      return next;
    });
  }, []);

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
    const pastReflection = reflectionStore[d.id];
    const reflections = pastReflection ? [pastReflection] : undefined;
    const result = await generateSuggestions(d, reflections);
    setGenerating(false);
    if (result.ok) {
      updateSuggestionStore((prev) => ({
        ...prev,
        [d.id]: mergeSuggestions(d.id, result.value.suggestions, prev[d.id] ?? []),
      }));
    } else {
      setError(result.error.message);
    }
  };

  const setSuggestionLifecycle = (goalId: number, suggestionId: string, lifecycle: SuggestionLifecycle) => {
    updateSuggestionStore((prev) => ({
      ...prev,
      [goalId]: (prev[goalId] ?? []).map((s) =>
        s.id === suggestionId ? { ...s, lifecycle } : s,
      ),
    }));
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
      updateSuggestionStore(() => ({}));
      setSugFilterMap({});
      setReflectionStore({});
      saveReflectionStore({});
      setBriefing(null);
      setBriefingDismissed(false);
      load();
    } else {
      setError(result.error.message);
    }
  };

  const handleAddSuggestion = async (s: Suggestion, goalId: number) => {
    setError(null);
    setBusy(true);
    const result = await addDecision(s.title, { parentId: goalId, kind: "action" });
    setBusy(false);
    if (result.ok) {
      setSuggestionLifecycle(goalId, s.id, "applied");
      load();
    } else {
      setError(result.error.message);
    }
  };

  const saveReflection = (decisionId: number, answers: { promptId: string; value: string }[]) => {
    setReflectionStore((prev) => {
      const next = {
        ...prev,
        [decisionId]: { decisionId, createdAt: new Date().toISOString(), answers },
      };
      saveReflectionStore(next);
      return next;
    });
  };

  const handleBriefing = async () => {
    setBriefingLoading(true);
    setBriefingDismissed(false);
    setError(null);
    const allReflections = Object.values(reflectionStore);
    const result = await fetchBriefing(allReflections.length > 0 ? allReflections : undefined);
    setBriefingLoading(false);
    if (result.ok) {
      setBriefing(result.value);
    } else {
      setError(result.error.message);
    }
  };

  const handleBriefingAction = async (item: BriefingFocusItem) => {
    if (item.action.type === "start_existing_action" && item.action.actionId) {
      await handleStart(item.action.actionId);
    } else if (item.action.type === "finish_existing_action" && item.action.actionId) {
      await handleDone(item.action.actionId);
    } else if (item.action.type === "create_new_action") {
      setError(null);
      setBusy(true);
      const result = await addDecision(item.action.actionTitle, { parentId: item.goalId, kind: "action" });
      setBusy(false);
      if (result.ok) load();
      else setError(result.error.message);
    }
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

      <div className="briefing-bar">
        <button className="btn btn-briefing" disabled={briefingLoading} onClick={handleBriefing}>
          {briefingLoading ? "Loading\u2026" : "Morning briefing"}
        </button>
      </div>

      {briefing && !briefingDismissed && (
        <div className="briefing-panel">
          <div className="briefing-header">
            <div>
              <div className="briefing-greeting">{briefing.greeting}</div>
              <div className="briefing-headline">{briefing.headline}</div>
            </div>
            <button className="btn btn-dismiss-reflection" onClick={() => setBriefingDismissed(true)}>Hide</button>
          </div>
          <div className="briefing-focus-list">
            {briefing.focus.map((item, i) => (
              <div key={i} className="briefing-focus-item">
                <div className="briefing-focus-content">
                  <span className="briefing-focus-goal">{item.goalTitle}</span>
                  <span className="briefing-focus-why">{item.whyNow}</span>
                </div>
                <button
                  className="btn btn-start"
                  disabled={busy}
                  onClick={() => handleBriefingAction(item)}
                >
                  {item.action.type === "finish_existing_action" ? "Done" :
                   item.action.type === "start_existing_action" ? "Start" : "Create"}
                </button>
              </div>
            ))}
          </div>
          <div className="briefing-cta">
            <span className="briefing-cta-label">{briefing.cta.label}</span>
            <span className="briefing-cta-microcopy">{briefing.cta.microcopy}</span>
          </div>
        </div>
      )}

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
            const allSuggestions = suggestionStore[d.id] ?? [];
            const sugFilter = sugFilterMap[d.id] ?? "new";
            const filteredSuggestions = allSuggestions.filter((s) => s.lifecycle === sugFilter);
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
                    <div className="suggestions-header">
                      <button
                        className="btn btn-generate"
                        disabled={generating}
                        onClick={() => handleGenerate(d)}
                      >
                        {generating ? "Generating\u2026" : "Generate"}
                      </button>
                      {allSuggestions.length > 0 && (
                        <div className="sug-filters">
                          {SUGGESTION_FILTERS.map((sf) => {
                            const count = allSuggestions.filter((s) => s.lifecycle === sf).length;
                            return (
                              <button
                                key={sf}
                                className={`sug-filter-btn ${sugFilter === sf ? "active" : ""}`}
                                onClick={() => setSugFilterMap((prev) => ({ ...prev, [d.id]: sf }))}
                              >
                                {sf} ({count})
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {filteredSuggestions.length > 0 && (
                      <div className="suggestions-list">
                        {filteredSuggestions.map((s) => (
                          <div className={`suggestion-card suggestion-card-${s.lifecycle}`} key={s.id}>
                            <div className="suggestion-content">
                              <span className="suggestion-title">{s.title}</span>
                              <span className="suggestion-rationale">{s.rationale}</span>
                            </div>
                            <div className="suggestion-actions">
                              {s.lifecycle === "new" && (
                                <>
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
                                    onClick={() => handleAddSuggestion(s, d.id)}
                                  >
                                    + Add
                                  </button>
                                  <button
                                    className="btn btn-dismiss-suggestion"
                                    disabled={busy}
                                    onClick={() => setSuggestionLifecycle(d.id, s.id, "dismissed")}
                                  >
                                    Dismiss
                                  </button>
                                </>
                              )}
                              {s.lifecycle === "applied" && (
                                <span className="sug-lifecycle-badge sug-badge-applied">Added</span>
                              )}
                              {s.lifecycle === "dismissed" && (
                                <span className="sug-lifecycle-badge sug-badge-dismissed">Dismissed</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {allSuggestions.length > 0 && filteredSuggestions.length === 0 && (
                      <div className="sug-empty">No {sugFilter} suggestions.</div>
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

                {d.status === "done" && (
                  <ReflectionPanel
                    decision={d}
                    childActions={childActions}
                    saved={reflectionStore[d.id]}
                    onSave={(answers) => saveReflection(d.id, answers)}
                  />
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

function ReflectionPanel({
  decision, childActions, saved, onSave,
}: {
  decision: Decision;
  childActions: Decision[];
  saved?: Reflection;
  onSave: (answers: { promptId: string; value: string }[]) => void;
}) {
  const prompts = generateReflections(decision, childActions);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    if (!saved) return {};
    const m: Record<string, string> = {};
    for (const a of saved.answers) m[a.promptId] = a.value;
    return m;
  });
  const [collapsed, setCollapsed] = useState(!!saved);

  const hasContent = Object.values(drafts).some((v) => v.trim());
  const isSaved = !!saved;

  const handleSave = () => {
    const answers = prompts
      .map((p) => ({ promptId: p.id, value: (drafts[p.id] ?? "").trim() }))
      .filter((a) => a.value);
    if (answers.length > 0) onSave(answers);
  };

  return (
    <div className="reflection-panel">
      <div className="reflection-header">
        <span className="reflection-label">{isSaved ? "Reflected" : "Reflect"}</span>
        <button
          className="btn btn-dismiss-reflection"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>
      {!collapsed && (
        <div className="reflection-form">
          {prompts.map((r) => (
            <div key={r.id} className="reflection-field">
              <p className="reflection-prompt">{r.text}</p>
              {isSaved ? (
                <p className="reflection-answer">{drafts[r.id] || <span className="detail-placeholder">No answer</span>}</p>
              ) : (
                <textarea
                  className="reflection-input"
                  rows={2}
                  placeholder="Your reflection..."
                  value={drafts[r.id] ?? ""}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                />
              )}
            </div>
          ))}
          {!isSaved && (
            <button className="btn btn-save" disabled={!hasContent} onClick={handleSave}>
              Save reflections
            </button>
          )}
        </div>
      )}
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
