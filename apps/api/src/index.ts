import os from "node:os";
import { buildApp } from "./app.ts";
import {
  AI_ACTIVATION_CODE,
  AI_ACTIVATION_USING_DEFAULT,
  HOST,
  PORT,
} from "./config.ts";

function lanAddresses(): string[] {
  const result: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) result.push(entry.address);
    }
  }
  return result;
}

/**
 * 进程级兜底：
 * - 未处理的 Promise 拒绝记录日志后继续（Node 24 默认直接退出，线上会变成偶发 502）
 * - 未捕获异常记录后退出，交给容器重启策略（进程状态可能已不一致，不宜硬撑）
 */
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[uncaughtException]", error);
  // 给日志一点 flush 时间再退出，避免容器里日志丢失
  setTimeout(() => process.exit(1), 100).unref();
});

const app = await buildApp();

try {
  await app.listen({ port: PORT, host: HOST });
  const isProd = process.env.NODE_ENV === "production";
  const activationLine = AI_ACTIVATION_CODE
    ? AI_ACTIVATION_USING_DEFAULT
      ? "     授权码: 内置默认值（仅限本地调试，公网部署请设置 AI_ACTIVATION_CODE）"
      : "     授权码: 已从环境变量读取"
    : isProd
      ? "     授权码: 未配置 → 已关闭自助开通（用户可自带 Key，或用 npm run grant:ai 手动开通）"
      : "     授权码: 已关闭自助开通";
  const lines = [
    "",
    "  ✅ 小组作业作战室 API 已启动",
    `     本机:   http://localhost:${PORT}`,
    ...lanAddresses().map((ip) => `     局域网: http://${ip}:${PORT}`),
    activationLine,
    "",
  ];
  console.log(lines.join("\n"));
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

/** 优雅关闭：先停监听、断掉 SSE 长连接，再关 Fastify（否则 close 会一直等 SSE） */
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n收到 ${signal}，正在关闭…`);
    const timeout = setTimeout(() => process.exit(0), 8000);
    timeout.unref();
    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(0));
  });
}
