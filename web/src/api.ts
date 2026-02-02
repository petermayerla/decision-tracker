const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3333";

type Decision = {
  id: number;
  title: string;
  status: "todo" | "in-progress" | "done";
  outcome?: string;
  metric?: string;
  horizon?: string;
  parentId?: number;
  kind?: "goal" | "action";
};

type DecisionPatch = {
  outcome?: string;
  metric?: string;
  horizon?: string;
};

type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

type SuggestionLifecycle = "new" | "applied" | "dismissed";

type Suggestion = {
  id: string;
  title: string;
  rationale: string;
  kind?: string;
  outcome?: string;
  metric?: string;
  horizon?: string;
  lifecycle: SuggestionLifecycle;
};

type RawSuggestion = Omit<Suggestion, "id" | "lifecycle">;

type ReflectionAnswer = { promptId: string; value: string };

type Reflection = {
  decisionId: number;
  createdAt: string;
  answers: ReflectionAnswer[];
};

type BriefingFocusItem = {
  goalId: number;
  goalTitle: string;
  whyNow: string;
  action: {
    type: "start_existing_action" | "finish_existing_action" | "create_new_action";
    actionId?: number;
    actionTitle: string;
  };
};

type MorningBriefing = {
  greeting: string;
  headline: string;
  focus: BriefingFocusItem[];
  cta: { label: string; microcopy: string };
};

export type { SuggestionLifecycle, RawSuggestion, ReflectionAnswer, Reflection, BriefingFocusItem, MorningBriefing };

export type { Decision, DecisionPatch, ApiResult, Suggestion };

export async function fetchDecisions(status?: string): Promise<ApiResult<Decision[]>> {
  const url = status ? `${BASE}/tasks?status=${status}` : `${BASE}/tasks`;
  const res = await fetch(url);
  return res.json();
}

export async function addDecision(title: string, opts?: { parentId?: number; kind?: "goal" | "action" }): Promise<ApiResult<Decision>> {
  const res = await fetch(`${BASE}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, ...opts }),
  });
  return res.json();
}

export async function patchDecision(id: number, patch: DecisionPatch): Promise<ApiResult<Decision>> {
  const res = await fetch(`${BASE}/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.json();
}

export async function generateSuggestions(decision: Decision, reflections?: Reflection[]): Promise<ApiResult<{ suggestions: RawSuggestion[] }>> {
  const res = await fetch(`${BASE}/suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: decision.id,
      title: decision.title,
      status: decision.status,
      outcome: decision.outcome,
      metric: decision.metric,
      horizon: decision.horizon,
      reflections: reflections && reflections.length > 0 ? reflections : undefined,
    }),
  });
  return res.json();
}

export async function startDecision(id: number): Promise<ApiResult<Decision>> {
  const res = await fetch(`${BASE}/tasks/${id}/start`, { method: "POST" });
  return res.json();
}

export async function completeDecision(id: number): Promise<ApiResult<Decision>> {
  const res = await fetch(`${BASE}/tasks/${id}/done`, { method: "POST" });
  return res.json();
}

export async function fetchBriefing(reflections?: Reflection[]): Promise<ApiResult<MorningBriefing>> {
  const res = await fetch(`${BASE}/briefing`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reflections: reflections && reflections.length > 0 ? reflections : undefined,
    }),
  });
  return res.json();
}

export async function resetDecisions(): Promise<ApiResult<Decision[]>> {
  const res = await fetch(`${BASE}/reset`, { method: "POST" });
  return res.json();
}
