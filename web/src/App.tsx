import { useState, useEffect, useRef, useCallback } from "react";
import confetti from 'canvas-confetti';
import {
  fetchDecisions,
  addDecision,
  patchDecision,
  startDecision,
  completeDecision,
  generateSuggestions,
  resetDecisions,
  fetchBriefing,
  submitReflection,
  type Decision,
  type DecisionPatch,
  type Suggestion,
  type SuggestionLifecycle,
  type RawSuggestion,
  type Reflection,
  type MorningBriefing,
  type BriefingFocusItem,
  type ReflectionInput,
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
const LS_USER_NAME = "user-name";
const LS_DAILY_COMMITMENTS = "daily-commitments";
const LS_BRIEFING_CACHE = "briefing-cache";
const LS_BRIEFING_DISMISSED = "briefing-dismissed";
const LS_REFLECTIONS = "reflections";

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

function loadUserName(): string | null {
  return localStorage.getItem(LS_USER_NAME);
}

function saveUserName(name: string) {
  localStorage.setItem(LS_USER_NAME, name);
}

function loadDailyCommitments(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(LS_DAILY_COMMITMENTS) || "{}");
  } catch {
    return {};
  }
}

function saveDailyCommitments(commitments: Record<string, boolean>) {
  localStorage.setItem(LS_DAILY_COMMITMENTS, JSON.stringify(commitments));
}

function loadBriefingCache(): Record<string, MorningBriefing> {
  try {
    return JSON.parse(localStorage.getItem(LS_BRIEFING_CACHE) || "{}");
  } catch {
    return {};
  }
}

function saveBriefingCache(cache: Record<string, MorningBriefing>) {
  localStorage.setItem(LS_BRIEFING_CACHE, JSON.stringify(cache));
}

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

function loadBriefingDismissed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(LS_BRIEFING_DISMISSED) || "{}");
  } catch {
    return {};
  }
}

function saveBriefingDismissed(dismissed: Record<string, boolean>) {
  localStorage.setItem(LS_BRIEFING_DISMISSED, JSON.stringify(dismissed));
}

type QuickReflection = {
  date: string;
  goalId?: number;
  actionId?: number;
  promptId: string;
  response: string;
};

type ReflectionsStore = {
  quick: QuickReflection[];
};

function loadReflections(): ReflectionsStore {
  try {
    return JSON.parse(localStorage.getItem(LS_REFLECTIONS) || '{"quick":[]}');
  } catch {
    return { quick: [] };
  }
}

