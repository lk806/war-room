import type { FastifyInstance } from "fastify";
import { requireUser } from "../lib/session.ts";
import { requireMember } from "../services/groups.ts";
import { subscribe, unsubscribe } from "../services/realtime.ts";

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  /**
   * 组内实时事件流（SSE）。
   * 用途：看板互相同步、AI 任务进度、DDL 提醒推送。
   * 前端用 EventSource 订阅，断开后浏览器会自动重连。
   */
  app.get("/api/groups/:groupId/events", async (request, reply) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    requireMember(groupId, user.id);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(": connected\n\n");
    res.write(
      `event: ready\ndata: ${JSON.stringify({ groupId, at: new Date().toISOString() })}\n\n`,
    );

    const sub = subscribe(groupId, user.id, res);
    request.raw.on("close", () => {
      unsubscribe(sub);
      res.end();
    });
  });
}
