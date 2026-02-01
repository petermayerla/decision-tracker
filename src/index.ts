import { TaskTracker } from "./task-tracker.js";

const queue = new TaskTracker();

const t1 = queue.addTask("Design task queue module");
const t2 = queue.addTask("Implement task queue");
const t3 = queue.addTask("Add startTask later");

console.log("After adding 3 tasks:");
console.log(queue.listTasks());

queue.startTask(t1.id);
queue.startTask(t2.id);

console.log("\nAfter starting first two:");
console.log(queue.listTasks());

queue.completeTask(t1.id);
queue.completeTask(t2.id);

console.log("\nAfter completing first two:");
console.log(queue.listTasks());

// --- SafeTaskTracker demo ---
import { SafeTaskTracker } from "./safe-task-tracker.js";

console.log("\n--- SafeTaskTracker demo ---");
const safe = new SafeTaskTracker();

const r1 = safe.addTask("Buy groceries");
console.log("addTask:", r1);

const r2 = safe.startTask(1);
console.log("startTask(1):", r2);

const r3 = safe.completeTask(1);
console.log("completeTask(1):", r3);

// Error cases — no crash, just Result
const r4 = safe.startTask(999);
console.log("startTask(999):", r4);

const r5 = safe.completeTask(1);
console.log("completeTask(1) again:", r5);
