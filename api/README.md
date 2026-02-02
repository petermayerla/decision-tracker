# Tasks API

Express API for the Tasks application with reflection tracking, LLM-powered suggestions, and daily briefings.

## Features

- **Task Management**: CRUD operations for goals/tasks with parent-child relationships
- **Reflections**: Track what worked/didn't work after completing actions (signal-based or free-form)
- **LLM Suggestions**: AI-powered suggestions for goal clarity (outcome, metric, horizon)
- **Daily Briefings**: Personalized morning briefings based on goals and past reflections
- **Deterministic Fallback**: Works without API key, falls back to rule-based suggestions

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | No | - | Anthropic API key for Claude. If missing, uses deterministic fallback |
| `PORT` | No | `3333` | API server port |

## Development Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

   Server runs on `http://localhost:3333`

3. **Optional: Set API key for LLM features:**
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   npm start
   ```

## API Endpoints

### Tasks

#### `GET /tasks`
List all goals/tasks.

**Query Parameters:**
- `parentId` (optional): Filter tasks by parent goal ID

**Response:**
```json
{
  "ok": true,
  "value": [
    {
      "id": 1,
      "text": "Improve team communication",
      "status": "todo",
      "outcome": "All team members feel heard",
      "metric": "Weekly satisfaction score",
      "horizon": "End of Q1",
      "parentId": null,
      "suggestedActions": ["Schedule weekly 1-on-1s", ...]
    }
  ]
}
```

#### `POST /tasks`
Create a new goal or action.

**Request Body:**
```json
{
  "text": "Improve team communication",
  "parentId": null,
  "outcome": "All team members feel heard",
  "metric": "Weekly satisfaction score",
  "horizon": "End of Q1"
}
```

#### `POST /tasks/:id/start`
Mark a task as in progress.

#### `POST /tasks/:id/done`
Mark a task as completed.

### Reflections

#### `POST /reflections`
Save a reflection after completing an action.

**Request Body (signal-based):**
```json
{
  "goalId": 1,
  "actionId": 2,
  "signals": ["clear_step", "enough_time"],
  "note": "The weekly standup format worked well"
}
```

**Request Body (prompt-answer):**
```json
{
  "goalId": 1,
  "actionId": 2,
  "answers": [
    {
      "promptId": "what-worked",
      "value": "The new meeting format reduced context switching"
    }
  ]
}
```

**Valid Signals:**
- `clear_step` - The action was clear and unambiguous
- `enough_time` - Had sufficient time to complete
- `context_switching` - Too much context switching
- `low_energy` - Low energy during execution
- `unclear_action` - Action was ambiguous or unclear

**Response:**
```json
{
  "ok": true,
  "value": {
    "id": "a3b2c1d4-...",
    "createdAt": "2026-02-02T21:30:00.000Z",
    "goalId": 1,
    "actionId": 2,
    "signals": ["clear_step", "enough_time"],
    "note": "The weekly standup format worked well"
  }
}
```

**Validation:**
- Must provide at least one of: `signals`, `note`, or `answers`
- `signals` must be from the valid signals list
- `goalId` is required

#### `GET /reflections`
List reflections with optional filters.

**Query Parameters:**
- `goalId` (optional): Filter by goal ID
- `actionId` (optional): Filter by action ID
- `days` (optional): Only reflections from last N days

**Response:**
```json
{
  "ok": true,
  "value": [
    {
      "id": "a3b2c1d4-...",
      "createdAt": "2026-02-02T21:30:00.000Z",
      "goalId": 1,
      "actionId": 2,
      "signals": ["clear_step"],
      "note": "Meeting was productive"
    }
  ]
}
```

### Suggestions

#### `POST /suggestions`
Generate LLM-powered suggestions for a goal.

**Request Body:**
```json
{
  "decisionId": 1,
  "includeActions": true
}
```

**Response:**
```json
{
  "ok": true,
  "value": {
    "suggestions": [
      {
        "outcome": "Team satisfaction score of 8/10",
        "metric": "Weekly pulse survey results",
        "horizon": "End of Q1 2026",
        "actions": ["Schedule 1-on-1s", "Create feedback form"]
      }
    ],
    "usedLLM": true
  }
}
```

**Behavior:**
- Uses Claude API if `ANTHROPIC_API_KEY` is set and valid
- Falls back to deterministic rule-based suggestions if:
  - No API key configured
  - API request fails
  - Rate limit exceeded
- Includes past reflections in prompt for context-aware suggestions

#### `GET /suggestions`
Check if suggestions have been generated for a goal.

### Briefing

#### `POST /briefing`
Generate a personalized morning briefing.

**Request Body:**
```json
{
  "userName": "Alex",
  "reflections": [
    {
      "decisionId": 1,
      "createdAt": "2026-02-01T10:00:00.000Z",
      "answers": [
        {"promptId": "signals", "value": "clear_step, enough_time"}
      ]
    }
  ]
}
```

**Response:**
```json
{
  "ok": true,
  "value": {
    "greeting": "Good morning, Alex",
    "headline": "Focus on 3 actions today to build momentum",
    "focus": [
      {
        "goalId": 1,
        "goalTitle": "Improve team communication",
        "title": "Schedule 1-on-1s with each team member",
        "whyNow": "Early relationship building creates trust",
        "action": {
          "type": "start_existing_action",
          "actionId": 2,
          "actionTitle": "Schedule weekly 1-on-1s"
        }
      }
    ],
    "cta": {
      "label": "Let's do it",
      "microcopy": "Small steps, big impact"
    }
  }
}
```

## Testing

### Automated Tests

Run the integration test suite:

```bash
# Make sure the API server is running first
npm start

