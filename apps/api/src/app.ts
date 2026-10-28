import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { formatFileLimit } from "@war-room/shared";
import { MAX_UPLOAD_BYTES, WEB_DIST, numberEnv } from "./config.ts";
import { get } from "./db/index.ts";
import { ApiError } from "./lib/http.ts";
import { authRoutes } from "./routes/auth.ts";
import { aiRoutes } from "./routes/ai.ts";
import { contributionRoutes } from "./routes/contributions.ts";
import { eventRoutes } from "./routes/events.ts";
import { fileRoutes } from "./routes/files.ts";
import { groupRoutes } from "./routes/groups.ts";
import { meetingRoutes } from "./routes/meetings.ts";
import { taskRoutes } from "./routes/tasks.ts";
import { recoverStaleJobs } from "./services/meetings.ts";
import { closeAllSubscribers } from "./services/realtime.ts";
import { storageInfo } from "./services/storage.ts";
import { sweepReminders } from "./services/reminders.ts";

/** 提醒扫描间隔：默认 60s；测试时可用环境变量缩短 */
const SWEEP_INTERVAL_MS = numberEnv("REMINDER_SWEEP_MS", 60_000, 1000);

/** 组装 Fastify 应用；index.ts 与测试脚本共用 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 2 * 1024 * 1024,
    // 部署在 Railway / Render / Nginx 之后时，信任代理传来的 X-Forwarded-*
    trustProxy: true,
    // 关闭时强制断开keep-alive/SSE 长连接，否则容器会被 SIGKILL
    forceCloseConnections: true,
  });

  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: 4,
      fieldSize: 4096,
    },
  });

  // 健康检查：平台用它判断实例是否就绪，顺便确认 SQLite 可读。
  // DB 挂了必须返回 503，否则 Docker/Railway 的健康检查永远通过，坏实例继续接流量。
  app.get("/api/health", async (_request, reply) => {
    let db = "ok";
    try {
      // 不只测连接，也确认核心表还在（库文件损坏/被截断时 SELECT 1 仍会成功）
      get("SELECT 1 FROM users LIMIT 1");
    } catch {
      db = "error";
    }
    const ok = db === "ok";
    reply.code(ok ? 200 : 503);
    return {
      ok,
      service: "war-room-api",
      db,
      storage: storageInfo().driver,
      uptimeSec: Math.round(process.uptime()),
      time: new Date().toISOString(),
    };
  });

  /*
   * 安全响应头：没有 CSP 时，任何一处 XSS 都能直接拿走会话；
   * frame-ancestors / X-Frame-Options 防点击劫持（诱导组长点「删除」「验收」）。
   * 不引 helmet，避免多一个依赖。
   */
  app.addHook("onSend", async (_request, reply) => {
    const csp = [
      "default-src 'self'",
      // React 的内联 style 属性需要 unsafe-inline；脚本只允许同源构建产物
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; ");

    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("Referrer-Policy", "same-origin")
      .header("Permissions-Policy", "microphone=(self), camera=(), geolocation=()")
      .header("Content-Security-Policy", csp)
      .header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  });

  /*
   * ⚠️ 错误处理必须在注册路由**之前**设置。
   * Fastify 的子上下文在创建时继承当时的 error handler，路由插件先注册就会拿到默认处理器，
   * 结果前端只会看到 "Unsupported Media Type" 这类英文默认文案，而不是我们写的中文提示。
   */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.status).send({ error: error.message, message: error.message });
    }
    // @fastify/multipart 的超限错误
    const code = (error as { code?: string }).code;
    if (code === "FST_REQ_FILE_TOO_LARGE") {
      return reply
        .code(413)
        .send({ error: `文件超过 ${formatFileLimit(MAX_UPLOAD_BYTES)} 上限，请压缩或拆分后再上传` });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) {
      const message = (error as { message?: string }).message ?? "请求不正确";
      return reply.code(statusCode).send({ error: message, message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "服务器开小差了，请稍后再试" });
  });

  await app.register(authRoutes);
  await app.register(groupRoutes);
  await app.register(taskRoutes);
  await app.register(fileRoutes);
  await app.register(meetingRoutes);
  await app.register(contributionRoutes);
  await app.register(aiRoutes);
  await app.register(eventRoutes);

  // 生产模式：由 API 直接托管构建产物，一个端口跑完整应用
  if (fs.existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, {
      root: WEB_DIST,
      setHeaders: (res, filePath) => {
        // 带哈希的构建产物可以长期缓存；index.html 必须每次校验，否则发版后旧页面不更新
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.header("Cache-Control", "public, max-age=31536000, immutable");
        } else if (filePath.endsWith(".html")) {
          res.header("Cache-Control", "no-cache");
        }
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const url = request.raw.url ?? "";
      if (url.startsWith("/api")) {
        return reply.code(404).send({ error: "接口不存在" });
      }
      // 缺失的静态资源要 404：回退成 index.html 会让浏览器拿 HTML 当 JS/CSS 解析
      if (/\.[a-z0-9]+(\?|$)/i.test(url)) {
        return reply.code(404).send({ error: "资源不存在" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: "接口不存在（前端尚未构建，请先 npm run build）" }),
    );
  }

  // DDL 提醒定时扫描：启动时先补扫一次，之后每分钟一次
  let reminderTimer: ReturnType<typeof setInterval> | null = null;
  app.addHook("onReady", async () => {
    // 启动自愈：上次进程重启时中断的转写 / AI 任务标记为失败，避免页面永远卡在「转写中」
    try {
      const recovered = recoverStaleJobs();
      if (recovered.meetings > 0 || recovered.jobs > 0) {
        app.log.warn(recovered, "已清理上次运行遗留的未完成任务");
      }
    } catch (error) {
      app.log.error(error instanceof Error ? error : String(error), "启动自愈失败");
    }

    const sweep = () => {
      try {
        const sent = sweepReminders();
        if (sent > 0) app.log.info({ sent }, "已发出 DDL 提醒");
      } catch (error) {
        app.log.error(error instanceof Error ? error : String(error), "提醒扫描失败");
      }
    };
    sweep();
    reminderTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
    reminderTimer.unref();
  });

  app.addHook("onClose", async () => {
    if (reminderTimer) clearInterval(reminderTimer);
    // SSE 是长连接，不主动断开的话 app.close() 会一直等下去
    const closed = closeAllSubscribers();
    if (closed > 0) app.log.info({ closed }, "已断开所有实时连接");
  });

  return app;
}
