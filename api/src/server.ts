import express from "express";
import cors from "cors";
import { writeFileSync } from "node:fs";
import { loadTracker, saveTracker, STORE_PATH } from "../../src/store.js";
import { TaskStatus } from "../../src/task-tracker.js";
import { getSuggestions } from "../../src/suggestions.js";
import { generateSuggestions } from "./decision-suggestions.js";

const app = express();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : ["http://localhost:5173"];

const vercelPattern = /^https:\/\/decision-tracker.*\.vercel\.app$/;

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (vercelPattern.test(origin)) return cb(null, true);
    console.warn(`CORS blocked: ${origin}`);
    cb(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  optionsSuccessStatus: 204,
}));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, value: "ok" });
});

app.get("/tasks", (req, res) => {
  const tracker = loadTracker();
  const result = tracker.listTasks();
  if (!result.ok) {
    res.status(500).json(result);
    return;
  }

  const status = req.query.status as TaskStatus | undefined;
  if (status) {
    result.value = result.value.filter((t) => t.status === status);
  }

  res.json(result);
});

app.post("/tasks", (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== "string") {
    res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "title is required" } });
    return;
  }

  const tracker = loadTracker();
  const result = tracker.addTask(title);
  if (result.ok) saveTracker(tracker);
  res.status(result.ok ? 201 : 400).json(result);
});

app.patch("/tasks/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "invalid id" } });
    return;
  }

  const { outcome, metric, horizon } = req.body;
  const patch: Record<string, string> = {};
  if (typeof outcome === "string") patch.outcome = outcome;
  if (typeof metric === "string") patch.metric = metric;
  if (typeof horizon === "string") patch.horizon = horizon;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "no valid fields to update" } });
    return;
  }

  const tracker = loadTracker();
  const result = tracker.updateTask(id, patch);
  if (result.ok) saveTracker(tracker);
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/tasks/:id/start", (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "invalid id" } });
    return;
  }

  const tracker = loadTracker();
  const result = tracker.startTask(id);
  if (result.ok) saveTracker(tracker);
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/tasks/:id/done", (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "invalid id" } });
    return;
  }

  const tracker = loadTracker();
  const result = tracker.completeTask(id);
  if (result.ok) saveTracker(tracker);
  res.status(result.ok ? 200 : 400).json(result);
});

app.post("/suggestions", (req, res) => {
  const { id, title } = req.body;
  if (!id || !title || typeof title !== "string") {
    res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "id and title are required" } });
    return;
  }
  const tracker = loadTracker();
  const listResult = tracker.listTasks();
  const allDecisions = listResult.ok ? listResult.value : [];
  const suggestions = generateSuggestions(
    {
      id: Number(id),
      title,
      outcome: typeof req.body.outcome === "string" ? req.body.outcome : undefined,
      metric: typeof req.body.metric === "string" ? req.body.metric : undefined,
      horizon: typeof req.body.horizon === "string" ? req.body.horizon : undefined,
    },
    allDecisions,
  );
  res.json({ ok: true, value: { suggestions } });
});

app.get("/suggestions", (req, res) => {
  const limit = Number(req.query.limit) || 5;
  const tracker = loadTracker();
  const result = tracker.listTasks();
  if (!result.ok) {
    res.status(500).json(result);
    return;
  }
  const suggestions = getSuggestions(result.value, limit);
  res.json({ ok: true, value: suggestions });
});

app.post("/reset", (_req, res) => {
  const seeds = [
    { title: "Decide on Q3 pricing strategy", status: "todo" as const, outcome: "Pricing approved by leadership", metric: "Revenue impact ($)", horizon: "end of June" },
    { title: "Choose analytics vendor", status: "in-progress" as const, outcome: "Vendor contract signed", metric: "Integration time (days)", horizon: "2 weeks" },
    { title: "Finalise onboarding flow", status: "done" as const, outcome: "New users complete onboarding", metric: "Completion rate (%)", horizon: "last sprint" },
  ];
  const json = seeds.map((s, i) => ({ id: i + 1, ...s }));
  writeFileSync(STORE_PATH, JSON.stringify(json, null, 2) + "\n");
  res.json({ ok: true, value: json });
});

const PORT = Number(process.env.PORT) || 3333;
app.listen(PORT, () => {
  console.log(`Tasks API running on port ${PORT}`);
});
