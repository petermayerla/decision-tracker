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
      { title: `Pick a 30-day window for "${n}"`, rationale: "Long enough to stick, short enough to feel real. Without a window this stays aspirational.", kind: "next-action", outcome: `Maintain ${n} for 30 consecutive days`, horizon: "30 days", when: "missing", fills: "outcome" },
      { title: `Track one number daily for "${n}"`, rationale: "Right now you have no feedback loop. A daily tally makes drift visible before it compounds.", kind: "next-action", metric: "Days streak", when: "missing", fills: "metric" },
      { title: `Name the trigger and the replacement routine`, rationale: "You can't change a habit you haven't mapped. Identifying the cue-routine pair turns willpower into design.", kind: "next-action", when: "missing", fills: "outcome" },
      { title: `Block 15 min each Sunday to review "${n}"`, rationale: "Without a regular check-in, small lapses go unnoticed until they become full relapses.", kind: "review", horizon: "1 week", when: "any" },
      { title: `Set up one accountability mechanism`, rationale: "You've defined the habit clearly — now add external friction. A partner or app makes skipping harder.", kind: "next-action", when: "complete" },
      { title: `Decide: is this permanent or time-boxed?`, rationale: "That distinction changes how you measure success. Pin it down so you know when you're done.", kind: "next-action", outcome: `${n} sustained for target period`, when: "missing", fills: "outcome" },
    );
  } else if (dtype === "study") {
    templates.push(
      { title: `Set a target score or grade`, rationale: "Without a number, studying has no natural stopping point. A target tells you when preparation is sufficient.", kind: "next-action", outcome: "Target grade/score achieved", when: "missing", fills: "outcome" },
      { title: `Estimate hours needed and block them on your calendar`, rationale: "You haven't time-boxed this yet. Unscheduled study time gets eaten by everything else.", kind: "next-action", metric: "Study hours completed", horizon: "exam date", when: "missing", fills: "metric" },
      { title: `Build a practice test from your weakest areas`, rationale: "Active recall beats re-reading. A practice test tells you what you actually know right now.", kind: "next-action", when: "any" },
      { title: `Identify the 3 highest-weight topics`, rationale: "Not all material is equal. Focusing on the top topics first gives you the most return per hour studied.", kind: "split", when: "missing", fills: "outcome" },
      { title: `Schedule a mock exam one week before the deadline`, rationale: "Everything is defined — now stress-test it. A dry run while there's still time to adjust.", kind: "review", when: "complete" },
    );
  } else if (dtype === "product") {
    templates.push(
      { title: `Define the activation event`, rationale: "You're building without knowing what 'adopted' looks like. Name the moment a user gets value.", kind: "next-action", outcome: "Users reach activation event", metric: "Activation rate (%)", when: "missing", fills: "outcome" },
      { title: `Write a one-line success criterion`, rationale: "If you can't state success in one sentence, the scope is still too fuzzy to build against.", kind: "next-action", outcome: "Feature shipped and adoption measured", when: "missing", fills: "outcome" },
      { title: `Find the riskiest assumption and design a quick test`, rationale: "There's at least one thing you're assuming that hasn't been validated. Finding it now saves build time later.", kind: "next-action", when: "any" },
      { title: `Set a ship date and cut scope to fit`, rationale: "No deadline means no forcing function. Pick a date, then decide what fits inside it.", kind: "next-action", horizon: "this sprint", when: "missing", fills: "horizon" },
      { title: `Draft a 3-bullet release note now`, rationale: "Writing the announcement before building clarifies what users will actually care about.", kind: "next-action", when: "complete" },
      { title: `Run a 30-min alignment check with stakeholders`, rationale: "Everything is defined, but misaligned expectations still cause late rework. A quick sync prevents that.", kind: "review", when: "complete" },
    );
  } else if (dtype === "vendor") {
    templates.push(
      { title: `Write down 3 must-have criteria before looking at vendors`, rationale: "Without criteria, you'll compare feature lists instead of fit. Define what matters before you evaluate.", kind: "next-action", outcome: "Evaluation criteria documented", when: "missing", fills: "outcome" },
      { title: `Set a hard decision deadline`, rationale: "Vendor decisions expand to fill available time. A deadline forces you to commit with what you know.", kind: "next-action", horizon: "2 weeks", when: "missing", fills: "horizon" },
      { title: `Request a trial from your top 2 candidates`, rationale: "Demos hide integration pain. Hands-on testing surfaces the real costs before you sign.", kind: "next-action", metric: "Integration time (hours)", when: "missing", fills: "metric" },
      { title: `Calculate total cost of ownership, not just license`, rationale: "Migration, training, and maintenance often exceed the sticker price. Get the full number now.", kind: "next-action", metric: "Total cost of ownership ($)", when: "any" },
      { title: `Write a 1-page decision memo`, rationale: "A written rationale now prevents re-litigation later. If people agreed verbally, they'll forget why.", kind: "review", when: "complete" },
    );
  } else if (dtype === "strategy") {
    templates.push(
      { title: `Pick the single metric this strategy should move`, rationale: "Right now there's no way to tell if this is working. One number makes progress visible.", kind: "next-action", metric: "Primary KPI", when: "missing", fills: "metric" },
      { title: `List the top 3 risks`, rationale: "Unnamed risks become surprises. Writing them down turns them into contingencies you can plan for.", kind: "next-action", outcome: "Risk register created", when: "missing", fills: "outcome" },
      { title: `Set a 90-day checkpoint`, rationale: "Without a review date, strategies drift silently. A quarterly check matches natural business cycles.", kind: "next-action", horizon: "90 days", when: "missing", fills: "horizon" },
      { title: `Write a one-page strategy brief`, rationale: "If it doesn't fit on one page, it's not clear enough to execute. Compression forces precision.", kind: "next-action", when: "any" },
      { title: `Run a pre-mortem: assume it failed — why?`, rationale: "You've defined everything. Now find the holes. Imagining failure surfaces blind spots optimism misses.", kind: "review", when: "complete" },
      { title: `Align with one key stakeholder this week`, rationale: "Early misalignment is cheap to fix. The longer you wait, the more expensive a pivot becomes.", kind: "next-action", when: "any" },
    );
  } else {
    // general
    templates.push(
      { title: `Finish this sentence: "This is successful when…"`, rationale: "You don't have a success definition yet. One sentence forces you to commit to what done looks like.", kind: "next-action", outcome: `${n} completed successfully`, when: "missing", fills: "outcome" },
      { title: `Pick one number to track progress`, rationale: "Without a metric, you can't tell if you're moving. One number is better than a dashboard.", kind: "next-action", metric: "Progress indicator", when: "missing", fills: "metric" },
      { title: `Give yourself a 2-week deadline`, rationale: "Open-ended goals stall. A short deadline creates urgency — you can always extend later.", kind: "next-action", horizon: "2 weeks", when: "missing", fills: "horizon" },
      { title: `Identify the first concrete step (under 30 min)`, rationale: "Right now this is still an intention. A tiny first action turns it into something in motion.", kind: "next-action", when: "any" },
      { title: `Write down what would make you abandon this`, rationale: "Kill criteria keep you honest. Without them, sunk cost will keep you going past the point of return.", kind: "review", when: "complete" },
      { title: `Schedule a check-in with someone who has a stake in this`, rationale: "An external touchpoint adds both accountability and perspective you don't have alone.", kind: "review", when: "any" },
    );
  }

  return templates;
}

