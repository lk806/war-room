import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseBody } from "../lib/http.ts";
import { setSessionCookie } from "../lib/session.ts";
import { AUTH_LIMIT_PER_MIN, rateLimit } from "../lib/rate-limit.ts";
import { ApiError } from "../lib/http.ts";
import { findUserByEmail, register, resetPassword, sessionForUser } from "../services/auth.ts";
import { CODE_TTL_MINUTES, issueCode, verifyCode } from "../services/email-code.ts";
import { EMAIL_ENABLED } from "../services/email.ts";

/**
 * 邮箱验证码：注册验证 + 验证码登录。
 * 密码登录保持原样（/api/auth/login），这里只做增量，不影响已有账号。
 */
const emailSchema = z.string().trim().toLowerCase().email("邮箱格式不正确");
const codeSchema = z.string().trim().regex(/^\d{6}$/, "验证码是 6 位数字");

const requestCodeSchema = z.object({
  email: emailSchema,
  purpose: z.enum(["REGISTER", "LOGIN", "RESET"]).default("REGISTER"),
});

const registerWithCodeSchema = z.object({
  email: emailSchema,
  code: codeSchema,
  name: z.string().trim().min(1, "请填写昵称").max(24, "昵称最多 24 字"),
  password: z.string().min(6, "密码至少 6 位").max(72, "密码最多 72 位"),
});

const resetPasswordSchema = z.object({
  email: emailSchema,
  code: codeSchema,
  password: z.string().min(6, "密码至少 6 位").max(72, "密码最多 72 位"),
});

const loginWithCodeSchema = z.object({
  email: emailSchema,
  code: codeSchema,
});

export async function emailAuthRoutes(app: FastifyInstance): Promise<void> {
  /** 是否启用了邮箱验证码（前端据此决定是否显示入口） */
  app.get("/api/auth/email-code/status", async () => ({
    enabled: EMAIL_ENABLED,
    ttlMinutes: CODE_TTL_MINUTES,
  }));

  /** 发送验证码 */
  app.post("/api/auth/email-code", async (request, reply) => {
    rateLimit("auth", request.ip, AUTH_LIMIT_PER_MIN);
    const input = parseBody(requestCodeSchema, request.body);
    const result = await issueCode({ email: input.email, purpose: input.purpose, ip: request.ip });
    reply.code(202);
    return { ok: true, expiresIn: result.expiresIn };
  });

  /** 验证码注册（邮箱已验证，密码照旧保存，之后可用密码登录） */
  app.post("/api/auth/register-with-code", async (request, reply) => {
    rateLimit("auth", request.ip, AUTH_LIMIT_PER_MIN);
    const input = parseBody(registerWithCodeSchema, request.body);
    await verifyCode({ email: input.email, purpose: "REGISTER", code: input.code });
    const { user, token } = register({
      name: input.name,
      email: input.email,
      password: input.password,
    });
    setSessionCookie(reply, token);
    reply.code(201);
    return { user };
  });

  /** 忘记密码：验证码校验通过后重置密码 */
  app.post("/api/auth/reset-password", async (request) => {
    rateLimit("auth", request.ip, AUTH_LIMIT_PER_MIN);
    const input = parseBody(resetPasswordSchema, request.body);
    await verifyCode({ email: input.email, purpose: "RESET", code: input.code });
    resetPassword(input.email, input.password);
    // 无论账号是否存在都返回同样的结果，避免被用来枚举邮箱
    return { ok: true, message: "密码已重置，请用新密码登录" };
  });

  /** 验证码登录（免密） */  app.post("/api/auth/login-by-code", async (request, reply) => {
    rateLimit("auth", request.ip, AUTH_LIMIT_PER_MIN);
    const input = parseBody(loginWithCodeSchema, request.body);
    const existing = findUserByEmail(input.email);
    if (!existing) throw new ApiError(404, "该邮箱还没有注册过");
    await verifyCode({ email: input.email, purpose: "LOGIN", code: input.code });
    const { user, token } = sessionForUser(existing);
    setSessionCookie(reply, token);
    return { user };
  });
}
