import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import {
  createMeetingSchema,
  meetingTasksSchema,
  updateTranscriptSchema,
} from "@war-room/shared";
import { parseBody } from "../lib/http.ts";
import { AI_LIMIT_PER_MIN, rateLimit } from "../lib/rate-limit.ts";
import { requireUser } from "../lib/session.ts";
import { resolveLlmCredential } from "../lib/ai-credential.ts";
import { requireMember } from "../services/groups.ts";
import {
  attachAudio,
  audioPath,
  createMeeting,
  createTasksFromActionItems,
  deleteMeeting,
  generateMinutes,
  listMeetings,
  requireMeetingAccess,
  runTranscription,
  updateTranscript,
} from "../services/meetings.ts";

export async function meetingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/groups/:groupId/meetings", async (request) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    requireMember(groupId, user.id);
    return { meetings: listMeetings(groupId) };
  });

  app.post("/api/groups/:groupId/meetings", async (request, reply) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    requireMember(groupId, user.id);
    const input = parseBody(createMeetingSchema, request.body);
    const meeting = createMeeting({ groupId, userId: user.id }, input);
    reply.code(201);
    return { meeting };
  });

  app.get("/api/meetings/:meetingId", async (request) => {
    const user = requireUser(request);
    const { meetingId } = request.params as { meetingId: string };
    return { meeting: requireMeetingAccess(meetingId, user.id).meeting };
  });

  app.delete("/api/meetings/:meetingId", async (request) => {
    const user = requireUser(request);
    const { meetingId } = request.params as { meetingId: string };
    deleteMeeting(meetingId, user.id);
    return { ok: true };
  });

  /** 上传/录制音频：落盘后立刻返回，转写在后台跑（SSE 推进度） */
  app.post("/api/meetings/:meetingId/audio", async (request, reply) => {
    const user = requireUser(request);
    const { meetingId } = request.params as { meetingId: string };
    const query = request.query as { duration?: string };
    const parsedDuration = Number(query.duration ?? 0);
    // NaN 会把 NaN 写进 SQLite，并让前端显示 "NaN:NaN"
    const durationSec =
      Number.isFinite(parsedDuration) && parsedDuration > 0
        ? Math.min(Math.round(parsedDuration), 6 * 3600)
        : 0;

    const part = await request.file();
    if (!part) throw new Error("没有收到音频");

    rateLimit("ai", user.id, AI_LIMIT_PER_MIN);
    // ASR 用平台公用 Key，所有用户都能转写（不依赖 AI 授权）
    const meeting = await attachAudio(meetingId, user.id, part, durationSec);
    // 后台任务必须自己兜住异常：否则未处理的 rejection 会直接打挂进程
    void runTranscription(meetingId).catch((error) =>
      request.log.error({ err: error, meetingId }, "音频转写任务异常"),
    );

    reply.code(202);
    return { meeting };
  });

  /** 音频回放 */
  app.get("/api/meetings/:meetingId/audio", async (request, reply) => {
    const user = requireUser(request);
    const { meetingId } = request.params as { meetingId: string };
    requireMeetingAccess(meetingId, user.id);
    const { absolute, mime, size } = audioPath(meetingId);

    // 只允许音频 MIME（上传时已按魔数判定），并显式声明内联文件名，
    // 配合全局 nosniff 头，杜绝把上传内容当 HTML 执行
    const safeMime = mime.startsWith("audio/") ? mime : "audio/webm";
    reply
      .header("Content-Type", safeMime)
      .header("Content-Length", String(size))
      .header("Content-Disposition", 'inline; filename="meeting-audio"')
      .header("X-Content-Type-Options", "nosniff")
      .header("Accept-Ranges", "none");
    return reply.send(createReadStream(absolute));
  });

  /** 重新转写 */
  app.post("/api/meetings/:meetingId/transcribe", async (request, reply) => {
    const user = requireUser(request);
    const { meetingId } = request.params as { meetingId: string };
    requireMeetingAccess(meetingId, user.id);
    // 同上：转写额度走平台公用 ASR Key
    rateLimit("ai", user.id, AI_LIMIT_PER_MIN);
    void runTranscription(meetingId).catch((error) =>
      request.log.error({ err: error, meetingId }, "重新转写任务异常"),
    );
    reply.code(202);
    return { ok: true };
  });

  /** 人工修订逐字稿 */
  app.patch("/api/meetings/:meetingId/transcript", async (request) => {
    const user = requireUser(request);
    const { meetingId } = request.params as { meetingId: string };
    const input = parseBody(updateTranscriptSchema, request.body);
    return { meeting: updateTranscript(meetingId, user.id, input.text) };
  });

  /** 生成纪要与行动项 */
  app.post("/api/meetings/:meetingId/minutes", async (request) => {
    const user = requireUser(request);
    const { meetingId } = request.params as { meetingId: string };
    // 纪要走 LLM：自带 Key 优先，其次系统公用 Key，都没有则 403
    const credential = resolveLlmCredential(user);
    rateLimit("ai", user.id, AI_LIMIT_PER_MIN);
    return { meeting: await generateMinutes(meetingId, user.id, credential) };
  });

  /** 勾选的行动项 -> 任务 */
  app.post("/api/meetings/:meetingId/tasks", async (request, reply) => {
    const user = requireUser(request);
    const { meetingId } = request.params as { meetingId: string };
    const input = parseBody(meetingTasksSchema, request.body);
    const tasks = createTasksFromActionItems(meetingId, user.id, input.actionItemIds);
    reply.code(201);
    return { tasks };
  });
}