// ── Contextual validation builder ──

function buildValidationSuggestion(d: DecisionInput, dtype: DecisionType): Suggestion {
  const n = normalize(d.title);
  const isComplete = !!(d.outcome && d.metric && d.horizon);

  if (isActionPrefixed(d.title)) {
    return {
      title: `Write one sentence: how do you know "${n}" is done?`,
      rationale: "Without a done-check, action items linger. A single sentence closes the loop.",
      kind: "validation",
    };
  }

  if (dtype === "habit") {
    if (isComplete) {
      return {
        title: `Write down your top 3 relapse triggers for "${n}"`,
        rationale: "You've defined the habit well. The gap now is knowing what will derail it — name those situations while you're clear-headed.",
        kind: "validation",
      };
    }
    return {
      title: `What one environment change would make "${n}" easier?`,
      rationale: "Willpower runs out. Changing your environment doesn't. Identify the easiest change you can make today.",
      kind: "validation",
    };
  }

  if (dtype === "study") {
    return {
      title: `Try explaining the core concept in 2 sentences`,
      rationale: "If you can't explain it simply, that's your study priority. This takes 2 minutes and shows you exactly where the gaps are.",
      kind: "validation",
    };
  }

  if (dtype === "vendor") {
    return {
      title: `Write down the cost of choosing wrong`,
      rationale: "Quantifying the downside tells you how much diligence this decision actually deserves. Some vendor picks are reversible — is this one?",
      kind: "validation",
    };
  }

  if (dtype === "product") {
    if (isComplete) {
      return {
        title: `Name the riskiest assumption behind "${n}" and sketch a 30-min test`,
        rationale: "Everything is defined, but there's at least one untested assumption baked in. Finding it now is cheaper than finding it after launch.",
        kind: "validation",
      };
    }
    return {
      title: `If this feature fails, what signal will you see first?`,
      rationale: "Defining the failure signal now means you can catch problems early instead of waiting for a post-mortem.",
      kind: "validation",
    };
  }

  if (dtype === "strategy") {
    if (isComplete) {
      return {
        title: `Spend 5 min on a pre-mortem: assume "${n}" failed — why?`,
        rationale: "The plan looks solid on paper. Pre-mortems find the holes that optimism misses, while you still have time to adjust.",
        kind: "validation",
      };
    }
    return {
      title: `Ask one stakeholder: does this match what you expect?`,
      rationale: "Misalignment is cheap to fix now and expensive to fix later. One conversation surfaces it.",
      kind: "validation",
    };
  }

  // general fallback
  if (isComplete) {
    return {
      title: `List 3 things that would make you walk away from "${n}"`,
      rationale: "Everything is defined — now protect yourself from sunk cost. Kill criteria keep you honest when momentum clouds judgment.",
      kind: "validation",
    };
  }
  return {
    title: `What's the single biggest risk to "${n}"?`,
    rationale: "Naming the top risk often reveals the real next step. Spend 2 minutes on this before anything else.",
    kind: "validation",
  };
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
      title: `Replace "${verb}" with a specific, measurable target`,
      rationale: `"${verb}" doesn't tell you when you're done. A concrete number makes progress visible and keeps you from moving goalposts.`,
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
        title: "Write acceptance criteria for this action",
        rationale: "Without criteria, this action has no natural finish line. One sentence prevents it from creeping in scope.",
        kind: "next-action",
        outcome: `${normalize(title)} completed and verified`,
      });
    }
    if (!metric) {
      candidates.push({
        title: "Add a concrete done-check",
        rationale: "Even small actions need a completion signal. Otherwise they sit at 'in-progress' indefinitely.",
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
        title: `Use the same outcome framing as "${bestMatch.title}"`,
        rationale: `"${bestMatch.outcome}" — these decisions are related. Consistent outcomes make it easier to see progress across both.`,
        kind: "follow-up",
        outcome: bestMatch.outcome,
      });
    } else if (!metric && bestMatch.metric) {
      candidates.push({
        title: `Reuse the metric from "${bestMatch.title}"`,
        rationale: `"${bestMatch.metric}" already tracks something similar. Using the same metric avoids double-counting and simplifies review.`,
        kind: "follow-up",
        metric: bestMatch.metric,
      });
    } else if (!horizon && bestMatch.horizon) {
      candidates.push({
        title: `Sync the timeline with "${bestMatch.title}"`,
        rationale: `"${bestMatch.horizon}" — aligning timelines for related decisions reduces coordination overhead.`,
        kind: "follow-up",
        horizon: bestMatch.horizon,
      });
    }
  }

  // ─── 5) In-progress unblock suggestions ───
  if (decision.status === "in-progress" && isComplete) {
    const unblockOptions: Suggestion[] = [
      { title: "Book a 30-min stakeholder review this week", rationale: "This decision is defined but stalled. External input often breaks the logjam faster than more analysis.", kind: "review" },
      { title: "Write a 1-page decision memo", rationale: "If you can write it down clearly, you can decide. If you can't, the memo shows you exactly where you're stuck.", kind: "next-action" },
      { title: "Run a 30-min experiment to test your key assumption", rationale: "You're in-progress but not moving. A small experiment resolves uncertainty faster than more deliberation.", kind: "next-action" },
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
        title: "Pick one decision and start it now",
        rationale: `You have ${todo} decisions queued and nothing in-progress. Starting one — any one — creates momentum that makes the rest easier.`,
        kind: "review",
      });
    }
    if (inProgress >= 2) {
      candidates.push({
        title: "Pause one in-progress decision to focus",
        rationale: `${inProgress} decisions in flight at once. Dropping one improves throughput on the rest — pick the one that matters least this week.`,
        kind: "cleanup",
      });
    }
    if (done >= 5) {
      candidates.push({
        title: "Review what you've finished before adding more",
        rationale: `${done} decisions completed. Before loading up again, spend 10 minutes reflecting on what worked and what to carry forward.`,
        kind: "review",
      });
    }
  }

  // ─── 7) Contextual validation suggestion (always include one) ───
  candidates.push(buildValidationSuggestion(decision, dtype))

  // ─── Deduplicate: pick up to 2 non-validation, then 1 validation, optionally 1 reuse ───
  const seen = new Set<string>();
  const unique: Suggestion[] = [];

  // First pass: pick up to 2 non-validation suggestions
  for (const s of candidates) {
    if (unique.length >= 2) break;
    if (s.kind === "validation") continue;
    const key = s.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }

  // Guaranteed validation slot
  for (const s of candidates) {
    if (s.kind !== "validation") continue;
    const key = s.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
    break;
  }

  // Allow a 4th if it's a reuse/follow-up
  for (const s of candidates) {
    if (unique.length >= 4) break;
    const key = s.title.toLowerCase();
    if (seen.has(key)) continue;
    if (s.kind === "follow-up" || s.kind === "reuse") {
      seen.add(key);
      unique.push(s);
      break;
    }
  }

  return unique;
}

