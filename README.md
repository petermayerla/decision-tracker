# 🌱 Aily Tasks — One State, Three Interfaces

A small but opinionated task system demonstrating how a **single domain model**
can power a **CLI**, an **HTTP API**, and a **Web UI** — all sharing the same state.

This project is intentionally small, but carefully designed.
It focuses on **clear boundaries**, **UX consistency**, and **domain-first architecture**.

---

## ✨ What this project demonstrates

- One **domain model** owning all business rules
- Three interfaces:
  - CLI
  - REST API
  - Web UI (Aily-inspired)
- A shared persisted state (`~/.tasks.json`)
- Result-based error handling at system boundaries
- Thoughtful UX details across terminal and web
- Minimal dependencies, explicit trade-offs

---

## 🧠 Architecture overview
        ┌────────────┐
        │  CLI       │
        └─────┬──────┘
              │
        ┌─────▼──────┐
        │ SafeTask   │   ← API / boundary layer
        │ Tracker    │   (Result<T>)
        └─────┬──────┘
              │
        ┌─────▼──────┐
        │ Task       │   ← domain model
        │ Tracker    │   (throws on invariant violations)
        └─────┬──────┘
              │
      ┌───────▼────────┐
      │ ~/.tasks.json  │  ← shared persisted state
      └────────────────┘

      The **domain throws**, boundaries **translate to Result objects**.

---

## 🖥️ CLI

### Installation

```bash
npm install
npm link

tasks help
tasks add "Buy groceries"
tasks start
tasks done 1
tasks list
tasks list --status todo
tasks list --json

~/.tasks.json

cd api
npm install
npm start

GET  /health
GET  /tasks?status=todo
POST /tasks
POST /tasks/:id/start
POST /tasks/:id/done

{ "ok": true, "value": ... }
{ "ok": false, "error": { "code": "...", "message": "..." } }

cd web
npm install
npm run dev

# CLI
tasks add "Buy groceries"
tasks start
tasks list

# API
curl http://localhost:3333/tasks

# Web
open http://localhost:5173


[
  { "id": 1, "title": "Buy oat milk", "status": "in-progress" },
  { "id": 2, "title": "Write proposal", "status": "todo" }
]

---

## Deployment (Render + Vercel)

### Render (API)

| Env var | Value | Notes |
|---------|-------|-------|
| `PORT` | _(set by Render)_ | Render provides this automatically |
| `STORE_PATH` | `/var/data/.tasks.json` | Use a Render Disk mounted at `/var/data` |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` | Comma-separated if multiple origins |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Optional. Enables LLM-powered suggestions via Claude. Without it, deterministic fallback is used. |

Build command: `cd api && npm install`
Start command: `cd api && npx tsx src/server.ts`

### Vercel (Web)

| Env var | Value | Notes |
|---------|-------|-------|
| `VITE_API_BASE_URL` | `https://your-app.onrender.com` | Must be set at **build time** |

Build command: `cd web && npm install && npm run build`
Output directory: `web/dist`

---

## 📦 Client-Side Storage (localStorage)

The web UI uses localStorage for user preferences and lightweight reflection data:

| Key | Purpose | Format |
|-----|---------|--------|
| `user-name` | User's name for personalized greetings | `string` |
| `suggestions-by-goal` | Per-goal suggestion lifecycle tracking | `Record<goalId, Suggestion[]>` |
| `daily-commitments` | Daily briefing commitment dates | `Record<date, boolean>` |
| `briefing-cache` | Cached daily briefings per date | `Record<date, MorningBriefing>` |
| `briefing-dismissed` | Dismissed briefing dates | `Record<date, boolean>` |
| `reflections` | Quick reflection responses | `{ quick: QuickReflection[] }` |
| `reflections-store` | Goal completion reflections | `Record<goalId, Reflection>` |

All reflection data is stored client-side and optionally passed to the suggestions API for context-aware recommendations.

