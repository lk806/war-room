import type {
  Activity,
  ActivityType,
  Comment,
  CreateCommentInput,
  CreateTaskInput,
  MoveTaskInput,
  Task,
  TaskStatus,
  UpdateTaskInput,
} from "@war-room/shared";
import { all, get, run, tx, type SqlValue } from "../db/index.ts";
import { badRequest, conflict, forbidden, notFound } from "../lib/http.ts";
import { newId, nowIso } from "../lib/id.ts";
import { requireMember, recordContribution } from "./groups.ts";
import { publish } from "./realtime.ts";

export interface TaskContext {
  groupId: string;
  userId: string;
}

interface TaskRow {
  id: string;
  group_id: string;
  parent_id: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Task["priority"];
  due_at: string | null;
  assignee_id: string | null;
  estimate_hours: number | null;
  position: number;
  meeting_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

const toTask = (row: TaskRow): Task => ({
  id: row.id,
  groupId: row.group_id,
  parentId: row.parent_id,
  title: row.title,
  description: row.description,
  status: row.status,
  priority: row.priority,
  dueAt: row.due_at,
  assigneeId: row.assignee_id,
  estimateHours: row.estimate_hours,
  position: row.position,
  meetingId: row.meeting_id,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
});

function logActivity(
  taskId: string,
  actorId: string,
  type: ActivityType,
  fromStatus: TaskStatus | null,
  toStatus: TaskStatus | null,
  payload?: Record<string, unknown>,
): void {
  run(
    `INSERT INTO task_activity
       (id, task_id, actor_id, type, from_status, to_status, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    taskId,
    actorId,
    type,
    fromStatus,
    toStatus,
    payload ? JSON.stringify(payload) : null,
    nowIso(),
  );
}

/** 新任务插到列首：取当前最小 position 再减 1024（浮点排序，避免整列重排） */
function topPosition(groupId: string, status: TaskStatus): number {
  const row = get<{ minimum: number | null }>(
    "SELECT MIN(position) AS minimum FROM tasks WHERE group_id = ? AND status = ?",
    groupId,
    status,
  );
  return (row?.minimum ?? 1024) - 1024;
}

function assertAssignee(groupId: string, assigneeId: string | null | undefined): void {
  if (!assigneeId) return;
  const member = get<{ user_id: string }>(
    "SELECT user_id FROM memberships WHERE group_id = ? AND user_id = ?",
    groupId,
    assigneeId,
  );
  if (!member) throw badRequest("负责人必须是本组成员");
}

function assertDueAt(dueAt: string | null | undefined): string | null {
  if (!dueAt) return null;
  const parsed = new Date(dueAt);
  if (Number.isNaN(parsed.getTime())) throw badRequest("截止时间格式不正确");
  return parsed.toISOString();
}

/**
 * 完成分：记给**负责人**（不是点按钮的人）。
 * 负责人为空时退回给操作人，避免任务没人认领就没人得分。
 */
function awardCompletion(ctx: TaskContext, taskId: string, before: Task): void {
  const owner = before.assigneeId ?? ctx.userId;
  recordContribution(ctx.groupId, owner, "task_completed", "task", taskId, {
    title: before.title,
  });
}

/**
 * 「已完成」是组长验收后的结论：**任何进入已完成的操作都只有组长能做**
 * （待办→已完成、进行中→已完成、待评审→已完成，以及 PATCH 改状态、直接新建为已完成）。
 * 反向操作（从已完成退出来）不限制。
 */
function assertCanComplete(ctx: TaskContext, next: TaskStatus): void {
  if (next !== "DONE") return;
  const { role } = requireMember(ctx.groupId, ctx.userId);
  if (role !== "LEADER") {
    throw forbidden("只有组长可以把任务移到「已完成」（需要验收）");
  }
}

/**
 * 评审分：任务从「待评审」被**非负责人**推进到「已完成」时，
 * 给推进的人记一次评审贡献（4 分）。一个任务只记一次，避免来回拖动刷分。
 */
function awardReviewCredit(ctx: TaskContext, taskId: string, before: Task): void {
  if (before.status !== "REVIEW") return;
  if (!before.assigneeId || before.assigneeId === ctx.userId) return;

  const existing = get<{ id: string }>(
    `SELECT id FROM contribution_events
      WHERE ref_type = 'task' AND ref_id = ? AND kind = 'task_reviewed'`,
    taskId,
  );
  if (existing) return;

  recordContribution(ctx.groupId, ctx.userId, "task_reviewed", "task", taskId, {
    title: before.title,
  });
}

export function listTasks(groupId: string): Task[] {
  return all<TaskRow>(
    "SELECT * FROM tasks WHERE group_id = ? ORDER BY position ASC",
    groupId,
  ).map(toTask);
}

export function getTaskOrThrow(groupId: string, taskId: string): Task {
  const row = get<TaskRow>(
    "SELECT * FROM tasks WHERE id = ? AND group_id = ?",
    taskId,
    groupId,
  );
  if (!row) throw notFound("任务不存在");
  return toTask(row);
}

export function createTask(
  ctx: TaskContext,
  input: CreateTaskInput,
  extras: { meetingId?: string | null } = {},
): Task {
  assertAssignee(ctx.groupId, input.assigneeId);
  const status = input.status ?? "TODO";
  // 直接在「已完成」列新建任务同样算进入已完成
  assertCanComplete(ctx, status);
  const now = nowIso();
  const id = newId();

  const task: Task = {
    id,
    groupId: ctx.groupId,
    parentId: null,
    title: input.title,
    description: input.description ?? "",
    status,
    priority: input.priority ?? "MEDIUM",
    dueAt: assertDueAt(input.dueAt),
    assigneeId: input.assigneeId ?? null,
    estimateHours: input.estimateHours ?? null,
    position: topPosition(ctx.groupId, status),
    meetingId: extras.meetingId ?? null,
    createdBy: ctx.userId,
    createdAt: now,
    updatedAt: now,
    completedAt: status === "DONE" ? now : null,
  };

  tx(() => {
    run(
      `INSERT INTO tasks
         (id, group_id, parent_id, title, description, status, priority, due_at,
          assignee_id, estimate_hours, position, meeting_id, created_by,
          created_at, updated_at, completed_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      task.id,
      task.groupId,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.dueAt,
      task.assigneeId,
      task.estimateHours,
      task.position,
      task.meetingId,
      task.createdBy,
      task.createdAt,
      task.updatedAt,
      task.completedAt,
    );
    logActivity(task.id, ctx.userId, "CREATED", null, task.status, {
      title: task.title,
    });
    recordContribution(ctx.groupId, ctx.userId, "task_created", "task", task.id, {
      title: task.title,
    });
    if (task.status === "DONE") {
      recordContribution(
        ctx.groupId,
        task.assigneeId ?? ctx.userId,
        "task_completed",
        "task",
        task.id,
        { title: task.title },
      );
    }
  });

