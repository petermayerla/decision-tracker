/**
 * Suggestion provider for decisions.
 * Stub implementation — returns deterministic suggestions based on decision fields.
 * Replace the body of `generateSuggestions` with an LLM call to upgrade.
 */

export type DecisionInput = {
  id: number;
  title: string;
  outcome?: string;
  metric?: string;
  horizon?: string;
};

export type Suggestion = {
  title: string;
  rationale: string;
  outcome?: string;
  metric?: string;
  horizon?: string;
};

export function generateSuggestions(decision: DecisionInput): Suggestion[] {
  const { title, outcome, metric, horizon } = decision;
  const suggestions: Suggestion[] = [];

  // 1. Metric-aware suggestion
  if (metric) {
    suggestions.push({
      title: `Define baseline for "${metric}"`,
      rationale: "You can't measure progress without knowing where you started.",
      metric: `${metric} baseline`,
    });
  } else {
    suggestions.push({
      title: "Identify a measurable signal for this decision",
      rationale: "A concrete metric turns intent into accountability.",
      metric: "Key signal (define)",
    });
  }

  // 2. Outcome-aware suggestion
  if (outcome) {
    suggestions.push({
      title: `Identify leading indicator for "${outcome}"`,
      rationale: "Leading indicators let you course-correct before the deadline.",
      outcome: `Leading indicator for ${outcome}`,
    });
  } else {
    suggestions.push({
      title: `Define what success looks like for "${title}"`,
      rationale: "A clear outcome makes the decision actionable.",
      outcome: `${title} succeeded`,
    });
  }

  // 3. Execution breakdown
  suggestions.push({
    title: `Break "${title}" into 3 execution steps`,
    rationale: "Smaller steps reduce ambiguity and build momentum.",
    horizon: horizon || "this week",
  });

  // 4. Horizon-aware suggestion
  if (horizon) {
    suggestions.push({
      title: `Set weekly check-in until ${horizon}`,
      rationale: `Regular reviews keep "${title}" on track within the timeframe.`,
      horizon,
    });
  } else {
    suggestions.push({
      title: `Set a deadline for "${title}"`,
      rationale: "Decisions without a horizon tend to drift indefinitely.",
      horizon: "2 weeks",
    });
  }

  return suggestions;
}
