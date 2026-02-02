/**
 * Morning briefing: picks up to 3 focus items from active goals
 * and suggests concrete actions for today.
 */

export type BriefingFocusItem = {
  goalId: number;
  goalTitle: string;
  whyNow: string;
  action: {
    type: "start_existing_action" | "finish_existing_action" | "create_new_action";
    actionId?: number;
    actionTitle: string;
  };
};

export type MorningBriefing = {
  greeting: string;
  headline: string;
  focus: BriefingFocusItem[];
  cta: { label: string; microcopy: string };
};

type TaskInput = {
  id: number;
  title: string;
  status: string;
  parentId?: number;
  kind?: string;
  outcome?: string;
  metric?: string;
  horizon?: string;
};

type ReflectionInput = {
  decisionId: number;
  createdAt: string;
  answers: { promptId: string; value: string }[];
};

const BRIEFING_SYSTEM_PROMPT = `You are a concise product coach and daily execution guide. Calm, direct, pragmatic. No hype, no motivational fluff.

You create a single "Morning Briefing" for the user to execute TODAY.

Inputs you will receive:
- userName (optional)
- todayDate (YYYY-MM-DD)
- goals: a list of top-level goals (each: id, title, status, optional outcome/metric/horizon)
- actions: a list of child actions (each: id, parentId, title, status)
- reflections (optional): past reflections for goals/actions in this system. Each reflection contains promptId and a short answer text.

Your job:
1) Select 2 focus goals max:
   - Prefer goals that are already in-progress OR have a near horizon OR have low clarity (missing outcome/metric/horizon).
   - Avoid goals that are done.
2) For each selected goal, propose exactly ONE action for today:
   - If there is an existing child action that is todo or in-progress, choose the best next one.
   - Otherwise create a new action title that is concrete, small, and finishable today.
3) Use reflections to personalize:
   - Reinforce what worked, avoid what failed, and adapt to stated blockers.
   - If the user repeatedly mentions a blocker (e.g. "context switching"), propose an action that reduces that blocker.
4) Output must be actionable in under 15 minutes to start. The goal is momentum.

Output format:
Return ONLY valid JSON. No extra text.

Schema:
{
  "greeting": string,     // e.g. "Good morning, Peter"
  "headline": string,     // short summary of why today matters
  "focus": [
    {
      "goalId": number,
      "goalTitle": string,
      "whyNow": string,   // 1 sentence, specific to this goal
      "action": {
        "type": "start_existing_action" | "finish_existing_action" | "create_new_action",
        "actionId"?: number,
        "actionTitle": string
      }
    }
  ],
  "cta": {
    "label": string,      // e.g. "Let's do it"
    "microcopy": string   // 1 short sentence, reflection-aware if possible
  }
}

Constraints:
- focus length: 2 items.
- Every whyNow must be specific to the selected goal and current state.
- Avoid repeating the goal title in actionTitle verbatim.
- If userName is missing, use a generic greeting.
- Keep it crisp. No paragraphs. No bullet lists.`;

function buildBriefingUserPrompt(goals: TaskInput[], allTasks: TaskInput[], reflections?: ReflectionInput[], userName?: string): string {
  const todayDate = new Date().toISOString().split('T')[0];

  const goalsWithActions = goals.map((g) => {
    const actions = allTasks.filter((t) => t.parentId === g.id);
    return { ...g, actions };
  });

  let prompt = `Today's date: ${todayDate}\n`;

  if (userName) {
    prompt += `User name: ${userName}\n`;
  }

  prompt += `\nActive goals with actions:\n${JSON.stringify(goalsWithActions, null, 2)}`;

  if (reflections && reflections.length > 0) {
    prompt += `\n\nPast reflections:\n${JSON.stringify(reflections, null, 2)}`;
  }

  return prompt;
}

