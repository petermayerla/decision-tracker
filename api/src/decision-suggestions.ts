/**
 * Agentic suggestion provider for decisions.
 * Deterministic heuristics — no LLM calls.
 * Suggestions depend on: field completeness, similar decisions, tracker state.
 */

export type DecisionInput = {
  id: number;
  title: string;
  status?: string;
  outcome?: string;
  metric?: string;
  horizon?: string;
};

export type SuggestionKind = "next-action" | "split" | "review" | "follow-up" | "cleanup";

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

// ── Main ──

export function generateSuggestions(
  decision: DecisionInput,
  allDecisions: DecisionInput[] = [],
): Suggestion[] {
  const { title, outcome, metric, horizon } = decision;
  const candidates: Suggestion[] = [];

  // ─── A) Completeness-first ───
  if (!outcome) {
    candidates.push({
      title: `Define the desired outcome for "${title}"`,
      rationale: "A clear outcome makes the decision actionable and measurable.",
      kind: "next-action",
      outcome: `${title} succeeded`,
    });
  }
  if (!metric) {
    candidates.push({
      title: `Choose a metric to track "${title}"`,
      rationale: "A concrete metric turns intent into accountability.",
      kind: "next-action",
      metric: "Key signal (define)",
    });
  }
  if (!horizon) {
    candidates.push({
      title: `Set a deadline for "${title}"`,
      rationale: "Decisions without a horizon tend to drift indefinitely.",
      kind: "next-action",
      horizon: "2 weeks",
    });
  }

  // ─── B) Similarity reuse ───
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
    if (!outcome && bestMatch.outcome) {
      candidates.push({
        title: `Reuse outcome from "${bestMatch.title}"`,
        rationale: `"${bestMatch.outcome}" — reusing keeps decisions consistent.`,
        kind: "follow-up",
        outcome: bestMatch.outcome,
      });
    }
    if (!metric && bestMatch.metric) {
      candidates.push({
        title: `Reuse metric from "${bestMatch.title}"`,
        rationale: `"${bestMatch.metric}" — reusing keeps measurement consistent.`,
        kind: "follow-up",
        metric: bestMatch.metric,
      });
    }
    if (!horizon && bestMatch.horizon) {
      candidates.push({
        title: `Reuse horizon from "${bestMatch.title}"`,
        rationale: `"${bestMatch.horizon}" — align timelines across related decisions.`,
        kind: "follow-up",
        horizon: bestMatch.horizon,
      });
    }
  }

  // ─── C) Tracker-state suggestions ───
  if (allDecisions.length > 0) {
    const todo = allDecisions.filter((d) => d.status === "todo").length;
    const inProgress = allDecisions.filter((d) => d.status === "in-progress").length;
    const done = allDecisions.filter((d) => d.status === "done").length;

    if (todo >= 4 && inProgress === 0) {
      candidates.push({
        title: "Pick one decision to start (10 min)",
        rationale: `You have ${todo} decisions waiting — starting one builds momentum.`,
        kind: "review",
      });
    }
    if (inProgress >= 2) {
      candidates.push({
        title: "Pause one in-progress decision to reduce context switching",
        rationale: `${inProgress} decisions in flight — focus improves throughput.`,
        kind: "cleanup",
      });
    }
    if (done >= 5) {
      candidates.push({
        title: "Review last wins and set next 3 decisions",
        rationale: `${done} decisions completed — a good time to reflect and plan ahead.`,
        kind: "review",
      });
    }
  }

  // ─── D) Action-prefixed decisions: avoid "break into steps" ───
  if (isActionPrefixed(title)) {
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
        title: "Add a measurable check for this action",
        rationale: "Even small actions benefit from a concrete done-check.",
        kind: "next-action",
        metric: "Done check (yes/no)",
      });
    }
  } else {
    // Non-action decisions: offer a split if all fields present
    if (outcome && metric && horizon) {
      candidates.push({
        title: `Break "${title}" into 3 execution steps`,
        rationale: "Smaller steps reduce ambiguity and build momentum.",
        kind: "split",
        horizon,
      });
    }
  }

  // ─── Deduplicate by title, rank, return top 4 ───
  const seen = new Set<string>();
  const unique: Suggestion[] = [];
  for (const s of candidates) {
    const key = s.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }

  return unique.slice(0, 4);
}
