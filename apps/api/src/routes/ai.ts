import type { FastifyInstance } from "fastify";
import {
  activateAiSchema,
  batchCreateTasksSchema,
  splitRequestSchema,
  updateAiKeySchema,
} from "@war-room/shared";
import { aiStatus } from "../ai/client.ts";
import { parseBody } from "../lib/http.ts";
import { AI_LIMIT_PER_MIN, rateLimit } from "../lib/rate-limit.ts";
import { requireUser } from "../lib/session.ts";
import { resolveLlmCredential } from "../lib/ai-credential.ts";
import { activateAi, saveUserDeepseekKey } from "../services/auth.ts";
import { countMembers, requireMember } from "../services/groups.ts";
import { previewSplit } from "../services/split.ts";
import { createTask } from "../services/tasks.ts";

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  /** 前端用来显示「已连接大模型 / 演示模式」 */
  app.get("/api/ai/status", async (request) => {
    requireUser(request);
    return aiStatus();
  });

  /** 保存 / 清除自己的 DeepSeek Key（空字符串 = 清除） */
  app.put("/api/ai/key", async (request) => {
    const user = requireUser(request);
    rateLimit("byok", user.id, 10);
    const input = parseBody(updateAiKeySchema, request.body);
    const updated = saveUserDeepseekKey(user.id, input.key);
    return { user: updated };
  });

  /** 输入 AI 授权码，开通 AI 功能 */
  app.post("/api/ai/activate", async (request) => {
    const user = requireUser(request);
    // 防暴力猜码：同一用户每分钟最多试 10 次
    rateLimit("activate", user.id, 10);
    const input = parseBody(activateAiSchema, request.body);
    const updated = activateAi(user.id, input.code);
    return { user: updated };
  });

  /** 任务拆分预览：返回草稿，不落库，等用户确认 */
  app.post("/api/groups/:groupId/ai/split", async (request) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    requireMember(groupId, user.id);
    // 凭据解析同时承担权限判断：没配 Key 又没授权 → 403
    const credential = resolveLlmCredential(user);
    // 会消耗大模型额度，按用户限流
    rateLimit("ai", user.id, AI_LIMIT_PER_MIN);

    const input = parseBody(splitRequestSchema, request.body);
    return previewSplit({ groupId, userId: user.id }, input, countMembers(groupId), credential);
  });

  /** 确认草稿后批量建任务 */
  app.post("/api/groups/:groupId/tasks/batch", async (request, reply) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    requireMember(groupId, user.id);

    const input = parseBody(batchCreateTasksSchema, request.body);
    const tasks = input.items.map((item) =>
      createTask(
        { groupId, userId: user.id },
        {
          title: item.title,
          description: item.description ?? "",
          priority: item.priority,
          assigneeId: item.assigneeId ?? null,
          estimateHours: item.estimateHours ?? null,
          status: "TODO",
        },
      ),
    );

    reply.code(201);
    return { tasks, jobId: input.jobId ?? null };
  });
}
