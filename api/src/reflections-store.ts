import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REFLECTIONS_PATH = path.join(__dirname, "..", "data", "reflections.json");

export type Reflection = {
  id: string;
  createdAt: string; // ISO date string
  goalId: number;
  actionId?: number;
  // Signal-based format (new reflection sheet)
  signals?: string[];
  note?: string;
  // Prompt-answer format (quick reflection)
  answers?: Array<{ promptId: string; value: string }>;
};

type ReflectionInput = {
  goalId: number;
  actionId?: number;
  signals?: string[];
  note?: string;
  answers?: Array<{ promptId: string; value: string }>;
};

const VALID_SIGNALS = [
  "clear_step",
  "enough_time",
  "context_switching",
  "low_energy",
  "unclear_action",
];

function ensureDataDir() {
  const dir = path.dirname(REFLECTIONS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadReflections(): Reflection[] {
  ensureDataDir();
  if (!fs.existsSync(REFLECTIONS_PATH)) {
    fs.writeFileSync(REFLECTIONS_PATH, "[]", "utf-8");
    return [];
  }
  try {
    const data = fs.readFileSync(REFLECTIONS_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveReflections(reflections: Reflection[]): void {
  ensureDataDir();
  fs.writeFileSync(REFLECTIONS_PATH, JSON.stringify(reflections, null, 2), "utf-8");
}

export function appendReflection(
  input: ReflectionInput
): { ok: true; value: Reflection } | { ok: false; error: { message: string } } {
  // Validation
  if (typeof input.goalId !== "number" || input.goalId <= 0) {
    return { ok: false, error: { message: "Invalid goalId" } };
  }

  if (input.actionId !== undefined && (typeof input.actionId !== "number" || input.actionId <= 0)) {
    return { ok: false, error: { message: "Invalid actionId" } };
  }

  // Must have either signals, note, or answers
  const hasSignals = Array.isArray(input.signals) && input.signals.length > 0;
  const hasNote = input.note && input.note.trim().length > 0;
  const hasAnswers = Array.isArray(input.answers) && input.answers.length > 0;

  if (!hasSignals && !hasNote && !hasAnswers) {
    return { ok: false, error: { message: "Reflection must have signals, note, or answers" } };
  }

  // Validate signals if provided
  if (input.signals) {
    if (!Array.isArray(input.signals)) {
      return { ok: false, error: { message: "signals must be an array" } };
    }
    for (const signal of input.signals) {
      if (!VALID_SIGNALS.includes(signal)) {
        return { ok: false, error: { message: `Invalid signal: ${signal}` } };
      }
    }
  }

  // Validate note if provided
  if (input.note !== undefined) {
    if (typeof input.note !== "string") {
      return { ok: false, error: { message: "note must be a string" } };
    }
    if (input.note.length > 140) {
      return { ok: false, error: { message: "note must be <= 140 characters" } };
    }
  }

  // Validate answers if provided
  if (input.answers !== undefined) {
    if (!Array.isArray(input.answers)) {
      return { ok: false, error: { message: "answers must be an array" } };
    }
    for (const answer of input.answers) {
      if (!answer.promptId || !answer.value) {
        return { ok: false, error: { message: "Each answer must have promptId and value" } };
      }
    }
  }

  // Create reflection
  const reflection: Reflection = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    goalId: input.goalId,
    actionId: input.actionId,
    signals: input.signals?.filter(s => s) || undefined,
    note: input.note?.trim() || undefined,
    answers: input.answers || undefined,
  };

  // Append to store
  const reflections = loadReflections();
  reflections.push(reflection);
  saveReflections(reflections);

  return { ok: true, value: reflection };
}

export function listReflections(params?: {
  goalId?: number;
  actionId?: number;
  sinceDays?: number;
}): Reflection[] {
  const reflections = loadReflections();
  const sinceDays = params?.sinceDays ?? 14;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - sinceDays);

  let filtered = reflections.filter((r) => {
    const createdDate = new Date(r.createdAt);
    return createdDate >= cutoffDate;
  });

  if (params?.goalId !== undefined) {
    filtered = filtered.filter((r) => r.goalId === params.goalId);
  }

  if (params?.actionId !== undefined) {
    filtered = filtered.filter((r) => r.actionId === params.actionId);
  }

  return filtered;
}