// ── LLM-backed suggestions (Anthropic Claude) ──

const SYSTEM_PROMPT = `You are a concise product coach. Direct, calm, pragmatic. No hype, no motivational fluff.

You generate suggestions for ONE decision. Each suggestion must reduce ambiguity or increase momentum TODAY.

You receive:
- currentDecision: { id, title, status, outcome?, metric?, horizon? }
- siblingActions: child actions for this decision (id, title, status)  // may be empty
- otherDecisions: other goals + actions for reuse/context
- reflections (optional): past reflection entries for this decision and/or its actions
  Each reflection includes short answers like: "clear_step", "enough_time", "context_switching", "low_energy", "unclear_action", plus optional note text.
- suggestionHistory (optional): previously shown suggestions for this decision (title + kind + lifecycle: new/applied/dismissed)
- outputLanguage: language code (e.g., "en", "de") for all user-facing text

Hard goals:
1) Be specific to THIS decision NOW. No generic advice.
2) Never repeat what is already defined (outcome/metric/horizon). If fields are already present, shift to execution and validation.
3) Never propose an action that duplicates an existing siblingAction title (case-insensitive fuzzy match).
4) Avoid repeating recently shown suggestions:
   - If suggestionHistory exists, do NOT output a suggestion whose title is semantically similar to a recent one (applied OR dismissed).
   - If you must revisit a theme, change the approach and wording and make it more concrete.

Reflection-aware behavior (this is mandatory when reflections exist):
- Detect friction signals from reflections. If the user mentions:
  - "context switching" → propose a single-task, low-context action (e.g., one doc, one tab, one call)
  - "low energy" → propose the smallest possible start (≤ 5 minutes) or a low-energy variant
  - "unclear action" → propose a rewrite into a single next step with a clear deliverable
  - "enough time" absent → assume time is scarce; keep actions short
- If reflections show a positive signal (e.g., "clear step"), reinforce it by proposing the next step that preserves clarity.

Suggestion mix (max 4 suggestions):
- Exactly 1 suggestion MUST be kind "validation" (a quick check or 5–10 minute exercise that tests assumptions or surfaces risk).
- If reflections contain ANY friction signal (context switching / low energy / unclear action), exactly 1 suggestion MUST be a "friction reducer" execution step tailored to that signal.
- The remaining suggestions should prioritize the biggest missing field in this order:
  outcome > metric > horizon
  But only propose a field if it is missing.
- If outcome/metric/horizon are all present, use execution + reuse + validation (no more field-filling).

Suggestion kinds (use exactly these):
- "outcome"    → defines what success looks like
- "metric"     → makes progress measurable
- "horizon"    → adds a deadline
- "execution"  → concrete next action
- "reuse"      → borrows structure from a similar decision
- "validation" → reflective check that tests the plan

Output rules:
- Output ONLY a valid JSON array. No text outside JSON.
- Max 4 items.
- Each "title" must be an imperative coaching prompt (short).
- Each "rationale" must explain why this helps THIS decision NOW (1–2 sentences).
- Only include outcome/metric/horizon fields if you propose a concrete value.
- Never mention being an AI. Never explain your reasoning process.
- All user-facing strings (title, rationale, outcome, metric, horizon) MUST be written in outputLanguage.

Schema per suggestion:
{
  "title": string,
  "rationale": string,
  "kind": "outcome" | "metric" | "horizon" | "execution" | "reuse" | "validation",
  "outcome"?: string,
  "metric"?: string,
  "horizon"?: string
}`;

