#!/usr/bin/env npx tsx
import { loadTracker, saveTracker } from "./store.js";
import { Task, TaskStatus } from "./task-tracker.js";
import { ErrorCode } from "./result.js";
import { colorStatus, colorStatusPlain, success, error, hint } from "./ui/colors.js";
import select from "@inquirer/select";
import { getSuggestions } from "./suggestions.js";

const noColor = !!process.env["NO_COLOR"];
const tracker = loadTracker();
const [command, ...args] = process.argv.slice(2);

const HINTS: Record<ErrorCode, string> = {
  NOT_FOUND: "Run 'tasks list' to see valid IDs.",
  INVALID_TRANSITION: "Run 'tasks list' to check the task's current status.",
};

function printConfirm(action: string, task: Task) {
  const msg = `→ ${action}: ${task.title}`;
  console.log(noColor ? msg : success(msg));
}

function printError(code: ErrorCode, message: string) {
  const msg = `${code}: ${message}`;
  console.error(noColor ? msg : error(msg));
  const hintMsg = `Hint: ${HINTS[code]}`;
  console.error(noColor ? hintMsg : hint(hintMsg));
}

function formatStatus(status: TaskStatus): string {
  return noColor ? colorStatusPlain(status) : colorStatus(status);
}

function printSummary(tasks: Task[]) {
  if (tasks.length === 0) {
    const msg = "0 tasks";
    console.log(noColor ? msg : hint(msg));
    return;
  }
  const todo = tasks.filter((t) => t.status === "todo").length;
  const inProgress = tasks.filter((t) => t.status === "in-progress").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const msg = `${tasks.length} tasks (${todo} todo, ${inProgress} in-progress, ${done} done)`;
  console.log(noColor ? msg : hint(msg));
}

function printTable(tasks: Task[]) {
  if (tasks.length === 0) {
    printSummary(tasks);
    return;
  }
  const idWidth = Math.max(2, ...tasks.map((t) => String(t.id).length));
  // Pad based on raw status length, not ANSI-colored length
  const statusWidth = Math.max(6, ...tasks.map((t) => t.status.length));
  console.log(
    "ID".padEnd(idWidth) + "  " +
    "STATUS".padEnd(statusWidth + 2) + "  " +
    "TITLE",
  );
  for (const task of tasks) {
    const statusStr = formatStatus(task.status);
    // Pad after the visible text: symbol(1) + space(1) + status
    const padding = statusWidth - task.status.length;
    console.log(
      String(task.id).padEnd(idWidth) + "  " +
      statusStr + " ".repeat(padding) + "  " +
      task.title,
    );
  }
}

function parseFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

function printHelp() {
  console.log(`Usage:
  add "title"                  Create a new task
  start <id>                   Move task to in-progress
  done <id>                    Move task to done
  list [--status <status>]     Show tasks (filter: todo, in-progress, done)
  list --json                  Show tasks as JSON
  suggest                      Show task suggestions
  suggest --add <n>            Add suggestion #n as a new task
  suggest --json               Show suggestions as JSON
  help                         Show this message

Examples:
  tasks add "Buy groceries"
  tasks start 1
  tasks done 1
  tasks list
  tasks list --status todo
  tasks suggest
  tasks suggest --add 1`);
}

async function handleStart() {
  const explicitId = Number(args[0]);
  if (explicitId) {
    const result = tracker.startTask(explicitId);
    if (result.ok) {
      saveTracker(tracker);
      printConfirm("Started", result.value);
    } else {
      printError(result.error.code, result.error.message);
      process.exit(1);
    }
    return;
  }

  // No ID provided — interactive mode
  if (hasFlag("--json")) {
    console.log(JSON.stringify({ ok: false, error: { code: "MISSING_ID", message: "start requires an ID in non-interactive mode" } }, null, 2));
    process.exit(1);
    return;
  }

  const listResult = tracker.listTasks();
  if (!listResult.ok) return;
  const todoTasks = listResult.value
    .filter((t) => t.status === "todo")
    .sort((a, b) => a.id - b.id);

  if (todoTasks.length === 0) {
    console.log("No todo tasks to start.");
    return;
  }

  let taskId: number;
  if (todoTasks.length === 1) {
    taskId = todoTasks[0].id;
  } else {
    try {
      taskId = await select({
        message: "Which task do you want to start?",
        choices: todoTasks.map((t) => ({
          name: `[#${t.id}] ${t.title}`,
          value: t.id,
        })),
      });
    } catch {
      console.log("Cancelled.");
      return;
    }
  }

  const result = tracker.startTask(taskId);
  if (result.ok) {
    saveTracker(tracker);
    printConfirm("Started", result.value);
  } else {
    printError(result.error.code, result.error.message);
    process.exit(1);
  }
}

switch (command) {
  case "add": {
    const title = args[0];
    if (!title) {
      console.error("Usage: add \"title\"");
      process.exit(1);
    }
    const result = tracker.addTask(title);
    if (result.ok) {
      saveTracker(tracker);
      printConfirm("Created", result.value);
    }
    break;
  }
  case "start": {
    await handleStart();
    break;
  }
  case "done": {
    const id = Number(args[0]);
    if (!id) {
      console.error("Usage: done <id>");
      process.exit(1);
    }
    const result = tracker.completeTask(id);
    if (result.ok) {
      saveTracker(tracker);
      printConfirm("Completed", result.value);
    } else {
      printError(result.error.code, result.error.message);
      process.exit(1);
    }
    break;
  }
  case "list": {
    const result = tracker.listTasks();
    if (!result.ok) break;

    let tasks = result.value;
    const statusFilter = parseFlag("--status") as TaskStatus | undefined;
    if (statusFilter) {
      tasks = tasks.filter((t) => t.status === statusFilter);
    }

    if (hasFlag("--json")) {
      console.log(JSON.stringify(tasks, null, 2));
    } else {
      printTable(tasks);
      printSummary(tasks);
    }
    break;
  }
  case "suggest": {
    const listResult = tracker.listTasks();
    if (!listResult.ok) break;
    const suggestions = getSuggestions(listResult.value);

    if (hasFlag("--json")) {
      console.log(JSON.stringify(suggestions, null, 2));
      break;
    }

    const addIndex = parseFlag("--add");
    if (addIndex !== undefined) {
      const n = Number(addIndex);
      if (!n || n < 1 || n > suggestions.length) {
        console.error(`Invalid suggestion number. Choose 1–${suggestions.length}.`);
        process.exit(1);
      }
      const chosen = suggestions[n - 1];
      const result = tracker.addTask(chosen.title);
      if (result.ok) {
        saveTracker(tracker);
        printConfirm("Created", result.value);
      }
      break;
    }

    if (suggestions.length === 0) {
      console.log("No suggestions right now. Your task list looks good!");
      break;
    }

    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      const num = `${i + 1})`;
      const rationale = noColor ? `— ${s.rationale}` : hint(`— ${s.rationale}`);
      console.log(`${num} ${s.title} ${rationale}`);
    }
    const addHint = noColor
      ? "\nRun 'tasks suggest --add <n>' to add one."
      : "\n" + hint("Run 'tasks suggest --add <n>' to add one.");
    console.log(addHint);
    break;
  }
  case "help":
  case undefined:
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
