import {
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  isToday,
  isTomorrow,
  isYesterday,
} from "date-fns";
import { zhCN } from "date-fns/locale";

export interface DueMeta {
  label: string;
  className: string;
  urgency: "overdue" | "today" | "soon" | "later" | "none" | "done";
}

/** DDL 展示：按剩余时间给出颜色与文案，逾期单独标红 */
export function dueMeta(iso: string | null, status?: string): DueMeta {
  const neutral = { className: "bg-slate-100 text-slate-500", urgency: "none" as const };
  if (!iso) return { label: "无 DDL", ...neutral };

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { label: "无 DDL", ...neutral };

  if (status === "DONE") {
    return {
      label: `完成于 ${format(date, "M月d日")}`,
      className: "bg-emerald-50 text-emerald-700",
      urgency: "done",
    };
  }

  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const days = differenceInCalendarDays(date, now);

  if (diffMs < 0) {
    const overdueDays = Math.abs(days) || 1;
    return {
      label: `逾期 ${overdueDays} 天`,
      className: "bg-rose-100 text-rose-700 font-medium",
      urgency: "overdue",
    };
  }

  if (diffMs <= 6 * 3600 * 1000) {
    return {
      label: `${Math.max(1, Math.round(diffMs / 3600000))} 小时后`,
      className: "bg-rose-50 text-rose-600 font-medium",
      urgency: "today",
    };
  }

  if (isToday(date)) {
    return {
      label: `今天 ${format(date, "HH:mm")}`,
      className: "bg-amber-50 text-amber-700",
      urgency: "today",
    };
  }

  if (isTomorrow(date)) {
    return {
      label: `明天 ${format(date, "HH:mm")}`,
      className: "bg-amber-50 text-amber-700",
      urgency: "soon",
    };
  }

  if (days <= 3) {
    return {
      label: `${days} 天后`,
      className: "bg-amber-50 text-amber-700",
      urgency: "soon",
    };
  }

  return {
    label: format(date, "M月d日 HH:mm"),
    className: "bg-slate-100 text-slate-600",
    urgency: "later",
  };
}

export function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "刚刚";
  return formatDistanceToNowStrict(date, { addSuffix: true, locale: zhCN });
}

export function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (isToday(date)) return "今天";
  if (isYesterday(date)) return "昨天";
  return format(date, "M月d日");
}

export function dateTimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  if (isToday(date)) return `今天 ${format(date, "HH:mm")}`;
  if (isTomorrow(date)) return `明天 ${format(date, "HH:mm")}`;
  return format(date, "M月d日 HH:mm");
}

/**
 * 紧凑的绝对时间：2026-10-27 19:07
 * 用于表格类展示（可以 spread 到 CSV，两边格式一致）。
 */
export function formatDateTimeShort(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 纯相对时间文案：8 小时后 / 3 天后 / 逾期 2 天 */
export function relativeDueLabel(iso: string | null): string {
  if (!iso) return "无 DDL";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "无 DDL";

  const diff = date.getTime() - Date.now();
  if (diff < 0) {
    const days = Math.max(1, differenceInCalendarDays(new Date(), date));
    return days === 1 ? "逾期不到 1 天" : `逾期 ${days} 天`;
  }

  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟后`;

  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours} 小时后`;

  return `${Math.ceil(diff / 86_400_000)} 天后`;
}
