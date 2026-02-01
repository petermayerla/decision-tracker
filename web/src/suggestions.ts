import type { Decision } from "./api";

export type FieldSuggestion = {
  value: string;
  rationale: string;
};

export type FieldSuggestions = {
  outcome: FieldSuggestion[];
  metric: FieldSuggestion[];
  horizon: FieldSuggestion[];
};

const VERB_METRICS: [RegExp, string][] = [
  [/\b(launch|ship|release|deploy)\b/i, "Time to launch (days)"],
  [/\b(hire|recruit|onboard)\b/i, "Number of hires completed"],
  [/\b(reduce|cut|lower|decrease)\b/i, "Percentage reduction"],
  [/\b(increase|grow|boost|improve)\b/i, "Percentage improvement"],
  [/\b(migrate|move|transition)\b/i, "Migration completion rate (%)"],
  [/\b(test|validate|verify)\b/i, "Test pass rate (%)"],
  [/\b(fix|resolve|debug)\b/i, "Number of issues resolved"],
  [/\b(build|create|design|implement)\b/i, "Feature completion (%)"],
  [/\b(review|evaluate|assess)\b/i, "Reviews completed per week"],
  [/\b(write|document|draft)\b/i, "Pages or sections completed"],
];

function generateOutcomes(title: string): FieldSuggestion[] {
  const results: FieldSuggestion[] = [];
  results.push({
    value: `We will have ${title.toLowerCase().replace(/^(decide|choose|pick)\s+(on\s+)?/i, "")} resolved and communicated`,
    rationale: "Frames the decision as a concrete deliverable.",
  });
  results.push({
    value: `Stakeholders are aligned on ${title.toLowerCase()}`,
    rationale: "Focuses on alignment as the key outcome.",
  });
  return results;
}

function generateMetrics(title: string): FieldSuggestion[] {
  const results: FieldSuggestion[] = [];
  for (const [pattern, metric] of VERB_METRICS) {
    if (pattern.test(title)) {
      results.push({ value: metric, rationale: "Matched from action verb in title." });
      if (results.length >= 2) return results;
    }
  }
  if (results.length === 0) {
    results.push({ value: "Decision made (yes/no)", rationale: "Simple binary completion signal." });
  }
  if (results.length < 2) {
    results.push({ value: "Days until decision is finalized", rationale: "Tracks decision velocity." });
  }
  return results;
}

function generateHorizons(title: string): FieldSuggestion[] {
  const lower = title.toLowerCase();
  const results: FieldSuggestion[] = [];

  if (/\b(urgent|asap|block|critical|hotfix)\b/i.test(lower)) {
    results.push({ value: "today", rationale: "Title signals urgency." });
    results.push({ value: "this week", rationale: "Short fallback if today is too tight." });
  } else if (/\b(sprint|iteration|cycle)\b/i.test(lower)) {
    results.push({ value: "this sprint", rationale: "Matches sprint-scoped language." });
    results.push({ value: "this month", rationale: "Wider window if sprint is tight." });
  } else if (/\b(quarter|q[1-4]|okr|roadmap|strategy)\b/i.test(lower)) {
    results.push({ value: "this quarter", rationale: "Matches strategic planning horizon." });
    results.push({ value: "this month", rationale: "Intermediate checkpoint." });
  } else {
    results.push({ value: "this week", rationale: "Default short-term horizon." });
    results.push({ value: "this sprint", rationale: "Aligns with typical iteration cycle." });
  }

  return results;
}

export function buildFieldSuggestions(decision: Decision): FieldSuggestions {
  return {
    outcome: decision.outcome ? [] : generateOutcomes(decision.title),
    metric: decision.metric ? [] : generateMetrics(decision.title),
    horizon: decision.horizon ? [] : generateHorizons(decision.title),
  };
}

export function hasAnySuggestions(fs: FieldSuggestions): boolean {
  return fs.outcome.length > 0 || fs.metric.length > 0 || fs.horizon.length > 0;
}

export function suggestionCount(fs: FieldSuggestions): number {
  return fs.outcome.length + fs.metric.length + fs.horizon.length;
}
