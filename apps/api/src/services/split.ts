import { z } from "zod";
import type { SplitItem, SplitPreview, SplitRequest } from "@war-room/shared";
import { TASK_PRIORITIES } from "@war-room/shared";
import { chatJSON, extractJson, type LlmEndpoint } from "../ai/client.ts";
import { createJob, finishJob } from "../ai/jobs.ts";
import { mockSplit } from "../ai/mock.ts";
import { splitMessages } from "../ai/prompts.ts";
import type { LlmCredential } from "../lib/ai-credential.ts";
import { ApiError } from "../lib/http.ts";

const modelSchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        estimateHours: z.union([z.number(), z.string()]).optional(),
        priority: z.string().optional(),
        suggestedRole: z.string().optional(),
      }),
    )
    .min(1)
    .max(12),
});

const clampText = (value: string | undefined, max: number, fallback = ""): string =>
  (value ?? fallback).trim().slice(0, max);

function normalize(raw: z.infer<typeof modelSchema>["tasks"][number], index: number): SplitItem {
  const hours =
    typeof raw.estimateHours === "string" ? Number.parseFloat(raw.estimateHours) : raw.estimateHours;
  const priority = TASK_PRIORITIES.includes(
    (raw.priority ?? "").toUpperCase() as (typeof TASK_PRIORITIES)[number],
  )
    ? ((raw.priority ?? "").toUpperCase() as SplitItem["priority"])
    : "MEDIUM";

  return {
    title: clampText(raw.title, 80) || `任务 ${index + 1}`,
    description: clampText(raw.description, 500),
    estimateHours: Number.isFinite(hours) ? Math.min(Math.max(Number(hours), 0), 200) : null,
    priority,
    suggestedRole: raw.suggestedRole ? clampText(raw.suggestedRole, 24) : null,
    assigneeId: null,
  };
}

async function requestSplit(
  input: SplitRequest,
  memberCount: number,
  endpoint: LlmEndpoint,
): Promise<{ items: SplitItem[]; tokens: number }> {
  let lastError = "";
  let tokens = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const messages = splitMessages({
      goal: input.goal,
      deadline: input.deadline ?? null,
      hint: input.hint ?? "",
      memberCount,
    });
    if (attempt > 0) {
      messages.push({
        role: "user",
        content: `上一次输出不符合要求：${lastError}。请只输出符合结构的 JSON。`,
      });
    }

    const result = await chatJSON(messages, { temperature: 0.3, maxTokens: 1200, endpoint });
    tokens += result.tokens;

    try {
      const parsed = modelSchema.parse(JSON.parse(extractJson(result.content)));
      return { items: parsed.tasks.slice(0, 8).map(normalize), tokens };
    } catch (error) {
      lastError =
        error instanceof z.ZodError
          ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
          : (error as Error).message;
    }
  }

  throw new ApiError(502, "大模型没有返回可用的任务拆分，请换个说法或稍后重试");
}

/** 生成任务拆分草稿（不落库，等用户确认） */
export async function previewSplit(
  ctx: { groupId: string; userId: string },
  input: SplitRequest,
  memberCount: number,
  credential: LlmCredential,
): Promise<SplitPreview> {
  const engine = credential.mode === "remote" ? "remote" : "mock";
  const jobId = createJob("SPLIT", ctx.groupId, ctx.userId, input);

  try {
    const result =
      credential.mode === "mock"
        ? { items: mockSplit(input.goal), tokens: 0 }
        : await requestSplit(input, memberCount, {
            apiKey: credential.apiKey,
            baseUrl: credential.baseUrl,
            model: credential.model,
          });

    const keySource = credential.mode === "mock" ? "mock" : credential.source;
    finishJob(jobId, {
      ok: true,
      output: { items: result.items, engine, keySource },
      tokens: result.tokens,
    });
    return { jobId, engine, goal: input.goal, items: result.items, keySource };
  } catch (error) {
    finishJob(jobId, {
      ok: false,
      error: error instanceof Error ? error.message : "任务拆分失败",
    });
    throw error;
  }
}