type ReflectionInput = {
  decisionId: number;
  createdAt: string;
  answers: { promptId: string; value: string }[];
};

function buildUserPrompt(decision: DecisionInput, allDecisions: DecisionInput[], reflections?: ReflectionInput[], suggestionHistory?: unknown[], outputLanguage: string = 'en'): string {
  // Current decision
  const current = JSON.stringify(decision, null, 2);

  // Sibling actions (child actions for this decision)
  const siblingActions = allDecisions.filter((d) => (d as any).parentId === decision.id);
  const siblingsJson = siblingActions.length > 0
    ? JSON.stringify(siblingActions.map(s => ({ id: s.id, title: s.title, status: s.status })), null, 2)
    : "[]";

  // Other decisions (excluding current and its children)
  const others = allDecisions
    .filter((d) => d.id !== decision.id && (d as any).parentId !== decision.id)
    .slice(0, 10);
  const otherJson = others.length > 0
    ? JSON.stringify(others, null, 2)
    : "[]";

  let prompt = `currentDecision:\n${current}\n\nsiblingActions:\n${siblingsJson}\n\notherDecisions:\n${otherJson}\n\noutputLanguage: ${outputLanguage}`;

  if (reflections && reflections.length > 0) {
    prompt += `\n\nreflections:\n${JSON.stringify(reflections, null, 2)}`;
  }

  if (suggestionHistory && suggestionHistory.length > 0) {
    prompt += `\n\nsuggestionHistory:\n${JSON.stringify(suggestionHistory, null, 2)}`;
  }

  return prompt;
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
  reflections?: ReflectionInput[],
  suggestionHistory?: unknown[],
  outputLanguage: string = 'en',
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
      model: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(decision, allDecisions, reflections, suggestionHistory, outputLanguage) }],
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
