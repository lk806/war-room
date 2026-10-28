/**
 * 数据库初始化 / 升级（等价于「prisma migrate deploy」在本项目里的角色）。
 *
 * 本项目用 SQLite + 手写 schema.sql，没有 Prisma：
 *   - 首次运行：建库 + 建表
 *   - 已有库：schema.sql 全部是 CREATE TABLE IF NOT EXISTS，
 *     新增列由 db/index.ts 里的 ensureColumn 幂等补齐
 *
 * 用法：npm run db:migrate（可带 DATA_DIR 指定数据库位置）
 */
import { DB_PATH } from "../config.ts";
import { all, db } from "./index.ts";

const tables = all<{ name: string }>(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
);

console.log("✅ 数据库已就绪");
console.log(`   路径: ${DB_PATH}`);
console.log(`   表数: ${tables.length}`);
console.log(`   表: ${tables.map((table) => table.name).join(", ")}`);

// 顺便报告一次完整性检查，坏库能提前发现
const check = all<{ integrity_check: string }>("PRAGMA integrity_check");
console.log(`   完整性检查: ${check[0]?.integrity_check ?? "unknown"}`);

db.close();
