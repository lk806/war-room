import crypto from "node:crypto";
import { all, get, run } from "../db/index.ts";
import { ApiError, badRequest } from "../lib/http.ts";
import { newId, nowIso } from "../lib/id.ts";
import { EMAIL_ENABLED, sendCodeMail } from "./email.ts";

export const CODE_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_PER_HOUR = 10;

export type CodePurpose = "REGISTER" | "LOGIN" | "RESET";

interface CodeRow {
  id: string;
  email: string;
  purpose: CodePurpose;
  code_hash: string;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
  created_at: string;
}

const sha256 = (value: string): string =>
  crypto.createHash("sha256").update(`war-room:email-code:${value}`).digest("hex");

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** 生成并发送验证码；带冷却与每小时上限，防止被刷 */
export async function issueCode(params: {
  email: string;
  purpose: CodePurpose;
  ip: string;
}): Promise<{ expiresIn: number }> {
  if (!EMAIL_ENABLED) throw new ApiError(429, "服务器未配置邮件服务，暂时无法发送验证码");
  const email = normalizeEmail(params.email);

  const recent = await get<{ created_at: string }>(
    "SELECT created_at FROM email_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1",
    email,
  );
  if (recent) {
    const elapsed = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
    if (elapsed < RESEND_COOLDOWN_SECONDS) {
      throw new ApiError(429, `请 ${Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed)} 秒后再试`);
    }
  }

  const hourly = await get<{ c: string }>(
    "SELECT COUNT(*) AS c FROM email_codes WHERE email = ? AND created_at > ?",
    email,
    new Date(Date.now() - 3600_000).toISOString(),
  );
  if (Number(hourly?.c ?? 0) >= MAX_PER_HOUR) {
    throw new ApiError(429, "该邮箱 1 小时内验证码次数过多，请稍后再试");
  }

  // 6 位数字，用 CSPRNG
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();

  await run(
    `INSERT INTO email_codes (id, email, purpose, code_hash, expires_at, attempts, consumed_at, ip, created_at)
     VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    newId(),
    email,
    params.purpose,
    sha256(code),
    expiresAt,
    params.ip,
    createdAt,
  );

  await sendCodeMail({
    to: email,
    code,
    minutes: CODE_TTL_MINUTES,
    purpose: params.purpose,
  });

  return { expiresIn: CODE_TTL_MINUTES * 60 };
}

/** 校验验证码；通过后标记为已使用（一次性） */
export async function verifyCode(params: {
  email: string;
  purpose: CodePurpose;
  code: string;
}): Promise<void> {
  const email = normalizeEmail(params.email);
  const rows = await all<CodeRow>(
    "SELECT * FROM email_codes WHERE email = ? AND purpose = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1",
    email,
    params.purpose,
  );
  const row = rows[0];
  if (!row) throw badRequest("请先获取验证码");

  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw badRequest("验证码已过期，请重新获取");
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    throw badRequest("验证码错误次数过多，请重新获取");
  }

  if (row.code_hash !== sha256(params.code.trim())) {
    await run("UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?", row.id);
    throw badRequest("验证码不正确");
  }

  await run("UPDATE email_codes SET consumed_at = ? WHERE id = ?", nowIso(), row.id);
}
