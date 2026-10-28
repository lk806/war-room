import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@war-room/shared";
import { AUTH_SECRET, COOKIE_SECURE, SESSION_COOKIE, SESSION_TTL_SECONDS } from "../config.ts";
import { unauthorized } from "./http.ts";
import { verifyToken } from "./token.ts";
import { getUserById } from "../services/auth.ts";

/** 从 httpOnly Cookie 解析当前登录用户，未登录抛 401 */
export function requireUser(request: FastifyRequest): User {
  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) throw unauthorized();
  const payload = verifyToken(token, AUTH_SECRET);
  if (!payload) throw unauthorized("登录已过期，请重新登录");
  const user = getUserById(payload.sub);
  if (!user) throw unauthorized("账号不存在");
  return user;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    // 生产（NODE_ENV=production）默认 Secure；本地 http 调试可用 COOKIE_SECURE=false 关掉
    secure: COOKIE_SECURE,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}
