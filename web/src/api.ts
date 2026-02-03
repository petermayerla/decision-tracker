const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3333";

// Language header for LLM output
let currentLanguage: string = 'en';

export function setApiLanguage(lang: string): void {
  currentLanguage = lang;
}

function getHeaders(includeLanguage = false): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (includeLanguage) {
    headers["X-App-Lang"] = currentLanguage;
  }
  return headers;
}

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

type ReflectionData = {
  id: string;
  createdAt: string;
  goalId: number;
  actionId?: number;
  signals?: string[];
  note?: string;
  answers?: Array<{ promptId: string; value: string }>;
};

type ReflectionInput = {
  goalId: number;
  actionId?: number;
  signals?: string[];
  note?: string;
  answers?: Array<{ promptId: string; value: string }>;
};

export type { SuggestionLifecycle, RawSuggestion, ReflectionAnswer, Reflection, BriefingFocusItem, MorningBriefing, ReflectionData, ReflectionInput };

export type { Decision, DecisionPatch, ApiResult, Suggestion };

export async function fetchDecisions(status?: string): Promise<ApiResult<Decision[]>> {
  const url = status ? `${BASE}/tasks?status=${status}` : `${BASE}/tasks`;
  const res = await fetch(url);
  return res.json();
}

export async function addDecision(title: string, opts?: { parentId?: number; kind?: "goal" | "action" }): Promise<ApiResult<Decision>> {
  const res = await fetch(`${BASE}/tasks`, {
    method: "POST",
    headers: getHeaders(false),
    body: JSON.stringify({ title, ...opts }),
  });
  return res.json();
}

export async function patchDecision(id: number, patch: DecisionPatch): Promise<ApiResult<Decision>> {
  const res = await fetch(`${BASE}/tasks/${id}`, {
    method: "PATCH",
    headers: getHeaders(false),
    body: JSON.stringify(patch),
  });
  return res.json();
}

export async function generateSuggestions(decision: Decision, reflections?: Reflection[]): Promise<ApiResult<{ suggestions: RawSuggestion[] }>> {
  const res = await fetch(`${BASE}/suggestions`, {
    method: "POST",
    headers: getHeaders(true), // Include language header for LLM output
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

export async function fetchBriefing(reflections?: Reflection[], userName?: string): Promise<ApiResult<MorningBriefing>> {
  const res = await fetch(`${BASE}/briefing`, {
    method: "POST",
    headers: getHeaders(true), // Include language header for LLM output
    body: JSON.stringify({
      reflections: reflections && reflections.length > 0 ? reflections : undefined,
      userName,
    }),
  });
  return res.json();
}

export async function resetDecisions(): Promise<ApiResult<Decision[]>> {
  const res = await fetch(`${BASE}/reset`, { method: "POST" });
  return res.json();
}

export async function submitReflection(input: ReflectionInput): Promise<ApiResult<ReflectionData>> {
  const res = await fetch(`${BASE}/reflections`, {
    method: "POST",
    headers: getHeaders(false),
    body: JSON.stringify(input),
  });
  return res.json();
}
