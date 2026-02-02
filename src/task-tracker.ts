export type TaskStatus = "todo" | "in-progress" | "done";

export type Task = {
  id: number;
  title: string;
  status: TaskStatus;
  outcome?: string;
  metric?: string;
  horizon?: string;
  parentId?: number;
  kind?: "goal" | "action";
};

export type TaskPatch = {
  outcome?: string;
  metric?: string;
  horizon?: string;
};

export class NotFoundError extends Error {
  constructor(id: number) {
    super(`Task ${id} not found`);
  }
}

export class InvalidTransitionError extends Error {
  constructor(id: number, currentStatus: TaskStatus, expectedStatus: TaskStatus) {
    super(`Task ${id} is "${currentStatus}", expected "${expectedStatus}"`);
  }
}

export class TaskTracker {
  private tasks = new Map<number, Task>();
  private nextId = 1;

  addTask(title: string, opts?: { parentId?: number; kind?: "goal" | "action" }): Task {
    const kind = opts?.kind ?? (opts?.parentId ? "action" : "goal");
    const task: Task = { id: this.nextId++, title, status: "todo", kind };
    if (opts?.parentId) task.parentId = opts.parentId;
    this.tasks.set(task.id, task);
    return { ...task };
  }

  updateTask(id: number, patch: TaskPatch): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new NotFoundError(id);
    }
    if (patch.outcome !== undefined) task.outcome = patch.outcome;
    if (patch.metric !== undefined) task.metric = patch.metric;
    if (patch.horizon !== undefined) task.horizon = patch.horizon;
    return { ...task };
  }

  startTask(id: number): Task {
    const task = this.transition(id, "todo", "in-progress");

    // If this task has a parent (it's an action), ensure parent goal is in-progress
    if (task.parentId) {
      const parent = this.tasks.get(task.parentId);
      if (parent && parent.status === "todo") {
        parent.status = "in-progress";
      }
    }

    return task;
  }

  completeTask(id: number): Task {
    const task = this.transition(id, "in-progress", "done");

    // If this task has a parent, check if all siblings are done
    if (task.parentId) {
      const parent = this.tasks.get(task.parentId);
      if (parent) {
        const siblings = this.listTasks().filter((t) => t.parentId === task.parentId);
        const allDone = siblings.length > 0 && siblings.every((s) => s.status === "done");

        if (allDone) {
          // All child actions complete, mark parent goal as done
          if (parent.status === "in-progress") {
            parent.status = "done";
          }
        } else {
          // Some actions still pending, ensure parent is in-progress
          if (parent.status === "todo") {
            parent.status = "in-progress";
          }
        }
      }
    }

    return task;
  }

  private transition(id: number, fromStatus: TaskStatus, toStatus: TaskStatus): Task {
    const task = this.tasks.get(id);
    if (!task) {
      throw new NotFoundError(id);
    }
    if (task.status !== fromStatus) {
      throw new InvalidTransitionError(id, task.status, fromStatus);
    }
    task.status = toStatus;
    return { ...task };
  }

  listTasks(): Task[] {
    return [...this.tasks.values()].map((task) => ({ ...task }));
  }
}
