import {
  Task,
  TaskPatch,
  TaskTracker,
  NotFoundError,
  InvalidTransitionError,
} from "./task-tracker.js";
import { Result } from "./result.js";

export class SafeTaskTracker {
  private tracker = new TaskTracker();

  addTask(title: string): Result<Task> {
    return { ok: true, value: this.tracker.addTask(title) };
  }

  updateTask(id: number, patch: TaskPatch): Result<Task> {
    return this.attempt(() => this.tracker.updateTask(id, patch));
  }

  startTask(id: number): Result<Task> {
    return this.attempt(() => this.tracker.startTask(id));
  }

  completeTask(id: number): Result<Task> {
    return this.attempt(() => this.tracker.completeTask(id));
  }

  listTasks(): Result<Task[]> {
    return { ok: true, value: this.tracker.listTasks() };
  }

  private attempt(fn: () => Task): Result<Task> {
    try {
      return { ok: true, value: fn() };
    } catch (err) {
      if (err instanceof NotFoundError) {
        return { ok: false, error: { code: "NOT_FOUND", message: err.message } };
      }
      if (err instanceof InvalidTransitionError) {
        return { ok: false, error: { code: "INVALID_TRANSITION", message: err.message } };
      }
      throw err;
    }
  }
}
