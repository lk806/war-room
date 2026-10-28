import type { FastifyInstance } from "fastify";
import {
  createGroupSchema,
  createTaskSchema,
  joinGroupSchema,
} from "@war-room/shared";
import { parseBody } from "../lib/http.ts";
import { AUTH_LIMIT_PER_MIN, rateLimit } from "../lib/rate-limit.ts";
import { requireUser } from "../lib/session.ts";
import { createGroup, getGroupDetail, joinGroup, listGroups } from "../services/groups.ts";
import { createTask, listTasks } from "../services/tasks.ts";
import { sweepReminders } from "../services/reminders.ts";
import { groupContext } from "./context.ts";

export async function groupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/groups", async (request) => {
    const user = requireUser(request);
    return { groups: listGroups(user.id) };
  });

  app.post("/api/groups", async (request, reply) => {
    const user = requireUser(request);
    const input = parseBody(createGroupSchema, request.body);
    const group = createGroup(user.id, input);
    reply.code(201);
    return { group };
  });

  app.post("/api/groups/join", async (request, reply) => {
    const user = requireUser(request);
    // 邀请码是 6 位，公网部署后要防暴力猜码
    rateLimit("auth", request.ip, AUTH_LIMIT_PER_MIN);
    const input = parseBody(joinGroupSchema, request.body);
    const group = joinGroup(user.id, input.inviteCode);
    reply.code(201);
    return { group };
  });

  app.get("/api/groups/:groupId", async (request) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    return getGroupDetail(groupId, user.id);
  });

  /** 看板一次拉全：组信息 + 成员 + 任务，减少首屏往返 */
  app.get("/api/groups/:groupId/board", async (request) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    const { group, members } = getGroupDetail(groupId, user.id);
    return { group, members, tasks: listTasks(groupId) };
  });

  app.post("/api/groups/:groupId/tasks", async (request, reply) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    const ctx = groupContext(user.id, groupId);
    const input = parseBody(createTaskSchema, request.body);
    const task = createTask(ctx, input);
    // 新建的任务如果已经落在提醒窗口内，立即补发（也方便测试）
    sweepReminders();
    reply.code(201);
    return { task };
  });

  app.get("/api/groups/:groupId/tasks", async (request) => {
    const user = requireUser(request);
    const { groupId } = request.params as { groupId: string };
    groupContext(user.id, groupId);
    return { tasks: listTasks(groupId) };
  });
}
