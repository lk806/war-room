import type { FastifyInstance } from "fastify";
import { loginSchema, registerSchema } from "@war-room/shared";
import { ApiError, parseBody } from "../lib/http.ts";
import { AUTH_LIMIT_PER_MIN, rateLimit } from "../lib/rate-limit.ts";
import {
  clearSessionCookie,
  requireUser,
  setSessionCookie,
} from "../lib/session.ts";
import { login, register } from "../services/auth.ts";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/register", async (request, reply) => {
    // 同一 IP 的注册/登录做限流，防脚本批量刷号和撞库
    rateLimit("auth", request.ip, AUTH_LIMIT_PER_MIN);
    // 公网部署时可以关闭注册：成员只能用邀请码加入，不再产生新账号
    if ((process.env.REGISTER_ENABLED ?? "true").toLowerCase() === "false") {
      throw new ApiError(403, "本实例已关闭注册，请联系组长获取已有账号");
    }
    const input = parseBody(registerSchema, request.body);
    const { user, token } = register(input);
    setSessionCookie(reply, token);
    return { user };
  });

  app.post("/api/auth/login", async (request, reply) => {
    rateLimit("auth", request.ip, AUTH_LIMIT_PER_MIN);
    const input = parseBody(loginSchema, request.body);
    const { user, token } = login(input);
    setSessionCookie(reply, token);
    return { user };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/auth/me", async (request) => {
    const user = requireUser(request);
    return { user };
  });
}
