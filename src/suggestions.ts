import { TaskStatus } from "./task-tracker.js";

export type SuggestionKind = "next-action" | "split" | "review" | "follow-up" | "cleanup";

export type Suggestion = {
  title: string;
  rationale: string;
  kind: SuggestionKind;
};

type TaskInput = { id: number; title: string; status: TaskStatus };

const FOLLOW_UP_KEYWORDS = ["meeting", "proposal", "deck", "email"] as const;
const COMPOUND_PATTERN = /\band\b|&|\//i;
const MAX_TITLE_LEN = 60;

const SUGGESTION_PREFIXES = [
  "outline for: ",
  "draft agenda for: ",
  "split: ",
  "unblock: ",
  "next step: ",
];

/** Normalize a title for deduplication: trim, collapse spaces, lowercase, strip known prefixes. */
function normalize(title: string): string {
  let s = title.trim().replace(/\s+/g, " ").toLowerCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of SUGGESTION_PREFIXES) {
      if (s.startsWith(prefix)) {
        s = s.slice(prefix.length);
        changed = true;
      }
    }
  }
  return s;
}

/** Strip suggestion prefixes from the raw title to get the base task name. */
function stripPrefixes(title: string): string {
  let s = title;
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of SUGGESTION_PREFIXES) {
      if (s.toLowerCase().startsWith(prefix)) {
        s = s.slice(prefix.length);
        changed = true;
      }
    }
  }
  return s;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function getSuggestions(tasks: TaskInput[], limit = 5): Suggestion[] {
  const existingNormalized = new Set(tasks.map((t) => normalize(t.title)));
  const seenSuggestions = new Set<string>();
  const suggestions: Suggestion[] = [];

  function add(s: Suggestion) {
    if (suggestions.length >= limit) return;
    const norm = normalize(s.title);
    if (existingNormalized.has(norm)) return;
    if (seenSuggestions.has(norm)) return;
    seenSuggestions.add(norm);
    suggestions.push({ ...s, title: truncate(s.title, MAX_TITLE_LEN) });
  }

  const todos = tasks.filter((t) => t.status === "todo");
  const inProgress = tasks.filter((t) => t.status === "in-progress");
  const done = tasks.filter((t) => t.status === "done");

  // A) Next-action for most recent in-progress task
  if (inProgress.length > 0) {
    const latest = inProgress.reduce((a, b) => (a.id > b.id ? a : b));
    const base = stripPrefixes(latest.title);
    add({
      title: `Unblock: ${base}`,
      rationale: "You have an in-progress task; unblock it first.",
      kind: "next-action",
    });
  }

  // E) Follow-up for keyword-matching tasks (in-progress first, then todo)
  for (const task of [...inProgress, ...todos]) {
    if (suggestions.length >= limit) break;
    const base = stripPrefixes(task.title);
    const lower = base.toLowerCase();
    for (const kw of FOLLOW_UP_KEYWORDS) {
      if (lower.includes(kw)) {
        const prefix = kw === "meeting" ? "Draft agenda for" : "Outline for";
        add({
          title: `${prefix}: ${base}`,
          rationale: `"${base}" likely needs preparation; create a follow-up.`,
          kind: "follow-up",
        });
        break;
      }
    }
  }

  // C) Split compound/broad tasks
  for (const task of todos) {
    if (suggestions.length >= limit) break;
    const base = stripPrefixes(task.title);
    if (COMPOUND_PATTERN.test(base) || base.length > 40) {
      add({
        title: `Split: ${base}`,
        rationale: "This looks like a multi-part task; splitting reduces friction.",
        kind: "split",
      });
    }
  }

  // B) Pick priority if 3+ todos
  if (todos.length >= 3) {
    add({
      title: "Choose next task (10 min)",
      rationale: `You have ${todos.length} todo tasks; pick the most impactful one.`,
      kind: "next-action",
    });
  }

  // D) Review if 5+ done
  if (done.length >= 5) {
    add({
      title: "Weekly review: archive and plan next 3",
      rationale: `${done.length} tasks done; review progress and set new goals.`,
      kind: "review",
    });
  }

  // F) Cleanup for stale todos (id gap: lowest todo id < highest done id)
  if (todos.length > 0 && done.length > 0) {
    const lowestTodoId = todos.reduce((a, b) => (a.id < b.id ? a : b)).id;
    const highestDoneId = done.reduce((a, b) => (a.id > b.id ? a : b)).id;
    if (lowestTodoId < highestDoneId) {
      add({
        title: "Close or start one stale todo task",
        rationale: "Some todo tasks are older than completed ones; tidy up.",
        kind: "cleanup",
      });
    }
  }

  return suggestions;
}
