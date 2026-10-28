/**
 * 管理员手动开通 / 收回 AI 权限（不需要告诉用户授权码）。
 *
 *   node scripts/grant-ai.mjs --list
 *   node scripts/grant-ai.mjs <邮箱>            # 开通
 *   node scripts/grant-ai.mjs <邮箱> --revoke   # 收回
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(repoRoot, "apps", "api", "data");
const dbPath = path.join(dataDir, "war-room.db");

if (!existsSync(dbPath)) {
  console.error(`❌ 找不到数据库：${dbPath}`);
  process.exit(1);
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const db = new DatabaseSync(dbPath);

if (args.length === 0 || args[0] === "--list") {
  const rows = db
    .prepare("SELECT name, email, can_use_ai FROM users ORDER BY created_at ASC")
    .all();
  console.log(`数据库：${dbPath}`);
  console.log(`共 ${rows.length} 个账号：`);
  for (const row of rows) {
    console.log(`  ${row.can_use_ai ? "✅" : "⛔"} ${String(row.email).padEnd(32)} ${row.name}`);
  }
  console.log("\n用法：node scripts/grant-ai.mjs <邮箱> [--revoke]");
  process.exit(0);
}

const email = String(args[0]).trim().toLowerCase();
const revoke = args.includes("--revoke");
const user = db.prepare("SELECT id, name FROM users WHERE lower(email) = ?").get(email);

if (!user) {
  console.error(`❌ 没有找到邮箱为 ${email} 的账号`);
  process.exit(1);
}

db.prepare("UPDATE users SET can_use_ai = ? WHERE id = ?").run(revoke ? 0 : 1, user.id);
console.log(
  `${revoke ? "⛔ 已收回" : "✅ 已开通"} ${user.name}（${email}）的 AI 功能权限`,
);
console.log("用户刷新页面即可生效，无需重新登录。");
