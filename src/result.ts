export type ErrorCode = "NOT_FOUND" | "INVALID_TRANSITION";

export type TrackerError = {
  code: ErrorCode;
  message: string;
};

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: TrackerError };