# In another terminal, run tests
./test-reflections.sh
```

The test suite covers:
1. Creating reflections with signals
2. Creating reflections with answers
3. Validation (rejecting invalid data)
4. Listing all reflections
5. Filtering by goalId
6. Filtering by date range
7. Verifying no breaking changes to existing endpoints

### Manual Testing

#### Test Reflection Save Flow

1. **Start the API:**
   ```bash
   npm start
   ```

2. **Complete an action in the frontend:**
   - Navigate to http://localhost:5173
   - Create a goal and action
   - Mark the action as done
   - Quick Reflection modal appears

3. **Fill out reflection:**
   - Enter your response (e.g., "The task was clear and I had enough time")
   - Click "Save"

4. **Verify persistence:**
   ```bash
   curl http://localhost:3333/reflections | jq
   ```

   Should return your saved reflection with ID, timestamp, and content.

#### Test Suggestion Flow

1. **Create a goal without clarity fields:**
   ```bash
   curl -X POST http://localhost:3333/tasks \
     -H "Content-Type: application/json" \
     -d '{"text": "Improve team communication"}'
   ```

2. **Request suggestions:**
   - In the frontend, click "+ New Goal"
   - Enter goal title and continue to clarity step
   - Click "✨ Suggest" next to outcome/metric fields
   - Suggestions should populate the fields

3. **Verify API response:**
   ```bash
   curl -X POST http://localhost:3333/suggestions \
     -H "Content-Type: application/json" \
     -d '{"decisionId": 1, "includeActions": true}' | jq
   ```

#### Test Briefing Flow

1. **Have some goals and reflections in the system**

2. **Generate briefing:**
   - In the frontend, click "Generate briefing"
   - Should show personalized greeting, focus items, and "Let's do it" button

3. **Verify API response:**
   ```bash
   curl -X POST http://localhost:3333/briefing \
     -H "Content-Type: application/json" \
     -d '{"userName": "Test User"}' | jq
   ```

## Data Storage

- **Tasks:** Stored in `api/data/decisions.json`
- **Reflections:** Stored in `api/data/reflections.json`
- **Directory:** Created automatically if missing

**Note:** The `api/data/` directory is git-ignored. Back up JSON files if you need to preserve data between deployments.

## Production Deployment

### Environment Variables (Render)

Set these in your Render dashboard:

| Variable | Value |
|----------|-------|
| `ANTHROPIC_API_KEY` | Your Claude API key (optional) |
| `PORT` | Automatically set by Render |

### Build Command
```bash
npm install
```

### Start Command
```bash
npm start
```

### Health Check
```
GET /health
```

Returns `{"status":"ok"}` when the server is running.

## Architecture Notes

### Reflection System

The reflection system supports two input formats:

1. **Signal-based** (from Reflection Sheet modal):
   - Predefined signals: `clear_step`, `enough_time`, `context_switching`, etc.
   - Optional free-form note
   - Structured data for pattern analysis

2. **Prompt-answer** (from Quick Reflection modal):
   - Dynamic prompt IDs
   - Free-form text responses
   - Flexible for different reflection types

Both formats are stored in the same `reflections.json` file and passed to the LLM for context-aware suggestions and briefings.

### LLM Integration

- **Provider:** Anthropic Claude (claude-3-5-sonnet-20241022)
- **Fallback:** Deterministic algorithm if API unavailable
- **Context:** Reflections from last 14 days included in suggestions
- **Caching:** Frontend caches daily briefings by date

### Deterministic Fallback

When LLM is unavailable, the system generates suggestions using rules:

- **Outcome:** Extracts measurable phrases from goal text
- **Metric:** Maps keywords to relevant metrics (e.g., "team" → "Team satisfaction score")
- **Horizon:** Suggests "End of [current quarter]"
- **Actions:** Template-based action suggestions

This ensures the app works offline and during rate limits.

## Troubleshooting

### Port Already in Use

```bash
# Find process on port 3333
lsof -ti:3333

# Kill it
lsof -ti:3333 | xargs kill -9

# Restart server
npm start
```

### API Key Issues

If suggestions fail with API key errors:

1. Check `.env` file or environment variable
2. Verify key format: `sk-ant-api03-...`
3. Check API quota at console.anthropic.com
4. System will fall back to deterministic suggestions

### Data Persistence Issues

If reflections/tasks aren't persisting:

1. Check `api/data/` directory exists
2. Verify write permissions
3. Check for JSON syntax errors in data files
4. Clear and restart: `npm run reset` (if available)

## Contributing

When adding new endpoints:

1. Add route handler in `src/server.ts`
2. Add corresponding function in store file (if needed)
3. Update this README with endpoint documentation
4. Add test cases to `test-reflections.sh`
5. Update frontend API client in `web/src/api.ts`
