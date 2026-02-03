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

/**
 * Centralized API fetch wrapper with consistent error handling
 */
async function apiFetch<T>(url: string, options: RequestInit, includeLang = false): Promise<ApiResult<T>> {
  try {
    const headers = getHeaders(includeLang);
    const res = await fetch(url, {
      ...options,
      headers: { ...headers, ...options.headers },
    });

    if (!res.ok) {
      // Handle non-200 responses
      let errorMessage = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const errorJson = await res.json();
        if (errorJson.error?.message) {
          errorMessage = errorJson.error.message;
        }
      } catch {
        // If JSON parsing fails, use the default message
      }
      return {
        ok: false,
        error: { code: `HTTP_${res.status}`, message: errorMessage },
      };
    }

    const json = await res.json();
    return json;
  } catch (err) {
    // Network errors, CORS failures, etc.
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: { code: "NETWORK_ERROR", message: `Request failed: ${errorMessage}` },
    };
  }
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
  return apiFetch(url, { method: "GET" }, false);
}

export async function addDecision(title: string, opts?: { parentId?: number; kind?: "goal" | "action" }): Promise<ApiResult<Decision>> {
  return apiFetch(`${BASE}/tasks`, {
    method: "POST",
    body: JSON.stringify({ title, ...opts }),
  }, false);
}

export async function patchDecision(id: number, patch: DecisionPatch): Promise<ApiResult<Decision>> {
  return apiFetch(`${BASE}/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }, false);
}

export async function generateSuggestions(decision: Decision, reflections?: Reflection[]): Promise<ApiResult<{ suggestions: RawSuggestion[] }>> {
  return apiFetch(`${BASE}/suggestions`, {
    method: "POST",
    body: JSON.stringify({
      id: decision.id,
      title: decision.title,
      status: decision.status,
      outcome: decision.outcome,
      metric: decision.metric,
      horizon: decision.horizon,
      reflections: reflections && reflections.length > 0 ? reflections : undefined,
    }),
  }, true); // Include language header for LLM output
}

export async function startDecision(id: number): Promise<ApiResult<Decision>> {
  return apiFetch(`${BASE}/tasks/${id}/start`, { method: "POST" }, false);
}

export async function completeDecision(id: number): Promise<ApiResult<Decision>> {
  return apiFetch(`${BASE}/tasks/${id}/done`, { method: "POST" }, false);
}

export async function fetchBriefing(reflections?: Reflection[], userName?: string): Promise<ApiResult<MorningBriefing>> {
  return apiFetch(`${BASE}/briefing`, {
    method: "POST",
    body: JSON.stringify({
      reflections: reflections && reflections.length > 0 ? reflections : undefined,
      userName,
    }),
  }, true); // Include language header for LLM output
}

export async function resetDecisions(): Promise<ApiResult<Decision[]>> {
  return apiFetch(`${BASE}/reset`, { method: "POST" }, false);
}

export async function submitReflection(input: ReflectionInput): Promise<ApiResult<ReflectionData>> {
  return apiFetch(`${BASE}/reflections`, {
    method: "POST",
    body: JSON.stringify(input),
  }, false);
}
