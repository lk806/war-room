import type { FastifyInstance } from "fastify";
import { createCommentSchema, moveTaskSchema, updateTaskSchema } from "@war-room/shared";
import { parseBody } from "../lib/http.ts";
import { requireUser } from "../lib/session.ts";
import {
  addComment,
  deleteTask,
  listActivity,
  listComments,
  moveTask,
  updateTask,
} from "../services/tasks.ts";
import { taskContext } from "./context.ts";
import { sweepReminders } from "../services/reminders.ts";

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  app.patch("/api/tasks/:taskId", async (request) => {
    const user = requireUser(request);
    const { taskId } = request.params as { taskId: string };
    const input = parseBody(updateTaskSchema, request.body);
    const task = updateTask(taskContext(user.id, taskId), taskId, input);
    // 改了 DDL 或状态后重新评估提醒
    sweepReminders();
    return { task };
  });

  app.post("/api/tasks/:taskId/move", async (request) => {
    const user = requireUser(request);
    const { taskId } = request.params as { taskId: string };
    const input = parseBody(moveTaskSchema, request.body);
    const task = moveTask(taskContext(user.id, taskId), taskId, input);
    return { task };
  });

  app.delete("/api/tasks/:taskId", async (request) => {
    const user = requireUser(request);
    const { taskId } = request.params as { taskId: string };
    deleteTask(taskContext(user.id, taskId), taskId);
    return { ok: true };
  });

  app.get("/api/tasks/:taskId/comments", async (request) => {
    const user = requireUser(request);
    const { taskId } = request.params as { taskId: string };
    const ctx = taskContext(user.id, taskId);
    return { comments: listComments(ctx.groupId, taskId) };
  });

  app.post("/api/tasks/:taskId/comments", async (request, reply) => {
    const user = requireUser(request);
    const { taskId } = request.params as { taskId: string };
    const ctx = taskContext(user.id, taskId);
    const input = parseBody(createCommentSchema, request.body);
    const comment = addComment(ctx, taskId, input);
    reply.code(201);
    return { comment };
  });

  app.get("/api/tasks/:taskId/activity", async (request) => {
    const user = requireUser(request);
    const { taskId } = request.params as { taskId: string };
    const ctx = taskContext(user.id, taskId);
    return { activity: listActivity(ctx.groupId, taskId) };
  });
}
