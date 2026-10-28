import crypto from "node:crypto";
import {
  CONTRIBUTION_WEIGHTS,
  type ContributionKind,
  type Group,
  type GroupRole,
  type Member,
} from "@war-room/shared";
import { all, get, run } from "../db/index.ts";
import { newId, nowIso } from "../lib/id.ts";
import { conflict, forbidden, notFound } from "../lib/http.ts";
import type { CreateGroupInput } from "@war-room/shared";

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface GroupRow {
  id: string;
  name: string;
  course: string;
  invite_code: string;
  owner_id: string;
  created_at: string;
  member_count?: number;
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
  can_use_ai: number;
  role: GroupRole;
  skills: string;
  joined_at: string;
}

const toGroup = (
  row: GroupRow,
  myRole: GroupRole,
  memberCount: number,
): Group => ({
  id: row.id,
  name: row.name,
  course: row.course,
  inviteCode: row.invite_code,
  ownerId: row.owner_id,
  createdAt: row.created_at,
  memberCount,
  myRole,
});

const toMember = (row: MemberRow): Member => {
  let skills: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.skills);
    if (Array.isArray(parsed)) skills = parsed.filter((s): s is string => typeof s === "string");
  } catch {
    skills = [];
  }
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarColor: row.avatar_color,
    canUseAI: Number(row.can_use_ai) === 1,
    // 成员列表只关心授权状态，不下发别人的 Key 信息
    hasByok: false,
    byokHint: null,
    role: row.role,
    skills,
    joinedAt: row.joined_at,
  };
};

function generateInviteCode(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    // 邀请码是全组数据的唯一门槛：用 CSPRNG 生成 8 位，别用 Math.random（可预测）
    for (let i = 0; i < 8; i += 1) {
      code += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
    }
    const taken = get<{ id: string }>(
      "SELECT id FROM teams WHERE invite_code = ?",
      code,
    );
    if (!taken) return code;
  }
  throw conflict("邀请码生成失败，请重试");
}

export function listGroups(userId: string): Group[] {
  const rows = all<GroupRow & { role: GroupRole; member_count: number }>(
    `SELECT t.*, m.role AS role,
            (SELECT COUNT(*) FROM memberships x WHERE x.group_id = t.id) AS member_count
       FROM teams t
       JOIN memberships m ON m.group_id = t.id
      WHERE m.user_id = ?
      ORDER BY t.created_at ASC`,
    userId,
  );
  return rows.map((row) => toGroup(row, row.role, row.member_count));
}

export function createGroup(userId: string, input: CreateGroupInput): Group {
  const id = newId();
  const createdAt = nowIso();
  const inviteCode = generateInviteCode();
  run(
    `INSERT INTO teams (id, name, course, invite_code, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    input.name,
    input.course ?? "",
    inviteCode,
    userId,
    createdAt,
  );
  run(
    `INSERT INTO memberships (group_id, user_id, role, skills, joined_at)
     VALUES (?, ?, 'LEADER', '[]', ?)`,
    id,
    userId,
    createdAt,
  );
  return {
    id,
    name: input.name,
    course: input.course ?? "",
    inviteCode,
    ownerId: userId,
    createdAt,
    memberCount: 1,
    myRole: "LEADER",
  };
}

export function joinGroup(userId: string, inviteCode: string): Group {
  const team = get<GroupRow>(
    "SELECT * FROM teams WHERE invite_code = ?",
    inviteCode,
  );
  if (!team) throw notFound("邀请码无效，请向组长确认");

  const existing = get<{ user_id: string }>(
    "SELECT user_id FROM memberships WHERE group_id = ? AND user_id = ?",
    team.id,
    userId,
  );
  if (existing) throw conflict("你已经是这个小组的成员了");

  run(
    `INSERT INTO memberships (group_id, user_id, role, skills, joined_at)
     VALUES (?, ?, 'MEMBER', '[]', ?)`,
    team.id,
    userId,
    nowIso(),
  );

  const count = get<{ c: number }>(
    "SELECT COUNT(*) AS c FROM memberships WHERE group_id = ?",
    team.id,
  );
  return toGroup(team, "MEMBER", count?.c ?? 1);
}

/** 校验用户是否属于小组，顺便返回角色 */
export function requireMember(
  groupId: string,
  userId: string,
): { role: GroupRole } {
  const row = get<{ role: GroupRole }>(
    "SELECT role FROM memberships WHERE group_id = ? AND user_id = ?",
    groupId,
    userId,
  );
  if (!row) throw forbidden("你不是该小组成员");
  return { role: row.role };
}

/** 小组人数（AI 拆分时用来判断任务粒度） */
export function countMembers(groupId: string): number {
  const row = get<{ total: number }>(
    "SELECT COUNT(*) AS total FROM memberships WHERE group_id = ?",
    groupId,
  );
  return Math.max(1, row?.total ?? 1);
}

export function getGroupDetail(
  groupId: string,
  userId: string,
): { group: Group; members: Member[] } {
  const { role } = requireMember(groupId, userId);
  const team = get<GroupRow>("SELECT * FROM teams WHERE id = ?", groupId);
  if (!team) throw notFound("小组不存在");

  const members = all<MemberRow>(
    `SELECT u.id, u.name, u.email, u.avatar_color, m.role, m.skills, m.joined_at
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.group_id = ?
      ORDER BY CASE m.role WHEN 'LEADER' THEN 0 ELSE 1 END, m.joined_at ASC`,
    groupId,
  );

  return {
    group: toGroup(team, role, members.length),
    members: members.map(toMember),
  };
}

/**
 * 记录一条贡献事件（append-only，贡献统计的唯一事实来源）。
 * `at` 仅用于种子数据回填历史时间，业务代码不要传。
 */
export function recordContribution(
  groupId: string,
  userId: string,
  kind: ContributionKind,
  refType: string,
  refId: string,
  meta?: Record<string, unknown>,
  at?: string,
): void {
  run(
    `INSERT INTO contribution_events
       (id, group_id, user_id, kind, ref_type, ref_id, weight, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    groupId,
    userId,
    kind,
    refType,
    refId,
    CONTRIBUTION_WEIGHTS[kind] ?? 0,
    meta ? JSON.stringify(meta) : null,
    at ?? nowIso(),
  );
}
