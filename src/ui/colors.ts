import chalk from "chalk";
import { TaskStatus } from "../task-tracker.js";

const STATUS_CONFIG: Record<TaskStatus, { symbol: string; color: typeof chalk.yellow }> = {
  "todo":        { symbol: "○", color: chalk.yellow },
  "in-progress": { symbol: "◐", color: chalk.blue },
  "done":        { symbol: "●", color: chalk.green },
};

export function colorStatus(status: TaskStatus): string {
  const { symbol, color } = STATUS_CONFIG[status];
  return `${color(symbol)} ${color(status)}`;
}

export function colorStatusPlain(status: TaskStatus): string {
  const { symbol } = STATUS_CONFIG[status];
  return `${symbol} ${status}`;
}

export const success = (text: string) => chalk.green(text);
export const error = (text: string) => chalk.red(text);
export const hint = (text: string) => chalk.gray(text);
