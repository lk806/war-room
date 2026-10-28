import {
  CONTRIBUTION_COLORS,
  CONTRIBUTION_LABELS,
  CONTRIBUTION_ORDER,
  CONTRIBUTION_WEIGHTS,
  type ContributionKind,
  type ContributionKindStat,
  type ContributionMember,
  type ContributionRange,
  type ContributionSummary,
  type ContributionWeek,
  type GroupRole,
} from "@war-room/shared";
import { all } from "../db/index.ts";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const RANGE_DAYS: Record<ContributionRange, number | null> = {
  week: 7,
  month: 30,
  all: null,
};

interface EventRow {
  id: string;
  user_id: string;
  kind: ContributionKind;
  weight: number;
  ref_type: string;
  ref_id: string;
  meta_json: string | null;
  created_at: string;
  name: string;
  avatar_color: string;
  role: GroupRole;
}

interface MemberRow {
  user_id: string;
  name: string;
  avatar_color: string;
  role: GroupRole;
}

const emptyByKind = (): Record<ContributionKind, number> => {
  const record = {} as Record<ContributionKind, number>;
  for (const kind of CONTRIBUTION_ORDER) record[kind] = 0;
  return record;
};

/** 该日期所在周的周一 00:00（本地时区） */
function weekStartOf(input: Date): Date {
  const date = new Date(input.getFullYear(), input.getMonth(), input.getDate());
  const offset = (date.getDay() + 6) % 7; // 周一 = 0
  date.setDate(date.getDate() - offset);
  return date;
}

const weekLabel = (date: Date): string =>
  `${date.getMonth() + 1}/${date.getDate()}`;

/** 事件详情：优先用 meta 里的标题/文件名，没有就给个可读的兜底文案 */
const REF_LABELS: Record<string, string> = {
  task: "任务动态",
  comment: "任务评论",
  file: "文件",
  meeting: "会议",
};

function detailOf(row: EventRow): string {
  if (row.meta_json) {
    try {
      const meta = JSON.parse(row.meta_json) as { title?: string; name?: string };
      if (meta.title) return meta.title;
      if (meta.name) return meta.name;
    } catch {
      /* ignore */
    }
  }
  return REF_LABELS[row.ref_type] ?? "";
}

export function buildSummary(
  groupId: string,
  range: ContributionRange,
): ContributionSummary {
  const now = new Date();
  const days = RANGE_DAYS[range];
  const fromDate = days === null ? null : new Date(now.getTime() - days * DAY);
  const fromIso = fromDate ? fromDate.toISOString() : null;

  const members = all<MemberRow>(
    `SELECT m.user_id, u.name, u.avatar_color, m.role
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ?
      ORDER BY CASE m.role WHEN 'LEADER' THEN 0 ELSE 1 END, m.joined_at ASC`,
    groupId,
  );

  const rows = all<EventRow>(
    `SELECT e.id, e.user_id, e.kind, e.weight, e.ref_type, e.ref_id,
            e.meta_json, e.created_at,
            u.name, u.avatar_color, m.role
       FROM contribution_events e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN memberships m ON m.group_id = e.group_id AND m.user_id = e.user_id
      WHERE e.group_id = ?
      ORDER BY e.created_at DESC`,
    groupId,
  );

  const inRange = rows.filter((row) => !fromIso || row.created_at >= fromIso);

  // 成员维度
  const byUser = new Map<string, ContributionMember>();
  for (const member of members) {
    byUser.set(member.user_id, {
      userId: member.user_id,
      name: member.name,
      avatarColor: member.avatar_color,
      role: member.role,
      score: 0,
      events: 0,
      byKind: emptyByKind(),
      lastActiveAt: null,
    });
  }

  for (const row of inRange) {
    const target = byUser.get(row.user_id);
    if (!target) continue;
    target.score += row.weight;
    target.events += 1;
    target.byKind[row.kind] = (target.byKind[row.kind] ?? 0) + 1;
    if (!target.lastActiveAt || row.created_at > target.lastActiveAt) {
      target.lastActiveAt = row.created_at;
    }
  }

  const memberList = [...byUser.values()].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name, "zh-CN"),
  );

  // 维度汇总
  const kindCounts = new Map<ContributionKind, number>();
  for (const row of inRange) {
    kindCounts.set(row.kind, (kindCounts.get(row.kind) ?? 0) + 1);
  }
  const kinds: ContributionKindStat[] = CONTRIBUTION_ORDER.map((kind) => {
    const count = kindCounts.get(kind) ?? 0;
    const weight = CONTRIBUTION_WEIGHTS[kind];
    return {
      kind,
      label: CONTRIBUTION_LABELS[kind],
      weight,
      color: CONTRIBUTION_COLORS[kind],
      count,
      score: count * weight,
    };
  });

  // 近 8 周趋势：不受 range 影响，用全量事件更能看出节奏
  const currentWeek = weekStartOf(now);
  const weeks: ContributionWeek[] = [];
  for (let index = 7; index >= 0; index -= 1) {
    const start = new Date(currentWeek.getTime() - index * WEEK);
    const end = new Date(start.getTime() + WEEK);
    const bucket = rows.filter((row) => {
      const time = Date.parse(row.created_at);
      return time >= start.getTime() && time < end.getTime();
    });
    weeks.push({
      weekStart: start.toISOString(),
      label: weekLabel(start),
      score: bucket.reduce((sum, row) => sum + row.weight, 0),
      events: bucket.length,
    });
  }

  const totalScore = memberList.reduce((sum, member) => sum + member.score, 0);
  const recent = inRange.slice(0, 20).map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.name,
    avatarColor: row.avatar_color,
    kind: row.kind,
    label: CONTRIBUTION_LABELS[row.kind] ?? row.kind,
    weight: row.weight,
    detail: detailOf(row),
    createdAt: row.created_at,
  }));

  return {
    range,
    from: fromIso,
    to: now.toISOString(),
    totalScore,
    totalEvents: inRange.length,
    activeMembers: memberList.filter((member) => member.events > 0).length,
    members: memberList,
    kinds,
    weeks,
    recent,
  };
}

