/**
 * 重置账号密码 —— 零依赖，只用 Node 内置模块（node:sqlite + crypto）。
 *
 * 用法（仓库根目录）：
 *   node scripts/reset-password.mjs --list
 *   node scripts/reset-password.mjs <邮箱> <新密码>
 *   node scripts/reset-password.mjs <邮箱> <新密码> --db <数据库路径>
 *
 * 例：
 *   node scripts/reset-password.mjs <邮箱> <新密码>
 *
 * 口令格式与 apps/api/src/lib/password.ts 保持一致：
 *   scrypt$<salt-hex>$<scrypt(password, salt, 64)-hex>
 * 改完直接生效，不影响已有登录态。
 */
import { existsSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const repoRoot = path.resolve(import.meta.dirname, "..");

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");

// --db 覆盖数据库位置
let dbArg = null;
const dbIndex = args.indexOf("--db");
if (dbIndex >= 0) {
  dbArg = args[dbIndex + 1];
  args.splice(dbIndex, 2);
}

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(repoRoot, "apps", "api", "data");
const dbPath = dbArg ? path.resolve(dbArg) : path.join(dataDir, "war-room.db");

if (!existsSync(dbPath)) {
  console.error(`❌ 找不到数据库：${dbPath}`);
  console.error(
    "   默认数据目录是 apps/api/data（可用 DATA_DIR 环境变量覆盖）。\n" +
      "   如果服务还没启动过，先 npm run dev 或 npm run seed 生成数据库。",
  );
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

if (args.length === 0 || args[0] === "--list" || args[0] === "-l") {
  const users = db
    .prepare("SELECT name, email, created_at FROM users ORDER BY created_at ASC")
    .all();
  console.log(`数据库：${dbPath}`);
  console.log(`共 ${users.length} 个账号：`);
  for (const user of users) {
    console.log(`  ${user.email.padEnd(30)} ${user.name}`);
  }
  if (args.length === 0) {
    console.log("\n用法：node scripts/reset-password.mjs <邮箱> <新密码>");
  }
  process.exit(0);
}

const email = String(args[0] ?? "").trim().toLowerCase();
const password = String(args[1] ?? "");

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(`❌ 邮箱格式不对：${email}`);
  process.exit(1);
}
if (password.length < 6) {
  console.error("❌ 新密码至少 6 位（与注册时的校验一致）");
  process.exit(1);
}

const user = db
  .prepare("SELECT id, name, email FROM users WHERE lower(email) = ?")
  .get(email);

if (!user) {
  console.error(`❌ 没有找到邮箱为 ${email} 的账号。现有账号：`);
  for (const item of db.prepare("SELECT email FROM users").all()) {
    console.error(`   - ${item.email}`);
  }
  console.error("\n如果账号是在别的数据目录注册的，用 --db 或 DATA_DIR 指定数据库。");
  process.exit(1);
}

db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
  hashPassword(password),
  user.id,
);

console.log("✅ 密码已重置");
console.log(`   账号：${user.email}`);
console.log(`   昵称：${user.name}`);
console.log(`   新密码：${password}`);
console.log(`   数据库：${dbPath}`);
console.log("\n现在可以直接登录（旧的登录态不受影响）。");