function saveReflections(store: ReflectionsStore) {
  localStorage.setItem(LS_REFLECTIONS, JSON.stringify(store));
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
  const [briefingDismissed, setBriefingDismissed] = useState<Record<string, boolean>>({});
  const [userName, setUserName] = useState<string | null>(null);
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [commitments, setCommitments] = useState<Record<string, boolean>>({});
  const [briefingCache, setBriefingCache] = useState<Record<string, MorningBriefing>>({});
  const [streak, setStreak] = useState(0);
  const [reflectionsStore, setReflectionsStore] = useState<ReflectionsStore>(loadReflections);
  const [showReflectionPrompt, setShowReflectionPrompt] = useState(false);
  const [reflectionPromptData, setReflectionPromptData] = useState<{
    prompt: string;
    promptId: string;
    goalId?: number;
    actionId?: number;
  } | null>(null);
  const [reflectionInput, setReflectionInput] = useState("");
  const [wizardOpen, setWizardOpen] = useState<number | null>(null);
  const [wizardStep, setWizardStep] = useState<'clarity' | 'actions'>('clarity');
  const [wizardData, setWizardData] = useState({
    outcome: '',
    metric: '',
    horizon: '',
    selectedActions: [] as string[],
    customAction: '',
  });
  const [showHorizonPicker, setShowHorizonPicker] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState<'outcome' | 'metric' | 'horizon' | null>(null);
  const [showReflectionSheet, setShowReflectionSheet] = useState(false);
  const [reflectionSheetData, setReflectionSheetData] = useState<{
    goalId: number;
    actionId: number;
  } | null>(null);
  const [reflectionSignals, setReflectionSignals] = useState<string[]>([]);
  const [reflectionNote, setReflectionNote] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const updateSuggestionStore = useCallback((updater: (prev: SuggestionStore) => SuggestionStore) => {
    setSuggestionStore((prev) => {
      const next = updater(prev);
      saveSuggestionStore(next);
      return next;
    });
  }, []);

  const calculateStreak = useCallback(() => {
    const commitments = loadDailyCommitments();
    const today = new Date();
    let currentStreak = 0;

    // Check backwards from yesterday
    for (let i = 1; i < 365; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];

      if (commitments[dateKey]) {
        currentStreak++;
      } else {
        break;
      }
    }

    // Add today if committed
    const todayKey = getTodayKey();
    if (commitments[todayKey]) {
      currentStreak++;
    }

    setStreak(currentStreak);
  }, []);

  const load = async () => {
    const status = filter === "all" ? undefined : filter;
    const result = await fetchDecisions(status);
    if (result.ok) setDecisions(result.value);
  };

  useEffect(() => { load(); }, [filter]);
  useEffect(() => {
    inputRef.current?.focus();

    // Load user name
    const savedName = loadUserName();
    if (!savedName) {
      setShowNamePrompt(true);
    } else {
      setUserName(savedName);
    }

    // Load commitments and briefing cache
    setCommitments(loadDailyCommitments());
    setBriefingCache(loadBriefingCache());
    setBriefingDismissed(loadBriefingDismissed());

    // Calculate streak
    calculateStreak();
  }, [calculateStreak]);

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
      await load();

      // Auto-open wizard for new goal
      setWizardOpen(result.value.id);
      setWizardStep('clarity');
      setWizardData({ outcome: '', metric: '', horizon: '', selectedActions: [], customAction: '' });
    } else {
      setError(result.error.message);
    }
  };

  const handleStart = async (id: number) => {
    setError(null);
    setBusy(true);
    const result = await startDecision(id);

    if (result.ok) {
      // Client-side safety net: if this is an action, also try to start parent goal
      const task = result.value;
      if (task.parentId) {
        try {
          await startDecision(task.parentId);
        } catch {
          // Ignore errors - backend is source of truth
        }
      }
      await load();
    } else {
      setError(result.error.message);
    }
    setBusy(false);
  };

  const handleDone = async (id: number) => {
    setError(null);
    setBusy(true);
    const result = await completeDecision(id);
    setBusy(false);

    if (result.ok) {
      const task = result.value;

      // Show reflection sheet for completed actions
      if (task.parentId) {
        setReflectionSheetData({
          goalId: task.parentId,
          actionId: id,
        });
        setShowReflectionSheet(true);
      }

      await load();
    } else {
      setError(result.error.message);
    }
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

    // Combine goal-completion reflections and quick reflections
    const pastReflection = reflectionStore[d.id];
    const goalReflections = pastReflection ? [pastReflection] : [];

    // Add quick reflections related to this goal
    const quickReflections = reflectionsStore.quick
      .filter((r) => r.goalId === d.id)
      .map((r) => ({
        decisionId: d.id,
        createdAt: r.date,
        answers: [{ promptId: r.promptId, value: r.response }],
      }));

    const allReflections = [...goalReflections, ...quickReflections];
    const result = await generateSuggestions(d, allReflections.length > 0 ? allReflections : undefined);
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
      setBriefingDismissed({});
      saveBriefingDismissed({});
      setBriefingCache({});
      saveBriefingCache({});
      setReflectionsStore({ quick: [] });
      saveReflections({ quick: [] });
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

  const handleNameSubmit = () => {
    const trimmed = nameInput.trim();
    if (trimmed) {
      saveUserName(trimmed);
      setUserName(trimmed);
      setShowNamePrompt(false);
      setNameInput("");
    }
  };

  const triggerConfetti = (currentStreak: number) => {
    const milestones = [3, 7, 14, 30];
    const isMilestone = milestones.includes(currentStreak);

    if (isMilestone) {
      // Big celebration for milestones
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });

      // Extra burst for big milestones
      if (currentStreak >= 14) {
        setTimeout(() => {
          confetti({
            particleCount: 50,
            angle: 60,
            spread: 55,
            origin: { x: 0 }
          });
          confetti({
            particleCount: 50,
            angle: 120,
            spread: 55,
            origin: { x: 1 }
          });
        }, 250);
      }
    } else {
      // Subtle confetti for regular days
      confetti({
        particleCount: 30,
        spread: 40,
        origin: { y: 0.6 }
      });
    }
  };

  const handleCommitment = () => {
    const todayKey = getTodayKey();

    // Mark today as committed
    const newCommitments = { ...commitments, [todayKey]: true };
    setCommitments(newCommitments);
    saveDailyCommitments(newCommitments);

    // Calculate new streak
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().split('T')[0];

    let newStreak = 1;
    if (commitments[yesterdayKey]) {
      // Continue streak
      newStreak = streak + 1;
    }
    // else: streak resets to 1

    setStreak(newStreak);

    // Trigger confetti
    triggerConfetti(newStreak);

    // Show reflection prompt
    setReflectionPromptData({
      prompt: "What would make today a win?",
      promptId: "commit",
      goalId: briefing?.focus[0]?.goalId,
    });
    setShowReflectionPrompt(true);
  };

  const handleDismissBriefing = () => {
    const todayKey = getTodayKey();
    const newDismissed = { ...briefingDismissed, [todayKey]: true };
    setBriefingDismissed(newDismissed);
    saveBriefingDismissed(newDismissed);
    setBriefing(null);
  };

  const handleReflectionSubmit = async () => {
    if (!reflectionPromptData || !reflectionInput.trim()) {
      setShowReflectionPrompt(false);
      setReflectionInput("");
      return;
    }

    setError(null);
    setBusy(true);

    // Submit to API
    const input: ReflectionInput = {
      goalId: reflectionPromptData.goalId!,
      actionId: reflectionPromptData.actionId,
      answers: [
        {
          promptId: reflectionPromptData.promptId,
          value: reflectionInput.trim(),
        },
      ],
    };

    const result = await submitReflection(input);
    setBusy(false);

    if (result.ok) {
      // Also save to localStorage for backward compatibility
      const newReflection: QuickReflection = {
        date: getTodayKey(),
        goalId: reflectionPromptData.goalId,
        actionId: reflectionPromptData.actionId,
        promptId: reflectionPromptData.promptId,
        response: reflectionInput.trim(),
      };

      const updated = {
        ...reflectionsStore,
        quick: [...reflectionsStore.quick, newReflection],
      };
      setReflectionsStore(updated);
      saveReflections(updated);

      // Close modal
      setShowReflectionPrompt(false);
      setReflectionInput("");
      setReflectionPromptData(null);

      // Refresh briefing cache if it exists
      const todayKey = getTodayKey();
      if (briefingCache[todayKey]) {
        const newCache = { ...briefingCache };
        delete newCache[todayKey];
        setBriefingCache(newCache);
        saveBriefingCache(newCache);
      }
    } else {
      setError(result.error.message);
      // Keep modal open so user can see error
    }
  };

  const handleReflectionSkip = () => {
    setShowReflectionPrompt(false);
    setReflectionInput("");
    setReflectionPromptData(null);
  };

  const handleReflectionSheetSave = async () => {
    if (!reflectionSheetData) return;

    if (reflectionSignals.length === 0) {
      setError("Please select at least one signal");
      return;
    }

    const input: ReflectionInput = {
      goalId: reflectionSheetData.goalId,
      actionId: reflectionSheetData.actionId,
      signals: reflectionSignals,
      note: reflectionNote.trim() || undefined,
    };

    setError(null);
    setBusy(true);
    const result = await submitReflection(input);
    setBusy(false);

    if (result.ok) {
      setShowReflectionSheet(false);
      setReflectionSheetData(null);
      setReflectionSignals([]);
      setReflectionNote("");

      // Refresh briefing cache if it exists
      const todayKey = getTodayKey();
      if (briefingCache[todayKey]) {
        const newCache = { ...briefingCache };
        delete newCache[todayKey];
        setBriefingCache(newCache);
        saveBriefingCache(newCache);
      }
    } else {
      setError(result.error.message);
    }
  };

  const handleReflectionSheetSkip = () => {
    setShowReflectionSheet(false);
    setReflectionSheetData(null);
    setReflectionSignals([]);
    setReflectionNote("");
  };

  const toggleReflectionSignal = (signal: string) => {
    setReflectionSignals((prev) => {
      if (prev.includes(signal)) {
        return prev.filter((s) => s !== signal);
      } else {
        return [...prev, signal];
      }
    });
  };

  const handleWizardClarityComplete = async (skipToActions = false) => {
    if (!wizardOpen) return;

    if (!skipToActions) {
      const { outcome, metric, horizon } = wizardData;
      if (outcome || metric || horizon) {
        await patchDecision(wizardOpen, {
          outcome: outcome || undefined,
          metric: metric || undefined,
          horizon: horizon || undefined,
        });
        await load();
      }
    }

    setWizardStep('actions');

    // Generate suggestions with context
    const goal = decisions.find(d => d.id === wizardOpen);
    if (goal) {
      await handleGenerate(goal);
    }
  };

  const handleWizardActionsComplete = async () => {
    if (!wizardOpen) return;

    const { selectedActions } = wizardData;

    if (selectedActions.length === 0) {
      setError("Please select at least one action");
      return;
    }

    setBusy(true);
    for (const actionTitle of selectedActions) {
      await addDecision(actionTitle, { parentId: wizardOpen, kind: 'action' });
    }
    setBusy(false);

    // Close wizard and reload
    setWizardOpen(null);
    setWizardData({ outcome: '', metric: '', horizon: '', selectedActions: [], customAction: '' });
    await load();
  };

  const handleWizardClose = () => {
    setWizardOpen(null);
    setWizardData({ outcome: '', metric: '', horizon: '', selectedActions: [], customAction: '' });
    setWizardStep('clarity');
  };

  const handleRefineGoal = (goalId: number) => {
    const goal = decisions.find(d => d.id === goalId);
    if (!goal) return;

    setWizardOpen(goalId);
    setWizardStep('clarity');
    setWizardData({
      outcome: goal.outcome || '',
      metric: goal.metric || '',
      horizon: goal.horizon || '',
      selectedActions: [],
      customAction: '',
    });
  };

  const handleSuggestField = async (field: 'outcome' | 'metric' | 'horizon') => {
    if (!wizardOpen) return;

    const goal = decisions.find(d => d.id === wizardOpen);
    if (!goal) return;

    setLoadingSuggestions(field);
    setError(null);

    try {
      const result = await generateSuggestions(goal);

      if (result.ok && result.value.suggestions.length > 0) {
        // Find first suggestion with the requested field
        const suggestion = result.value.suggestions.find(s => s[field]);
        if (suggestion && suggestion[field]) {
          setWizardData({
            ...wizardData,
            [field]: suggestion[field],
          });
        } else {
          setError(`No ${field} suggestion available`);
        }
      }
    } catch (err) {
      setError(`Failed to fetch suggestion: ${err}`);
    } finally {
      setLoadingSuggestions(null);
    }
  };

  const handleSelectHorizonChip = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);

    let label = '';
    if (days === 3) label = '3 days';
    else if (days === 7) label = '1 week';
    else if (days === 14) label = '2 weeks';
    else if (days === 28) label = '4 weeks';
    else label = `${days} days`;

    setWizardData({
      ...wizardData,
      horizon: label,
    });
    setShowHorizonPicker(false);
  };

  const handleSelectHorizonRelative = (type: 'month' | 'quarter') => {
    const date = new Date();
    let label = '';

    if (type === 'month') {
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      label = 'End of month';
    } else {
      const quarter = Math.floor(date.getMonth() / 3);
      const lastMonth = (quarter + 1) * 3;
      label = `End of Q${quarter + 1}`;
    }

    setWizardData({
      ...wizardData,
      horizon: label,
    });
    setShowHorizonPicker(false);
  };

  const handleBriefing = async () => {
    const todayKey = getTodayKey();

    // Check cache first
    if (briefingCache[todayKey]) {
      setBriefing(briefingCache[todayKey]);
      // Don't auto-dismiss from cache, respect current dismissed state
      return;
    }

    // Fetch new briefing
    setBriefingLoading(true);
    setError(null);

    // Combine goal completion reflections with quick reflections
    const goalReflections = Object.values(reflectionStore);

    // Convert quick reflections to Reflection format
    const quickReflections = reflectionsStore.quick.map((qr) => ({
      decisionId: qr.goalId || 0,
      createdAt: qr.date,
      answers: [{ promptId: qr.promptId, value: qr.response }],
    }));

    const allReflections = [...goalReflections, ...quickReflections];
    const result = await fetchBriefing(allReflections.length > 0 ? allReflections : undefined, userName || undefined);
    setBriefingLoading(false);

    if (result.ok) {
      setBriefing(result.value);

      // Cache the result
      const newCache = { ...briefingCache, [todayKey]: result.value };
      setBriefingCache(newCache);
      saveBriefingCache(newCache);
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
      {showNamePrompt && (
        <div className="name-prompt-overlay">
          <div className="name-prompt-modal">
            <h3>Welcome!</h3>
            <p>What's your name?</p>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit()}
              placeholder="Your name"
              autoFocus
            />
            <button className="btn btn-primary" onClick={handleNameSubmit}>
              Continue
            </button>
          </div>
        </div>
      )}

      {showReflectionPrompt && reflectionPromptData && (
        <div className="name-prompt-overlay">
          <div className="name-prompt-modal reflection-modal">
            <h3>Quick Reflection</h3>
            <p>{reflectionPromptData.prompt}</p>
            <input
              type="text"
              value={reflectionInput}
              onChange={(e) => setReflectionInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && handleReflectionSubmit()}
              placeholder="Your thoughts..."
              autoFocus
              disabled={busy}
            />
            {error && <div className="reflection-error">{error}</div>}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button className="btn btn-primary" onClick={handleReflectionSubmit} disabled={busy}>
                {busy ? "Saving..." : "Save"}
              </button>
              <button className="btn btn-secondary" onClick={handleReflectionSkip} disabled={busy}>
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {wizardOpen && (
        <div className="wizard-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) handleWizardClose();
        }}>
          <div className="wizard-modal">
            <div className="wizard-header">
              <button className="btn-wizard-close" onClick={handleWizardClose}>×</button>
              <div className="wizard-title-row">
                <div className="wizard-title">{decisions.find(d => d.id === wizardOpen)?.title || "Refine Goal"}</div>
                <div className="wizard-step">Step {wizardStep === 'clarity' ? '1' : '2'} of 2</div>
              </div>
            </div>

            <div className="wizard-progress-bar">
              <div className="wizard-progress-fill" style={{ width: wizardStep === 'clarity' ? '50%' : '100%' }} />
            </div>

            <div className="wizard-content">
              {wizardStep === 'clarity' && (
                <>
                  <p className="wizard-description">
                    Define what success looks like to stay focused and measure progress.
                  </p>

                  <div className="wizard-clarity-field">
                    <div className="wizard-field-header">
                      <label className="wizard-field-label">
                        <span className="wizard-field-label-icon">🎯</span>
                        What does success look like?
                      </label>
                      <button
                        type="button"
                        className="btn-suggest"
                        onClick={() => handleSuggestField('outcome')}
                        disabled={loadingSuggestions !== null}
                      >
                        {loadingSuggestions === 'outcome' ? '...' : '✨ Suggest'}
                      </button>
                    </div>
                    <textarea
                      className="wizard-field-input"
                      rows={3}
                      value={wizardData.outcome}
                      onChange={(e) => setWizardData({ ...wizardData, outcome: e.target.value })}
                      placeholder="e.g., All team members feel heard in meetings"
                    />
                    <div className="wizard-field-hint">Describe the desired end state</div>
                  </div>

                  <div className="wizard-clarity-field">
                    <div className="wizard-field-header">
                      <label className="wizard-field-label">
                        <span className="wizard-field-label-icon">📊</span>
                        How will you measure it?
                      </label>
                      <button
                        type="button"
                        className="btn-suggest"
                        onClick={() => handleSuggestField('metric')}
                        disabled={loadingSuggestions !== null}
                      >
                        {loadingSuggestions === 'metric' ? '...' : '✨ Suggest'}
                      </button>
                    </div>
                    <input
                      className="wizard-field-input"
                      type="text"
                      value={wizardData.metric}
                      onChange={(e) => setWizardData({ ...wizardData, metric: e.target.value })}
                      placeholder="e.g., Weekly satisfaction score"
                    />
                    <div className="wizard-field-hint">What number tells you it's working?</div>
                  </div>

                  <div className="wizard-clarity-field">
                    <div className="wizard-field-header">
                      <label className="wizard-field-label">
                        <span className="wizard-field-label-icon">📅</span>
                        By when?
                      </label>
                      <button
                        type="button"
                        className="btn-suggest"
                        onClick={() => setShowHorizonPicker(!showHorizonPicker)}
                      >
                        {showHorizonPicker ? 'Type instead' : '📅 Quick pick'}
                      </button>
                    </div>

                    {showHorizonPicker ? (
                      <div className="horizon-picker">
                        <div className="horizon-chips">
                          {[
                            { days: 3, label: '3 days' },
                            { days: 7, label: '1 week' },
                            { days: 14, label: '2 weeks' },
                            { days: 28, label: '4 weeks' },
                          ].map((option) => (
                            <button
                              key={option.days}
                              type="button"
                              className={`horizon-chip ${wizardData.horizon === option.label ? 'horizon-chip-selected' : ''}`}
                              onClick={() => handleSelectHorizonChip(option.days)}
                            >
                              {option.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            className={`horizon-chip ${wizardData.horizon === 'End of month' ? 'horizon-chip-selected' : ''}`}
                            onClick={() => handleSelectHorizonRelative('month')}
                          >
                            End of month
                          </button>
                          <button
                            type="button"
                            className={`horizon-chip ${wizardData.horizon.startsWith('End of Q') ? 'horizon-chip-selected' : ''}`}
                            onClick={() => handleSelectHorizonRelative('quarter')}
                          >
                            End of quarter
                          </button>
                        </div>
                      </div>
                    ) : (
                      <input
                        className="wizard-field-input"
                        type="text"
                        value={wizardData.horizon}
                        onChange={(e) => setWizardData({ ...wizardData, horizon: e.target.value })}
                        placeholder="e.g., End of Q1"
                      />
                    )}
                    <div className="wizard-field-hint">Set a realistic timeline</div>
                  </div>
                </>
              )}

              {wizardStep === 'actions' && (
                <div className="wizard-actions-section">
                  <p className="wizard-description">
                    Pick actions to start today. These will become concrete tasks under your goal.
                  </p>

                  {generating ? (
                    <div className="wizard-loading">
                      <div className="skeleton-card" />
                      <div className="skeleton-card" />
                      <div className="skeleton-card" />
                    </div>
                  ) : (
                    <>
                      {(suggestionStore[wizardOpen] ?? [])
                        .filter(s => s.lifecycle === 'new' && s.kind !== 'outcome' && s.kind !== 'metric' && s.kind !== 'horizon')
                        .slice(0, 4)
                        .map((s) => (
                          <label key={s.id} className="wizard-action-checkbox">
                            <input
                              type="checkbox"
                              checked={wizardData.selectedActions.includes(s.title)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setWizardData({
                                    ...wizardData,
                                    selectedActions: [...wizardData.selectedActions, s.title],
                                  });
                                } else {
                                  setWizardData({
                                    ...wizardData,
                                    selectedActions: wizardData.selectedActions.filter(a => a !== s.title),
                                  });
                                }
                              }}
                            />
                            <div className="wizard-action-content">
                              <div className="wizard-action-title">{s.title}</div>
                              {s.rationale && <div className="wizard-action-rationale">{s.rationale}</div>}
                            </div>
                          </label>
                        ))}

                      <div className="wizard-custom-action-field">
                        <input
                          type="text"
                          value={wizardData.customAction}
                          onChange={(e) => setWizardData({ ...wizardData, customAction: e.target.value })}
                          placeholder="+ Add your own action"
                        />
                        <button
                          className="btn-wizard-add-custom"
                          disabled={!wizardData.customAction.trim()}
                          onClick={() => {
                            if (wizardData.customAction.trim()) {
                              setWizardData({
                                ...wizardData,
                                selectedActions: [...wizardData.selectedActions, wizardData.customAction.trim()],
                                customAction: '',
                              });
                            }
                          }}
                        >
                          Add
                        </button>
                      </div>

                      {wizardData.selectedActions.length > 0 && (
                        <div className="wizard-selected-actions">
                          <div className="wizard-section-label">Selected actions</div>
                          {wizardData.selectedActions.map((action, i) => (
                            <div key={i} className="wizard-action-chip">
                              <span>{action}</span>
                              <button
                                className="btn-remove-action"
                                onClick={() => {
                                  setWizardData({
                                    ...wizardData,
                                    selectedActions: wizardData.selectedActions.filter((_, idx) => idx !== i),
                                  });
                                }}
                              >×</button>
                            </div>
                          ))}
                        </div>
                      )}

                      {(suggestionStore[wizardOpen] ?? [])
                        .filter(s => s.lifecycle === 'new' && s.kind !== 'outcome' && s.kind !== 'metric' && s.kind !== 'horizon')
                        .length === 0 && wizardData.selectedActions.length === 0 && (
                        <div className="wizard-empty-state">
                          No suggestions yet. Add your own actions above or skip to add them later.
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="wizard-footer">
              {wizardStep === 'clarity' ? (
                <>
                  <button className="btn-wizard-skip" onClick={() => handleWizardClarityComplete(true)}>
                    Skip for now
                  </button>
                  <button className="btn-wizard-continue" onClick={() => handleWizardClarityComplete(false)}>
                    Continue →
                  </button>
                </>
              ) : (
                <>
                  <button className="btn-wizard-back" onClick={() => setWizardStep('clarity')}>
                    ← Back
                  </button>
                  <button
                    className="btn-wizard-finish"
                    onClick={handleWizardActionsComplete}
                    disabled={wizardData.selectedActions.length === 0}
                  >
                    Add {wizardData.selectedActions.length} action{wizardData.selectedActions.length !== 1 ? 's' : ''}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showReflectionSheet && reflectionSheetData && (
        <div className="wizard-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) handleReflectionSheetSkip();
        }}>
          <div className="wizard-modal reflection-sheet-modal">
            <div className="wizard-header">
              <button className="btn-wizard-close" onClick={handleReflectionSheetSkip}>×</button>
              <div className="wizard-title-row">
                <div className="wizard-title">Quick Reflection</div>
                <div className="wizard-step">What helped or slowed you down?</div>
              </div>
            </div>

            <div className="wizard-content">
              <p className="wizard-description">
                Help us understand your experience to provide better suggestions.
              </p>

              <div className="reflection-signals">
                <div className="wizard-section-label">Select what applies</div>
                <div className="signal-chips">
                  {[
                    { id: 'clear_step', label: 'Clear step', icon: '✓' },
                    { id: 'enough_time', label: 'Enough time', icon: '⏱' },
                    { id: 'context_switching', label: 'Context switching', icon: '↔' },
                    { id: 'low_energy', label: 'Low energy', icon: '🔋' },
                    { id: 'unclear_action', label: 'Unclear action', icon: '?' },
                  ].map((signal) => (
                    <button
                      key={signal.id}
                      className={`signal-chip ${reflectionSignals.includes(signal.id) ? 'signal-chip-selected' : ''}`}
                      onClick={() => toggleReflectionSignal(signal.id)}
                    >
                      <span className="signal-chip-icon">{signal.icon}</span>
                      <span className="signal-chip-label">{signal.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="wizard-clarity-field">
                <label className="wizard-field-label">
                  Note (optional)
                </label>
                <textarea
                  className="wizard-field-input"
                  rows={2}
                  maxLength={140}
                  value={reflectionNote}
                  onChange={(e) => setReflectionNote(e.target.value)}
                  placeholder="Any additional context..."
                />
                <div className="wizard-field-hint">
                  {reflectionNote.length}/140 characters
                </div>
              </div>
            </div>

            <div className="wizard-footer">
              {error && <div className="wizard-error">{error}</div>}
              <button className="btn-wizard-skip" onClick={handleReflectionSheetSkip} disabled={busy}>
                Skip
              </button>
              <button
                className="btn-wizard-continue"
                onClick={handleReflectionSheetSave}
                disabled={reflectionSignals.length === 0 || busy}
              >
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {!briefingDismissed[getTodayKey()] && (
        <div className="daily-briefing-card">
          {!briefing ? (
            <div className="briefing-prompt">
              <h2>Daily Briefing</h2>
              <p>Get your personalized focus for today</p>
              <button
                className="btn btn-primary"
                disabled={briefingLoading}
                onClick={handleBriefing}
              >
                {briefingLoading ? "Loading…" : "Generate briefing"}
              </button>
            </div>
          ) : (
            <div className="briefing-content">
              <div className="briefing-header-row">
                <div>
                  <div className="briefing-greeting">{briefing.greeting}</div>
                  <div className="briefing-headline">{briefing.headline}</div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {streak > 0 && (
                    <div className="streak-indicator">
                      🔥 {streak}-day streak
                    </div>
                  )}
                  <button
                    className="btn btn-dismiss-briefing"
                    onClick={handleDismissBriefing}
                    title="Hide until tomorrow"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="briefing-focus-list">
                {briefing.focus.map((item, i) => (
                  <div key={i} className="briefing-focus-item">
                    <div className="briefing-focus-content">
                      <span className="briefing-focus-goal">{item.goalTitle}</span>
                      <span className="briefing-focus-why">{item.whyNow}</span>
                      <div className="briefing-action-tag">
                        {item.action.actionTitle}
                      </div>
                    </div>
                    <button
                      className="btn btn-action-small"
                      onClick={() => handleBriefingAction(item)}
                      disabled={busy}
                    >
                      {item.action.type === "create_new_action" ? "Add" : "Start"}
                    </button>
                  </div>
                ))}
              </div>

              {!commitments[getTodayKey()] && (
                <div className="briefing-cta-section">
                  <button
                    className="btn btn-commitment"
                    onClick={handleCommitment}
                  >
                    {briefing.cta.label}
                  </button>
                  <p className="briefing-cta-microcopy">{briefing.cta.microcopy}</p>
                </div>
              )}

              {commitments[getTodayKey()] && (
                <div className="commitment-confirmed">
                  <span>✓ Committed for today</span>
                  <button
                    className="btn btn-dismiss-briefing"
                    onClick={handleDismissBriefing}
                    title="Close"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          )}
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
                  <div className="decision-card-header">
                    <div className="decision-card-main">
                      <ClarityRing score={clarityScore(d)} />
                      <div className="decision-content">
                        <div className="decision-title-row">
                          <span className="decision-title">{d.title}</span>
                          <span className="decision-id">#{d.id}</span>
                        </div>
                        {hasDetails && (
                          <div className="goal-chips">
                            {d.outcome && <div className="goal-chip goal-chip-outcome" title="Outcome">🎯 {d.outcome}</div>}
                            {d.metric && <div className="goal-chip goal-chip-metric" title="Metric">📊 {d.metric}</div>}
                            {d.horizon && <div className="goal-chip goal-chip-horizon" title="Horizon">📅 {d.horizon}</div>}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="decision-card-actions">
                      {d.status !== "done" && (
                        <button
                          className="btn btn-refine"
                          onClick={() => handleRefineGoal(d.id)}
                        >
                          Refine
                        </button>
                      )}
                      {d.status === "todo" && (
                        <button className="btn btn-start" disabled={busy} onClick={() => handleStart(d.id)}>Start</button>
                      )}
                      {d.status === "in-progress" && (
                        <button className="btn btn-done" disabled={busy} onClick={() => handleDone(d.id)}>Done</button>
                      )}
                    </div>
                  </div>
                </div>

                {d.status !== "done" && allSuggestions.length > 0 && (
                  <div className="card-toggles">
                    <button
                      className={`toggle-btn ${isSuggestionsOpen ? "toggle-btn-open" : ""}`}
                      onClick={() => toggleSuggestions(d.id)}
                    >
                      {isSuggestionsOpen ? "\u25bc" : "\u25b6"} Coach
                    </button>
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
