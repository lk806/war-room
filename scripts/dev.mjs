/**
 * 一条命令同时起 API 与前端开发服务器。
 * 子进程用 stdio: inherit，日志直接打到当前终端，Ctrl+C 一起退出。
 */
import { spawn } from "node:child_process";
import process from "node:process";

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const procs = [];
let shuttingDown = false;

function start(name, args, color) {
  const child = spawn(npm, args, {
    stdio: "inherit",
    shell: isWindows,
    env: { ...process.env, FORCE_COLOR: "1" },
  });
  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.log(`\n[${color}] ${name} 已退出（code=${code}），正在停止其他进程…`);
    shutdown(code ?? 0);
  });
  procs.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of procs) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(code), 300);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("API", ["run", "dev:api"], "API");
start("WEB", ["run", "dev:web"], "WEB");

console.log(`
┌──────────────────────────────────────────────┐
│  小组作业作战室 · 开发模式                    │
│  前端  http://localhost:5173                 │
│  接口  http://localhost:4000/api/health      │
└──────────────────────────────────────────────┘
`);