/**
 * CSV 单元格转义。
 * 除了引号/逗号/换行，还要防「公式注入」：以 = + - @ 开头的文本会被 Excel / WPS 当成公式执行，
 * 在成员名、任务标题这类用户可控字段上尤其危险。前面加单引号可以强制成纯文本。
 */
function cell(value: string | number): string {
  let text = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const formatTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "";

/**
 * 紧凑的绝对时间：2026-10-27 19:07
 * 与前端 formatDateTimeShort 保持一致（前端表格与 CSV 同一种写法）。
 */
function compactText(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 相对时间，纯文本（中文开头，Excel 不会当数字处理，短到不会 ####） */
function relativeText(iso: string | null): string {
  if (!iso) return "暂无";
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return "暂无";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

/**
 * 导出成员贡献汇总表。带 UTF-8 BOM，Excel 直接双击打开不乱码。
 *
 * 「最近活跃」合成一列文本：`刚刚（2026-10-27 19:16）`。
 * 原因：CSV 无法设置列宽，而 `2026-10-27 19:16` 这类写法会被 Excel 识别成
 * 日期数值，默认列宽下整列变成 #######。中文开头的文本不会被解析成数字，
 * 又能完整显示相对时间与精确时间。
 */
export function buildCsv(
  summary: ContributionSummary,
  groupName: string,
): string {
  const header = [
    "成员",
    "角色",
    "总分",
    "事件数",
    ...CONTRIBUTION_ORDER.map((kind) => CONTRIBUTION_LABELS[kind]),
    "最近活跃",
  ];

  const lines = summary.members.map((member) =>
    [
      member.name,
      member.role === "LEADER" ? "组长" : "成员",
      member.score,
      member.events,
      ...CONTRIBUTION_ORDER.map((kind) => member.byKind[kind] ?? 0),
      member.lastActiveAt
        ? `${relativeText(member.lastActiveAt)}（${compactText(member.lastActiveAt)}）`
        : "暂无",
    ]
      .map(cell)
      .join(","),
  );

  const totalRow = [
    "合计",
    "—",
    summary.totalScore,
    summary.totalEvents,
    ...CONTRIBUTION_ORDER.map((kind) =>
      summary.members.reduce((sum, member) => sum + (member.byKind[kind] ?? 0), 0),
    ),
    "",
  ]
    .map(cell)
    .join(",");

  const meta = [
    `# 小组作业作战室 · 贡献统计`,
    `# 小组：${groupName}`,
    `# 统计范围：${summary.range === "all" ? "全部" : summary.range === "week" ? "近 7 天" : "近 30 天"}`,
    `# 导出时间：${formatTime(summary.to)}`,
    `# 计分规则：${CONTRIBUTION_ORDER.map(
      (kind) => `${CONTRIBUTION_LABELS[kind]} ${CONTRIBUTION_WEIGHTS[kind]} 分`,
    ).join("、")}`,
    "",
  ];

  return "\uFEFF" + [...meta, header.map(cell).join(","), ...lines, totalRow].join("\r\n");
}
