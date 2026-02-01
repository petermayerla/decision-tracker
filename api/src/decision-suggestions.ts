/**
 * Agentic suggestion provider for decisions.
 * Deterministic heuristics — no LLM calls.
 * Suggestions depend on: decision type, field completeness, similar decisions, tracker state.
 */

export type DecisionInput = {
  id: number;
  title: string;
  status?: string;
  outcome?: string;
  metric?: string;
  horizon?: string;
};

export type SuggestionKind =
  | "next-action" | "split" | "review" | "follow-up" | "cleanup"
  | "outcome" | "metric" | "horizon" | "execution" | "reuse" | "validation";

export type Suggestion = {
  title: string;
  rationale: string;
  kind: SuggestionKind;
  outcome?: string;
  metric?: string;
  horizon?: string;
};

// ── Helpers ──

function normalize(s: string): string {
  return s.toLowerCase().replace(/^action:\s*/i, "").replace(/\s+/g, " ").trim();
}

function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(" ").filter((t) => t.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function isActionPrefixed(title: string): boolean {
  return /^action:/i.test(title.trim());
}

// ── Decision type classifier ──

type DecisionType = "habit" | "study" | "product" | "vendor" | "strategy" | "general";

const TYPE_KEYWORDS: Record<Exclude<DecisionType, "general">, RegExp> = {
  habit: /\b(habit|smoke|smoking|run|running|fitness|exercise|meditat|sleep|diet|drink|sober|gym|walk|yoga)\b/i,
  study: /\b(exam|university|learn|course|study|studying|certif|degree|class|lecture|tutor|homework|grade)\b/i,
  product: /\b(onboarding|feature|ux|ui|requirements|sprint|release|deploy|ship|mvp|prototype|a\/b|activation|retention)\b/i,
  vendor: /\b(vendor|provider|tool|contract|saas|integration|migrate|analytics vendor|procurement|rfp)\b/i,
  strategy: /\b(pricing|strategy|roadmap|positioning|revenue|market|competitive|growth|okr|quarterly|q[1-4])\b/i,
};

function classifyDecision(d: DecisionInput): DecisionType {
  const text = `${d.title} ${d.outcome ?? ""} ${d.metric ?? ""}`;
  for (const [type, re] of Object.entries(TYPE_KEYWORDS) as [Exclude<DecisionType, "general">, RegExp][]) {
    if (re.test(text)) return type;
  }
  return "general";
}

// ── Ambiguous-verb detector ──

const AMBIGUOUS_VERBS = /\b(improve|optimize|prepare|fix|enhance|streamline|revamp|boost|refine|address)\b/i;

function hasAmbiguousVerb(title: string): boolean {
  return AMBIGUOUS_VERBS.test(title);
}

// ── Per-type suggestion templates ──

type Template = {
  title: string;
  rationale: string;
  kind: SuggestionKind;
  outcome?: string;
  metric?: string;
  horizon?: string;
  /** "missing" = only when fields are missing, "complete" = only when all fields filled, "any" = always eligible */
  when: "missing" | "complete" | "any";
  /** Which missing field this fills (for ranking) */
  fills?: "outcome" | "metric" | "horizon";
};

function buildTemplates(d: DecisionInput, dtype: DecisionType): Template[] {
  const n = normalize(d.title);
  const templates: Template[] = [];

  // ── Type-specific completeness templates ──
  if (dtype === "habit") {
    templates.push(
      { title: `Set a 30-day target for "${n}"`, rationale: "A 30-day window is long enough to build a habit, short enough to stay motivated.", kind: "next-action", outcome: `Maintain ${n} for 30 consecutive days`, horizon: "30 days", when: "missing", fills: "outcome" },
      { title: `Choose a daily tracking metric for "${n}"`, rationale: "Daily tracking creates feedback loops that reinforce behavior.", kind: "next-action", metric: "Days streak", when: "missing", fills: "metric" },
      { title: `Identify your trigger and replacement routine`, rationale: "Habit change works best when you design the cue-routine-reward loop.", kind: "next-action", when: "missing", fills: "outcome" },
      { title: `Schedule a weekly reflection on "${n}"`, rationale: "Weekly check-ins catch drift before it becomes a relapse.", kind: "review", horizon: "1 week", when: "any" },
      { title: `Design an accountability system (partner or app)`, rationale: "External accountability doubles follow-through rates.", kind: "next-action", when: "complete" },
      { title: `Define what 'done' looks like — is this permanent or time-boxed?`, rationale: "Clarity on the end state prevents goal fatigue.", kind: "next-action", outcome: `${n} sustained for target period`, when: "missing", fills: "outcome" },
    );
  } else if (dtype === "study") {
    templates.push(
      { title: `Set a target score or grade for this`, rationale: "A concrete target turns studying from open-ended to focused.", kind: "next-action", outcome: "Target grade/score achieved", when: "missing", fills: "outcome" },
      { title: `Estimate hours needed and schedule study blocks`, rationale: "Time-boxing prevents both under-preparation and burnout.", kind: "next-action", metric: "Study hours completed", horizon: "exam date", when: "missing", fills: "metric" },
      { title: `Create a practice test or flashcard set`, rationale: "Active recall outperforms passive review by 2–3x.", kind: "next-action", when: "any" },
      { title: `Identify the 3 highest-weight topics`, rationale: "Pareto: 20% of topics often cover 80% of the exam.", kind: "split", when: "missing", fills: "outcome" },
      { title: `Schedule a mock exam 1 week before deadline`, rationale: "A dry run reveals gaps while there's still time to fix them.", kind: "review", when: "complete" },
    );
  } else if (dtype === "product") {
    templates.push(
      { title: `Define the activation event for this feature`, rationale: "Users who hit the activation event retain 3–5x better.", kind: "next-action", outcome: "Users reach activation event", metric: "Activation rate (%)", when: "missing", fills: "outcome" },
      { title: `Write a one-line success criterion`, rationale: "If you can't state success in one line, the scope is too broad.", kind: "next-action", outcome: "Feature shipped and adoption measured", when: "missing", fills: "outcome" },
      { title: `Identify the riskiest assumption and design a test`, rationale: "Testing assumptions early saves weeks of wasted build time.", kind: "next-action", when: "any" },
      { title: `Set a ship date and work backward`, rationale: "Fixed deadlines force scope decisions that improve focus.", kind: "next-action", horizon: "this sprint", when: "missing", fills: "horizon" },
      { title: `Draft a 3-bullet release note`, rationale: "Writing the announcement first clarifies what actually matters to users.", kind: "next-action", when: "complete" },
      { title: `Run a 30-min stakeholder alignment check`, rationale: "Misaligned stakeholders are the #1 cause of late-stage rework.", kind: "review", when: "complete" },
    );
  } else if (dtype === "vendor") {
    templates.push(
      { title: `List 3 must-have criteria before evaluating vendors`, rationale: "Without criteria, vendor selection devolves into feature-count comparison.", kind: "next-action", outcome: "Evaluation criteria documented", when: "missing", fills: "outcome" },
      { title: `Set a decision deadline to avoid analysis paralysis`, rationale: "Vendor decisions expand to fill available time — set a hard stop.", kind: "next-action", horizon: "2 weeks", when: "missing", fills: "horizon" },
      { title: `Request a trial or sandbox from top 2 candidates`, rationale: "Hands-on testing reveals integration pain that demos hide.", kind: "next-action", metric: "Integration time (hours)", when: "missing", fills: "metric" },
      { title: `Calculate total cost of ownership (not just license)`, rationale: "Migration, training, and maintenance often exceed the sticker price.", kind: "next-action", metric: "Total cost of ownership ($)", when: "any" },
      { title: `Write a 1-page decision memo for stakeholders`, rationale: "A written rationale prevents re-litigation later.", kind: "review", when: "complete" },
    );
  } else if (dtype === "strategy") {
    templates.push(
      { title: `Define the single metric this strategy should move`, rationale: "Strategy without a metric is just a wish.", kind: "next-action", metric: "Primary KPI", when: "missing", fills: "metric" },
      { title: `Identify the top 3 risks to this strategy`, rationale: "Naming risks early turns surprises into contingencies.", kind: "next-action", outcome: "Risk register created", when: "missing", fills: "outcome" },
      { title: `Set a 90-day checkpoint`, rationale: "Quarterly review cycles match natural business rhythms.", kind: "next-action", horizon: "90 days", when: "missing", fills: "horizon" },
      { title: `Draft a one-page strategy brief`, rationale: "If you can't fit it on one page, the strategy isn't clear enough.", kind: "next-action", when: "any" },
      { title: `Run a pre-mortem: assume it failed — why?`, rationale: "Pre-mortems surface blind spots that optimism hides.", kind: "review", when: "complete" },
      { title: `Align with one key stakeholder this week`, rationale: "Early alignment prevents costly pivots later.", kind: "next-action", when: "any" },
    );
  } else {
    // general
    templates.push(
      { title: `Write a one-sentence success definition`, rationale: "If you can't state success simply, the goal needs sharpening.", kind: "next-action", outcome: `${n} completed successfully`, when: "missing", fills: "outcome" },
      { title: `Pick a single number to track progress`, rationale: "One metric beats a dashboard — it forces clarity.", kind: "next-action", metric: "Progress indicator", when: "missing", fills: "metric" },
      { title: `Set a 2-week deadline`, rationale: "Short deadlines create urgency; extend later if needed.", kind: "next-action", horizon: "2 weeks", when: "missing", fills: "horizon" },
      { title: `Identify the first concrete next step (< 30 min)`, rationale: "Tiny first steps overcome inertia.", kind: "next-action", when: "any" },
      { title: `Ask: what would make me abandon this? Write it down`, rationale: "Kill criteria prevent sunk-cost traps.", kind: "review", when: "complete" },
      { title: `Schedule a check-in with someone who cares about this`, rationale: "Social accountability increases follow-through.", kind: "review", when: "any" },
    );
  }

  return templates;
}

// ── Main ──

export function generateSuggestions(
  decision: DecisionInput,
  allDecisions: DecisionInput[] = [],
): Suggestion[] {
  const { title, outcome, metric, horizon } = decision;
  const dtype = classifyDecision(decision);
  const isAction = isActionPrefixed(title);
  const isComplete = !!(outcome && metric && horizon);
  const missingFields = [
    !outcome && "outcome",
    !metric && "metric",
    !horizon && "horizon",
  ].filter(Boolean) as ("outcome" | "metric" | "horizon")[];

  const candidates: Suggestion[] = [];

  // ─── 1) Type-aware templates ───
  const templates = buildTemplates(decision, dtype);

  // Filter templates by completeness state
  const eligible = templates.filter((t) => {
    if (t.when === "any") return true;
    if (t.when === "missing" && !isComplete) return true;
    if (t.when === "complete" && isComplete) return true;
    return false;
  });

  // Rank: templates that fill the highest-priority missing field first
  const fieldPriority: Record<string, number> = { outcome: 0, metric: 1, horizon: 2 };
  eligible.sort((a, b) => {
    const pa = a.fills ? fieldPriority[a.fills] : 10;
    const pb = b.fills ? fieldPriority[b.fills] : 10;
    return pa - pb;
  });

  // Pick up to 2 field-filling templates (avoid duplicating same field)
  const filledFields = new Set<string>();
  for (const t of eligible) {
    if (candidates.length >= 2) break;
    if (t.fills && filledFields.has(t.fills)) continue;
    if (t.fills) filledFields.add(t.fills);
    candidates.push({ title: t.title, rationale: t.rationale, kind: t.kind, outcome: t.outcome, metric: t.metric, horizon: t.horizon });
  }

  // Pick 1 non-filling template for variety
  for (const t of eligible) {
    if (candidates.length >= 3) break;
    if (candidates.some((c) => c.title === t.title)) continue;
    if (t.fills && filledFields.has(t.fills)) continue;
    candidates.push({ title: t.title, rationale: t.rationale, kind: t.kind, outcome: t.outcome, metric: t.metric, horizon: t.horizon });
  }

  // ─── 2) Ambiguous-verb heuristic ───
  if (hasAmbiguousVerb(title) && !metric) {
    const verb = title.match(AMBIGUOUS_VERBS)?.[0]?.toLowerCase() ?? "improve";
    candidates.push({
      title: `Replace "${verb}" with a measurable target`,
      rationale: `"${verb}" is ambiguous — a proxy metric makes progress visible.`,
      kind: "next-action",
      metric: `${normalize(title)} score`,
    });
  }

  // ─── 3) Action-prefix handling ───
  if (isAction) {
    // Remove any "break into steps" that might have slipped in
    const filtered = candidates.filter((c) => !/break.*into.*step/i.test(c.title));
    candidates.length = 0;
    candidates.push(...filtered);

    if (!outcome) {
      candidates.push({
        title: "Define acceptance criteria for this action",
        rationale: "Clear criteria prevent scope creep on action items.",
        kind: "next-action",
        outcome: `${normalize(title)} completed and verified`,
      });
    }
    if (!metric) {
      candidates.push({
        title: "Add a measurable done-check",
        rationale: "Even small actions benefit from a concrete completion signal.",
        kind: "next-action",
        metric: "Done check (yes/no)",
      });
    }
  }

  // ─── 4) Similarity reuse ───
  const myTokens = tokens(title);
  let bestScore = 0;
  let bestMatch: DecisionInput | null = null;

  for (const other of allDecisions) {
    if (other.id === decision.id) continue;
    const score = jaccard(myTokens, tokens(other.title));
    if (score > bestScore) {
      bestScore = score;
      bestMatch = other;
    }
  }

  if (bestMatch && bestScore >= 0.25) {
    // Pick the single most valuable field to reuse
    if (!outcome && bestMatch.outcome) {
      candidates.push({
        title: `Align outcome with "${bestMatch.title}"`,
        rationale: `Reuse "${bestMatch.outcome}" for consistency across related decisions.`,
        kind: "follow-up",
        outcome: bestMatch.outcome,
      });
    } else if (!metric && bestMatch.metric) {
      candidates.push({
        title: `Reuse metric from "${bestMatch.title}"`,
        rationale: `"${bestMatch.metric}" — consistent measurement across related decisions.`,
        kind: "follow-up",
        metric: bestMatch.metric,
      });
    } else if (!horizon && bestMatch.horizon) {
      candidates.push({
        title: `Align timeline with "${bestMatch.title}"`,
        rationale: `"${bestMatch.horizon}" — synchronize related decision timelines.`,
        kind: "follow-up",
        horizon: bestMatch.horizon,
      });
    }
  }

  // ─── 5) In-progress unblock suggestions ───
  if (decision.status === "in-progress" && isComplete) {
    const unblockOptions: Suggestion[] = [
      { title: "Schedule a 30-min stakeholder review", rationale: "External input often unblocks stalled decisions.", kind: "review" },
      { title: "Write a decision memo (1 page max)", rationale: "Writing forces clarity — if you can't write it, you can't decide it.", kind: "next-action" },
      { title: "Run a 30-min experiment to test your assumption", rationale: "Small experiments resolve uncertainty faster than analysis.", kind: "next-action" },
    ];
    // Pick one that isn't already in candidates
    for (const opt of unblockOptions) {
      if (!candidates.some((c) => c.title === opt.title)) {
        candidates.push(opt);
        break;
      }
    }
  }

  // ─── 6) Tracker-state suggestions (low priority, fill remaining slots) ───
  if (allDecisions.length > 0) {
    const todo = allDecisions.filter((d) => d.status === "todo").length;
    const inProgress = allDecisions.filter((d) => d.status === "in-progress").length;
    const done = allDecisions.filter((d) => d.status === "done").length;

    if (todo >= 4 && inProgress === 0) {
      candidates.push({
        title: "Pick one decision to start (10 min)",
        rationale: `${todo} decisions waiting — starting one builds momentum.`,
        kind: "review",
      });
    }
    if (inProgress >= 2) {
      candidates.push({
        title: "Pause one in-progress decision to reduce WIP",
        rationale: `${inProgress} decisions in flight — lower WIP improves throughput.`,
        kind: "cleanup",
      });
    }
    if (done >= 5) {
      candidates.push({
        title: "Review recent wins and plan next 3 decisions",
        rationale: `${done} completed — reflect before adding more.`,
        kind: "review",
      });
    }
  }

  // ─── Deduplicate and return max 3 (prefer 3, allow 4 if reuse adds value) ───
  const seen = new Set<string>();
  const unique: Suggestion[] = [];
  for (const s of candidates) {
    const key = s.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
    if (unique.length >= 3) break;
  }

  // Allow a 4th only if it's a reuse/follow-up suggestion not yet included
  if (unique.length === 3) {
    for (const s of candidates) {
      const key = s.title.toLowerCase();
      if (seen.has(key)) continue;
      if (s.kind === "follow-up") {
        unique.push(s);
        break;
      }
    }
  }

  return unique;
}

// ── LLM-backed suggestions (Anthropic Claude) ──

const SYSTEM_PROMPT = `You are an execution-focused decision coach.

Your task is to generate actionable, context-aware suggestions that reduce ambiguity and increase momentum for a single decision.

You receive:
- The current decision (id, title, optional outcome, metric, horizon)
- A list of all existing decisions (with their outcomes, metrics, horizons, and status)

You must infer what would most help this decision move forward.

Guidelines:
- Prefer concrete, specific suggestions over generic advice
- Avoid repeating information already present in the decision
- Do NOT suggest fields that are already clearly defined
- If the decision is complete, shift from clarification to execution
- If similar past decisions exist, reuse their structure where helpful
- Never suggest "break into steps" for decisions that already start with "Action:"
- Limit output to a maximum of 4 suggestions
- Deduplicate ideas aggressively

Suggestion kinds (use exactly these values):
- "outcome"       → clarifies what success looks like
- "metric"        → makes progress measurable
- "horizon"       → adds a deadline or time boundary
- "execution"     → concrete next actions or steps
- "reuse"         → reuse structure from a similar past decision
- "validation"    → checks assumptions, risks, or acceptance criteria

Output format:
Return ONLY valid JSON. Do not include any text outside JSON.

Each suggestion must follow this schema:

{
  "title": string,
  "rationale": string,
  "kind": "outcome" | "metric" | "horizon" | "execution" | "reuse" | "validation",
  "outcome"?: string,
  "metric"?: string,
  "horizon"?: string
}

Rules:
- Only include outcome/metric/horizon fields if the suggestion proposes a concrete value
- The rationale should explain why this suggestion helps THIS decision now
- Do not explain your reasoning process
- Do not mention that you are an AI`;

function buildUserPrompt(decision: DecisionInput, allDecisions: DecisionInput[]): string {
  const current = JSON.stringify(decision, null, 2);
  const others = allDecisions
    .filter((d) => d.id !== decision.id)
    .slice(0, 10);
  const otherJson = others.length > 0
    ? JSON.stringify(others, null, 2)
    : "[]";

  return `Current decision:\n${current}\n\nAll other decisions:\n${otherJson}`;
}

function parseLLMResponse(text: string): Suggestion[] {
  // Extract JSON array from response (handle markdown fences)
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const parsed = JSON.parse(cleaned);
  const arr: unknown[] = Array.isArray(parsed) ? parsed : parsed?.suggestions ?? [];

  const validKinds = new Set([
    "next-action", "split", "review", "follow-up", "cleanup",
    "outcome", "metric", "horizon", "execution", "reuse", "validation",
  ]);

  const results: Suggestion[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    if (typeof s.title !== "string" || typeof s.rationale !== "string") continue;
    const kind = validKinds.has(s.kind as string) ? (s.kind as SuggestionKind) : "next-action";
    const suggestion: Suggestion = { title: s.title, rationale: s.rationale, kind };
    if (typeof s.outcome === "string") suggestion.outcome = s.outcome;
    if (typeof s.metric === "string") suggestion.metric = s.metric;
    if (typeof s.horizon === "string") suggestion.horizon = s.horizon;
    results.push(suggestion);
    if (results.length >= 4) break;
  }
  return results;
}

export async function generateSuggestionsLLM(
  decision: DecisionInput,
  allDecisions: DecisionInput[] = [],
): Promise<Suggestion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback to deterministic
    return generateSuggestions(decision, allDecisions);
  }

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(decision, allDecisions) }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return generateSuggestions(decision, allDecisions);
    }

    const suggestions = parseLLMResponse(textBlock.text);
    if (suggestions.length === 0) {
      return generateSuggestions(decision, allDecisions);
    }
    return suggestions;
  } catch (err) {
    console.warn("LLM suggestion generation failed, falling back to deterministic:", err);
    return generateSuggestions(decision, allDecisions);
  }
}