  publish(ctx.groupId, { type: "task.created", task });
  return task;
}

export function updateTask(
  ctx: TaskContext,
  taskId: string,
  input: UpdateTaskInput,
): Task {
  const current = getTaskOrThrow(ctx.groupId, taskId);
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== current.updatedAt) {
    throw conflict("任务刚被其他成员修改过，请刷新后重试");
  }
  if (input.status !== undefined && input.status !== current.status) {
    assertCanComplete(ctx, input.status);
  }

  const sets: string[] = [];
  const params: SqlValue[] = [];
  const changedFields: string[] = [];

  const put = (column: string, value: SqlValue): void => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  if (input.title !== undefined && input.title !== current.title) {
    put("title", input.title);
    changedFields.push("title");
  }
  if (input.description !== undefined && input.description !== current.description) {
    put("description", input.description);
    changedFields.push("description");
  }
  if (input.priority !== undefined && input.priority !== current.priority) {
    put("priority", input.priority);
    changedFields.push("priority");
  }
  if (input.dueAt !== undefined) {
    const nextDue = assertDueAt(input.dueAt);
    if (nextDue !== current.dueAt) {
      put("due_at", nextDue);
      changedFields.push("dueAt");
    }
  }
  if (input.estimateHours !== undefined && input.estimateHours !== current.estimateHours) {
    put("estimate_hours", input.estimateHours);
    changedFields.push("estimateHours");
  }
  if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
    assertAssignee(ctx.groupId, input.assigneeId);
    put("assignee_id", input.assigneeId);
    changedFields.push("assignee");
  }
  if (input.status !== undefined && input.status !== current.status) {
    put("status", input.status);
    put("completed_at", input.status === "DONE" ? nowIso() : null);
    put("position", topPosition(ctx.groupId, input.status));
    changedFields.push("status");
  }

  if (changedFields.length === 0) return current;

  const updatedAt = nowIso();
  put("updated_at", updatedAt);

  tx(() => {
    run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, ...params, taskId);

    if (input.status !== undefined && input.status !== current.status) {
      logActivity(taskId, ctx.userId, "STATUS_CHANGED", current.status, input.status);
    }
    const assigneeChanged = changedFields.includes("assignee");
    const otherFields = changedFields.filter(
      (field) => field !== "status" && field !== "assignee",
    );
    if (assigneeChanged) {
      logActivity(taskId, ctx.userId, "ASSIGNED", null, null, {
        from: current.assigneeId,
        to: input.assigneeId ?? null,
      });
    }
    if (otherFields.length > 0) {
      logActivity(taskId, ctx.userId, "UPDATED", null, null, { fields: otherFields });
    }

    // 完成状态与贡献事件保持同步：回退时撤销，避免重复计分
    if (input.status === "DONE" && current.status !== "DONE") {
      awardCompletion(ctx, taskId, current);
      awardReviewCredit(ctx, taskId, current);
    } else if (input.status !== undefined && input.status !== "DONE" && current.status === "DONE") {
      run(
        "DELETE FROM contribution_events WHERE ref_type = 'task' AND ref_id = ? AND kind = 'task_completed'",
        taskId,
      );
    }
  });

  const task = getTaskOrThrow(ctx.groupId, taskId);
  publish(ctx.groupId, { type: "task.updated", task });
  return task;
}

