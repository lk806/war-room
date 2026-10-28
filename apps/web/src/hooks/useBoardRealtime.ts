import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ReminderLevel } from "@war-room/shared";
import { useToast } from "../lib/toast.tsx";

interface ReminderPayload {
  reminder?: {
    taskTitle?: string;
    level?: ReminderLevel;
    dueAt?: string | null;
  };
}

/**
 * 订阅组内 SSE 事件流：
 * - 任务增删改 / 文件增删 -> 刷新对应缓存
 * - 新评论 -> 刷新该任务评论
 * - DDL 提醒 -> 弹提示 + 刷新提醒记录
 * 事件合并 250ms 触发一次（一次拖拽可能连发多条）。
 */
export function useBoardRealtime(groupId: string): void {
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (!groupId) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    /** 一次操作可能连发多条事件，合并成一次刷新 */
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void queryClient.invalidateQueries({ queryKey: ["board", groupId] });
        void queryClient.invalidateQueries({ queryKey: ["files", groupId] });
        void queryClient.invalidateQueries({ queryKey: ["reminders", groupId] });
        void queryClient.invalidateQueries({ queryKey: ["contributions", groupId] });
      }, 250);
    };

    const source = new EventSource(`/api/groups/${groupId}/events`);

    for (const eventName of [
      "task.created",
      "task.updated",
      "task.deleted",
      "file.created",
      "file.deleted",
    ]) {
      source.addEventListener(eventName, refresh);
    }

    source.addEventListener("meeting.updated", () => {
      void queryClient.invalidateQueries({ queryKey: ["meetings", groupId] });
      void queryClient.invalidateQueries({ queryKey: ["meeting"] });
    });

    source.addEventListener("comment.created", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          comment?: { taskId?: string };
        };
        const taskId = payload.comment?.taskId;
        if (taskId) void queryClient.invalidateQueries({ queryKey: ["comments", taskId] });
      } catch {
        /* 忽略解析失败的心跳/异常包 */
      }
    });

    source.addEventListener("reminder.due", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as ReminderPayload;
        const info = payload.reminder;
        if (!info?.taskTitle) return;
        const levelLabel = info.level === "1H" ? "还有不到 1 小时到期" : "还有不到 24 小时到期";
        toast.push(`⏰「${info.taskTitle}」${levelLabel}`, "info");
        void queryClient.invalidateQueries({ queryKey: ["reminders", groupId] });
      } catch {
        /* 忽略 */
      }
    });

    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [groupId, queryClient, toast]);
}
