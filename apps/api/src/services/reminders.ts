import type { ReminderItem, ReminderLevel, TaskStatus } from "@war-room/shared";
import { all, run } from "../db/index.ts";
import { newId, nowIso } from "../lib/id.ts";
import { publish } from "./realtime.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

interface DueRow {
  id: string;
  group_id: string;
  title: string;
  due_at: string;
  status: TaskStatus;
  assignee_name: string | null;
}

/**
 * 扫描一次 24 小时窗口内的未完成任务，按剩余时间决定发哪一级提醒：
 *   ≤ 1 小时  -> 1H
 *   > 1 小时  -> 24H
 * 靠 reminders 表的 (task_id, level) 唯一键去重，重复扫描不会重复推送。
 * 返回本次新发出的提醒条数。
 */
export function sweepReminders(): number {
  const now = Date.now();
  const rows = all<DueRow>(
    `SELECT t.id, t.group_id, t.title, t.due_at, t.status, u.name AS assignee_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.status <> 'DONE'
        AND t.due_at IS NOT NULL
        AND t.due_at > ?
        AND t.due_at <= ?`,
    new Date(now).toISOString(),
    new Date(now + DAY).toISOString(),
  );

  let sent = 0;
  for (const row of rows) {
    const due = Date.parse(row.due_at);
    if (Number.isNaN(due)) continue;
    const remaining = due - now;
    if (remaining <= 0) continue;

    const level: ReminderLevel = remaining <= HOUR ? "1H" : "24H";

    const result = run(
      `INSERT OR IGNORE INTO reminders (id, task_id, group_id, level, sent_at)
       VALUES (?, ?, ?, ?, ?)`,
      newId(),
      row.id,
      row.group_id,
      level,
      nowIso(),
    );
    if (result.changes === 0) continue;

    sent += 1;
    publish(row.group_id, {
      type: "reminder.due",
      reminder: {
        taskId: row.id,
        taskTitle: row.title,
        level,
        dueAt: row.due_at,
        assigneeName: row.assignee_name,
      },
    });
  }

  return sent;
}

export function listReminders(groupId: string, limit = 30): ReminderItem[] {
  return all<{
    id: string;
    task_id: string;
    task_title: string;
    task_status: TaskStatus;
    level: ReminderLevel;
    due_at: string | null;
    assignee_name: string | null;
    sent_at: string;
  }>(
    `SELECT r.id, r.task_id, r.level, r.sent_at,
            t.title AS task_title, t.status AS task_status, t.due_at,
            u.name AS assignee_name
       FROM reminders r
       JOIN tasks t ON t.id = r.task_id
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE r.group_id = ?
      ORDER BY r.sent_at DESC
      LIMIT ?`,
    groupId,
    limit,
  ).map((row) => ({
    id: row.id,
    taskId: row.task_id,
    taskTitle: row.task_title,
    taskStatus: row.task_status,
    level: row.level,
    dueAt: row.due_at,
    assigneeName: row.assignee_name,
    sentAt: row.sent_at,
  }));
}