export function moveTask(
  ctx: TaskContext,
  taskId: string,
  input: MoveTaskInput,
): Task {
  const current = getTaskOrThrow(ctx.groupId, taskId);
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== current.updatedAt) {
    throw conflict("任务刚被其他成员修改过，请刷新后重试");
  }
  assertCanComplete(ctx, input.status);

  const position = Number.isFinite(input.position) ? input.position : 1024;
  const updatedAt = nowIso();
  const statusChanged = current.status !== input.status;

  tx(() => {
    run(
      `UPDATE tasks SET status = ?, position = ?, updated_at = ?,
              completed_at = ? WHERE id = ?`,
      input.status,
      position,
      updatedAt,
      input.status === "DONE" ? (current.completedAt ?? nowIso()) : null,
      taskId,
    );

    if (statusChanged) {
      logActivity(taskId, ctx.userId, "STATUS_CHANGED", current.status, input.status);
      if (input.status === "DONE") {
        awardCompletion(ctx, taskId, current);
        awardReviewCredit(ctx, taskId, current);
      } else if (current.status === "DONE") {
        run(
          "DELETE FROM contribution_events WHERE ref_type = 'task' AND ref_id = ? AND kind = 'task_completed'",
          taskId,
        );
      }
    }
  });

  const task = getTaskOrThrow(ctx.groupId, taskId);
  publish(ctx.groupId, { type: "task.updated", task });
  return task;
}

export function deleteTask(ctx: TaskContext, taskId: string): void {
  getTaskOrThrow(ctx.groupId, taskId);
  run("DELETE FROM tasks WHERE id = ?", taskId);
  run(
    "DELETE FROM contribution_events WHERE ref_type = 'task' AND ref_id = ?",
    taskId,
  );
  publish(ctx.groupId, { type: "task.deleted", taskId });
}

/* ---------------------------- 评论 ---------------------------- */

export function listComments(groupId: string, taskId: string): Comment[] {
  getTaskOrThrow(groupId, taskId);
  return all<{
    id: string;
    task_id: string;
    author_id: string;
    body: string;
    created_at: string;
    author_name: string;
    avatar_color: string;
  }>(
    `SELECT c.id, c.task_id, c.author_id, c.body, c.created_at,
            u.name AS author_name, u.avatar_color
       FROM comments c
       JOIN users u ON u.id = c.author_id
      WHERE c.task_id = ?
      ORDER BY c.created_at ASC`,
    taskId,
  ).map((row) => ({
    id: row.id,
    taskId: row.task_id,
    authorId: row.author_id,
    authorName: row.author_name,
    authorColor: row.avatar_color,
    body: row.body,
    createdAt: row.created_at,
  }));
}

export function addComment(
  ctx: TaskContext,
  taskId: string,
  input: CreateCommentInput,
): Comment {
  const task = getTaskOrThrow(ctx.groupId, taskId);
  const id = newId();
  const createdAt = nowIso();

  run(
    `INSERT INTO comments (id, task_id, author_id, body, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    taskId,
    ctx.userId,
    input.body,
    createdAt,
  );
  logActivity(taskId, ctx.userId, "COMMENTED", null, null);
  recordContribution(ctx.groupId, ctx.userId, "comment_created", "comment", id, {
    taskId,
  });

  const author = get<{ name: string; avatar_color: string }>(
    "SELECT name, avatar_color FROM users WHERE id = ?",
    ctx.userId,
  );
  const comment: Comment = {
    id,
    taskId,
    authorId: ctx.userId,
    authorName: author?.name ?? "成员",
    authorColor: author?.avatar_color ?? "#6366f1",
    body: input.body,
    createdAt,
  };
  publish(ctx.groupId, { type: "comment.created", comment });
  void task;
  return comment;
}

/* ---------------------------- 动态 ---------------------------- */

export function listActivity(groupId: string, taskId: string): Activity[] {
  getTaskOrThrow(groupId, taskId);
  return all<{
    id: string;
    task_id: string;
    actor_id: string;
    type: ActivityType;
    from_status: TaskStatus | null;
    to_status: TaskStatus | null;
    payload_json: string | null;
    created_at: string;
    actor_name: string;
  }>(
    `SELECT a.id, a.task_id, a.actor_id, a.type, a.from_status, a.to_status,
            a.payload_json, a.created_at, u.name AS actor_name
       FROM task_activity a
       JOIN users u ON u.id = a.actor_id
      WHERE a.task_id = ?
      ORDER BY a.created_at ASC`,
    taskId,
  ).map((row) => {
    let payload: Record<string, unknown> | null = null;
    if (row.payload_json) {
      try {
        payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      } catch {
        payload = null;
      }
    }
    return {
      id: row.id,
      taskId: row.task_id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      type: row.type,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      payload,
      createdAt: row.created_at,
    };
  });
}

/* -------------------------- 看板聚合 -------------------------- */

export function getBoard(groupId: string, userId: string) {
  requireMember(groupId, userId);
  return listTasks(groupId);
}
