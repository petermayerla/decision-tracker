# Manual Testing Guide

## Testing Suggestion Field Population

### Test Case 1: Metric Suggest Button

**Setup:**
1. Open http://localhost:5173 in browser
2. Open DevTools Console (Cmd+Option+J on Mac)
3. Click "+ New Goal" button
4. Enter goal title: "Launch new product feature"
5. Click "Continue" to proceed to clarity step

**Test Steps:**
1. Click "✨ Suggest" button next to "How will you measure it?"
2. Observe DevTools Console logs (dev mode only)
3. Verify metric field populates with a value
4. Expected console logs:
   ```
   [Suggest metric] Received 4 suggestions: [...]
   [Suggest metric] Found suggestion with kind=metric and field populated: "Adoption rate (%)"
   ```

**Success Criteria:**
- ✅ API request is made to POST /suggestions
- ✅ Console shows suggestions received
- ✅ Metric field populates with a concrete metric value
- ✅ No error message appears

**Failure Scenarios:**
- ❌ If no metric field populated but kind=metric exists:
  - Should fall back to suggestion.title
  - Console: `[Suggest metric] Found suggestion with kind=metric, using title as fallback: "Track weekly active users"`

- ❌ If no suggestions with kind=metric:
  - Should show error: "No metric suggestion returned — try again or enter manually"
  - Console: `[Suggest metric] No metric suggestion returned — try again or enter manually`

### Test Case 2: Outcome Suggest Button

**Test Steps:**
1. Click "✨ Suggest" button next to "What does success look like?"
2. Observe DevTools Console logs
3. Verify outcome field populates with a value

**Success Criteria:**
- ✅ Outcome field populates with a concrete outcome statement
- ✅ Console shows matching suggestion found

### Test Case 3: Fallback Behavior

**Setup:**
Create a goal with existing outcome and metric to force edge case suggestions.

**Test Steps:**
1. Create goal with title "Test edge cases"
2. Manually enter outcome: "Users can complete task X"
3. Manually enter metric: "Completion rate > 80%"
4. Click "✨ Suggest" next to horizon
5. Verify horizon suggestion works

**Success Criteria:**
- ✅ Horizon field populates (either from horizon field or title fallback)
- ✅ No errors shown

## API Response Verification

### Check Suggestion Structure

```bash
curl -X POST http://localhost:3333/suggestions \
  -H "Content-Type: application/json" \
  -d '{
    "id": 12,
    "title": "Launch new product feature",
    "status": "todo"
  }' | jq '.value.suggestions[] | {kind, outcome, metric, horizon, title}'
```

**Expected Response:**
```json
{
  "kind": "outcome",
  "outcome": "Feature accessible to [users]",
  "metric": null,
  "horizon": null,
  "title": "Define what launch-ready means"
}
{
  "kind": "metric",
  "outcome": null,
  "metric": "Adoption rate (%) or usage (daily actives)",
  "horizon": null,
  "title": "Pick one number that proves it's working"
}
```

**Verify:**
- ✅ Each suggestion has `kind` field matching its type
- ✅ Metric suggestions have populated `metric` field
- ✅ Outcome suggestions have populated `outcome` field
- ✅ All suggestions have `title` field (fallback value)

## Debug Mode

All console logs are wrapped in `import.meta.env.DEV` checks, so they only appear in development mode (Vite dev server).

To disable logs in production, build with:
```bash
npm run build
```

Built assets will not include console logs.