function parseBriefingResponse(text: string): MorningBriefing | null {
  try {
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (
      typeof parsed.greeting !== "string" ||
      typeof parsed.headline !== "string" ||
      !Array.isArray(parsed.focus) ||
      !parsed.cta
    ) {
      return null;
    }

    const focus: BriefingFocusItem[] = [];
    for (const item of parsed.focus) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.goalId !== "number" || typeof item.goalTitle !== "string") continue;
      if (!item.action || typeof item.action.type !== "string") continue;
      const validTypes = ["start_existing_action", "finish_existing_action", "create_new_action"];
      if (!validTypes.includes(item.action.type)) continue;
      focus.push({
        goalId: item.goalId,
        goalTitle: item.goalTitle,
        whyNow: typeof item.whyNow === "string" ? item.whyNow : "",
        action: {
          type: item.action.type,
          actionId: typeof item.action.actionId === "number" ? item.action.actionId : undefined,
          actionTitle: typeof item.action.actionTitle === "string" ? item.action.actionTitle : "",
        },
      });
      if (focus.length >= 3) break;
    }

    if (focus.length === 0) return null;

    return {
      greeting: parsed.greeting,
      headline: parsed.headline,
      focus,
      cta: {
        label: typeof parsed.cta.label === "string" ? parsed.cta.label : "Start your day",
        microcopy: typeof parsed.cta.microcopy === "string" ? parsed.cta.microcopy : "",
      },
    };
  } catch {
    return null;
  }
}

function clarityScore(t: TaskInput): number {
  let score = 0;
  if (t.title) score += 25;
  if (t.outcome) score += 25;
  if (t.metric) score += 25;
  if (t.horizon) score += 25;
  return score;
}

export function generateBriefingDeterministic(goals: TaskInput[], allTasks: TaskInput[]): MorningBriefing {
  // Sort: in-progress first, then todo with highest clarity
  const active = goals
    .filter((g) => g.status === "in-progress" || g.status === "todo")
    .sort((a, b) => {
      if (a.status === "in-progress" && b.status !== "in-progress") return -1;
      if (b.status === "in-progress" && a.status !== "in-progress") return 1;
      return clarityScore(b) - clarityScore(a);
    })
    .slice(0, 2);  // Max 2 focus goals

  const focus: BriefingFocusItem[] = active.map((g) => {
    const actions = allTasks.filter((t) => t.parentId === g.id);
    const inProgressAction = actions.find((a) => a.status === "in-progress");
    const todoAction = actions.find((a) => a.status === "todo");

    let action: BriefingFocusItem["action"];
    let whyNow: string;

    if (inProgressAction) {
      action = { type: "finish_existing_action", actionId: inProgressAction.id, actionTitle: inProgressAction.title };
      whyNow = "This action is already in progress — finishing it moves the goal forward.";
    } else if (todoAction) {
      action = { type: "start_existing_action", actionId: todoAction.id, actionTitle: todoAction.title };
      whyNow = g.status === "in-progress"
        ? "This goal is active but needs its next action started."
        : "Starting this action gets the goal moving.";
    } else {
      action = { type: "create_new_action", actionTitle: `Define next step for "${g.title}"` };
      whyNow = "This goal has no actions yet — defining one makes it concrete.";
    }

    return { goalId: g.id, goalTitle: g.title, whyNow, action };
  });

  return {
    greeting: "Good morning.",
    headline: focus.length > 0
      ? `You have ${focus.length} goal${focus.length > 1 ? "s" : ""} that could use attention today.`
      : "No active goals right now.",
    focus,
    cta: { label: "Start your day", microcopy: "Pick one and make progress." },
  };
}

export async function generateBriefingLLM(
  allTasks: TaskInput[],
  reflections?: ReflectionInput[],
  userName?: string,
): Promise<MorningBriefing> {
  const goals = allTasks.filter((t) => !t.parentId && (t.status === "in-progress" || t.status === "todo"));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return generateBriefingDeterministic(goals, allTasks);
  }

  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const userPrompt = buildBriefingUserPrompt(goals, allTasks, reflections, userName);

    const message = await client.messages.create({
      model: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: BRIEFING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return generateBriefingDeterministic(goals, allTasks);
    }

    const briefing = parseBriefingResponse(textBlock.text);
    if (!briefing) {
      return generateBriefingDeterministic(goals, allTasks);
    }
    return briefing;
  } catch (err) {
    console.warn("LLM briefing generation failed, falling back to deterministic:", err);
    return generateBriefingDeterministic(goals, allTasks);
  }
}
