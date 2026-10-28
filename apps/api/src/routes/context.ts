import { get } from "../db/index.ts";
import { notFound } from "../lib/http.ts";
import { requireMember } from "../services/groups.ts";
import type { TaskContext } from "../services/tasks.ts";

/** 任务级接口：由 taskId 反查 groupId 并校验成员身份 */
export function taskContext(userId: string, taskId: string): TaskContext {
  const row = get<{ group_id: string }>(
    "SELECT group_id FROM tasks WHERE id = ?",
    taskId,
  );
  if (!row) throw notFound("任务不存在");
  requireMember(row.group_id, userId);
  return { groupId: row.group_id, userId };
}

/** 小组级接口：校验成员身份 */
export function groupContext(userId: string, groupId: string): TaskContext {
  requireMember(groupId, userId);
  return { groupId, userId };
}
