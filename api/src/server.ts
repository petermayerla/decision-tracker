import express from "express";
import cors from "cors";
import { writeFileSync } from "node:fs";
import { loadTracker, saveTracker, STORE_PATH } from "../../src/store.js";
import { TaskStatus } from "../../src/task-tracker.js";
import { getSuggestions } from "../../src/suggestions.js";
import { generateSuggestionsLLM } from "./decision-suggestions.js";
import { generateBriefingLLM } from "./morning-briefing.js";
import { appendReflection, listReflections } from "./reflections-store.js";

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

  const parentId = req.query.parentId;
  if (parentId !== undefined) {
    const pid = Number(parentId);
    result.value = result.value.filter((t) => t.parentId === pid);
  }

  res.json(result);
});

app.post("/tasks", (req, res) => {
  const { title, parentId, kind } = req.body;
  if (!title || typeof title !== "string") {
    res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "title is required" } });
    return;
  }
  if (parentId !== undefined && typeof parentId !== "number") {
    res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "parentId must be a number" } });
    return;
  }

  const tracker = loadTracker();
  const result = tracker.addTask(title, { parentId, kind });
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

app.post("/suggestions", async (req, res) => {
  const { id, title } = req.body;
  if (!id || !title || typeof title !== "string") {
    res.status(400).json({ ok: false, error: { code: "BAD_REQUEST", message: "id and title are required" } });
    return;
  }
  const tracker = loadTracker();
  const listResult = tracker.listTasks();
  const allDecisions = listResult.ok ? listResult.value : [];
  const reflections = Array.isArray(req.body.reflections) ? req.body.reflections : undefined;
  const suggestions = await generateSuggestionsLLM(
    {
      id: Number(id),
      title,
      status: req.body.status,
      outcome: typeof req.body.outcome === "string" ? req.body.outcome : undefined,
      metric: typeof req.body.metric === "string" ? req.body.metric : undefined,
      horizon: typeof req.body.horizon === "string" ? req.body.horizon : undefined,
    },
    allDecisions,
    reflections,
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

app.post("/briefing", async (req, res) => {
  const tracker = loadTracker();
  const listResult = tracker.listTasks();
  const allTasks = listResult.ok ? listResult.value : [];

  // Load reflections from store (last 14 days)
  const storedReflections = listReflections({ sinceDays: 14 });

  // Map to ReflectionInput format expected by generateBriefingLLM
  const reflectionsInput = storedReflections.map((ref) => ({
    decisionId: ref.goalId,
    createdAt: ref.createdAt,
    answers: [
      { promptId: "signals", value: ref.signals.join(", ") },
      ...(ref.note ? [{ promptId: "note", value: ref.note }] : []),
    ],
  }));

  const userName = typeof req.body.userName === "string" ? req.body.userName : undefined;
  const briefing = await generateBriefingLLM(allTasks, reflectionsInput, userName);
  res.json({ ok: true, value: briefing });
});

app.post("/reflections", (req, res) => {
  const { goalId, actionId, signals, note } = req.body;

  const result = appendReflection({ goalId, actionId, signals, note });
  res.status(result.ok ? 201 : 400).json(result);
});

app.get("/reflections", (req, res) => {
  const goalId = req.query.goalId ? Number(req.query.goalId) : undefined;
  const actionId = req.query.actionId ? Number(req.query.actionId) : undefined;
  const sinceDays = req.query.days ? Number(req.query.days) : undefined;

  const reflections = listReflections({ goalId, actionId, sinceDays });
  res.json({ ok: true, value: reflections });
});

app.post("/reset", (_req, res) => {
  const json = [
    { id: 1, title: "Decide on Q3 pricing strategy", status: "todo" as const, outcome: "Pricing approved by leadership", metric: "Revenue impact ($)", horizon: "end of June", kind: "goal" as const },
    { id: 2, title: "Research competitor pricing", status: "todo" as const, parentId: 1, kind: "action" as const },
    { id: 3, title: "Draft pricing tiers document", status: "todo" as const, parentId: 1, kind: "action" as const },
    { id: 4, title: "Choose analytics vendor", status: "in-progress" as const, outcome: "Vendor contract signed", metric: "Integration time (days)", horizon: "2 weeks", kind: "goal" as const },
    { id: 5, title: "Finalise onboarding flow", status: "done" as const, outcome: "New users complete onboarding", metric: "Completion rate (%)", horizon: "last sprint", kind: "goal" as const },
  ];
  writeFileSync(STORE_PATH, JSON.stringify(json, null, 2) + "\n");
  res.json({ ok: true, value: json });
});

const PORT = Number(process.env.PORT) || 3333;
app.listen(PORT, () => {
  console.log(`Tasks API running on port ${PORT}`);
});
