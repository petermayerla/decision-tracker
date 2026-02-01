import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Task } from "./task-tracker.js";
import { SafeTaskTracker } from "./safe-task-tracker.js";

export const STORE_PATH = process.env.STORE_PATH ?? join(homedir(), ".tasks.json");

export function loadTracker(): SafeTaskTracker {
  const tracker = new SafeTaskTracker();
  let tasks: Task[];
  try {
    tasks = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return tracker;
  }

  // Replay tasks in ID order to rebuild internal state.
  // addTask auto-increments IDs starting at 1, so we rely on
  // the saved array being sorted by ID with no gaps.
  for (const task of tasks) {
    tracker.addTask(task.title);
    if (task.status === "in-progress" || task.status === "done") {
      tracker.startTask(task.id);
    }
    if (task.status === "done") {
      tracker.completeTask(task.id);
    }
    // Restore optional fields
    const patch: Record<string, string> = {};
    if (task.outcome) patch.outcome = task.outcome;
    if (task.metric) patch.metric = task.metric;
    if (task.horizon) patch.horizon = task.horizon;
    if (Object.keys(patch).length > 0) {
      tracker.updateTask(task.id, patch);
    }
  }

  return tracker;
}

export function saveTracker(tracker: SafeTaskTracker): void {
  const result = tracker.listTasks();
  if (result.ok) {
    writeFileSync(STORE_PATH, JSON.stringify(result.value, null, 2) + "\n");
  }
}
