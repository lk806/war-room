import { timingSafeEqual } from "node:crypto";
import type { LoginInput, RegisterInput, User } from "@war-room/shared";
import {
  AI_ACTIVATION_CODE,
  AI_ACTIVATION_FROM_ENV,
  AUTH_SECRET,
  SESSION_TTL_SECONDS,
} from "../config.ts";
import { get, run } from "../db/index.ts";
import { conflict, forbidden, unauthorized } from "../lib/http.ts";
import { newId, nowIso } from "../lib/id.ts";
import { decryptSecret, encryptSecret, maskKey } from "../lib/byok-crypto.ts";
import { hashPassword, verifyPassword } from "../lib/password.ts";
import { signToken } from "../lib/token.ts";

const AVATAR_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
];

interface UserRow {
  id: string;
  name: string;
  email: string;
  avatar_color: string;
  can_use_ai: number;
  user_deepseek_key: string | null;
  created_at: string;
}

const toUser = (row: UserRow): User => {
  const plainKey = decryptSecret(row.user_deepseek_key);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatarColor: row.avatar_color,
    canUseAI: Number(row.can_use_ai) === 1,
    hasByok: Boolean(plainKey),
    byokHint: plainKey ? maskKey(plainKey) : null,
  };
};

const pickColor = (seed: string): string => {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
};

export function getUserById(id: string): User | null {
  const row = get<UserRow>("SELECT * FROM users WHERE id = ?", id);
  return row ? toUser(row) : null;
}

export function register(input: RegisterInput): { user: User; token: string } {
  const exists = get<{ id: string }>(
    "SELECT id FROM users WHERE email = ?",
    input.email,
  );
  if (exists) throw conflict("该邮箱已注册，请直接登录");

  const id = newId();
  run(
    `INSERT INTO users (id, name, email, password_hash, avatar_color, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    input.name,
    input.email,
    hashPassword(input.password),
    pickColor(input.email),
    nowIso(),
  );

  // 新注册用户默认没有 AI 权限，需要输入授权码激活
  const user: User = {
    id,
    name: input.name,
    email: input.email,
    avatarColor: pickColor(input.email),
    canUseAI: false,
    hasByok: false,
    byokHint: null,
  };
  return { user, token: signToken(id, AUTH_SECRET, SESSION_TTL_SECONDS) };
}

export function login(input: LoginInput): { user: User; token: string } {
  const row = get<UserRow & { password_hash: string }>(
    "SELECT * FROM users WHERE email = ?",
    input.email,
  );
  if (!row || !verifyPassword(input.password, row.password_hash)) {
    throw unauthorized("邮箱或密码不正确");
  }
  return {
    user: toUser(row),
    token: signToken(row.id, AUTH_SECRET, SESSION_TTL_SECONDS),
  };
}

/**
 * 用授权码解锁 AI 功能。
 * 授权码来自服务端环境变量 AI_ACTIVATION_CODE，比较用 timingSafeEqual 防时序探测。
 */
export function activateAi(userId: string, code: string): User {
  if (!AI_ACTIVATION_CODE) {
    throw forbidden("管理员尚未配置 AI 授权码（AI_ACTIVATION_CODE），暂时无法开通");
  }

  const given = Buffer.from(code.trim(), "utf8");
  const expected = Buffer.from(AI_ACTIVATION_CODE, "utf8");
  const ok = given.length === expected.length && timingSafeEqual(given, expected);

  if (!ok) {
    // 服务端还在用内置默认码：几乎一定是 .env 没被读到（或改了没重启）
    const hint = AI_ACTIVATION_FROM_ENV
      ? ""
      : "（服务端当前仍在使用内置默认授权码 war-room-vip，说明根目录 .env 里的 AI_ACTIVATION_CODE 没有被加载，请确认写在仓库根目录的 .env 并重启服务）";
    throw forbidden(`授权码不正确，请向管理员确认${hint}`);
  }

  run("UPDATE users SET can_use_ai = 1 WHERE id = ?", userId);
  const user = getUserById(userId);
  if (!user) throw unauthorized("账号不存在");
  return user;
}

/** 调用 AI 功能前的统一校验 */
export function requireAiAccess(user: User): void {
  if (!user.canUseAI) {
    throw forbidden("您尚未获得 AI 功能授权，请联系管理员");
  }
}
/** 读取并解密用户自己的 DeepSeek Key（未配置 / 解密失败都返回 null） */
export function getUserDeepseekKey(userId: string): string | null {
  const row = get<{ user_deepseek_key: string | null }>(
    "SELECT user_deepseek_key FROM users WHERE id = ?",
    userId,
  );
  return decryptSecret(row?.user_deepseek_key ?? null);
}

/** 保存（或清除，传空串）用户自己的 DeepSeek Key，返回更新后的用户 */
export function saveUserDeepseekKey(userId: string, rawKey: string): User {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    run("UPDATE users SET user_deepseek_key = NULL WHERE id = ?", userId);
  } else {
    run(
      "UPDATE users SET user_deepseek_key = ? WHERE id = ?",
      encryptSecret(trimmed),
      userId,
    );
  }
  const user = getUserById(userId);
  if (!user) throw unauthorized("账号不存在");
  return user;
}