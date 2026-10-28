import { ApiError } from "./http.ts";

/**
 * 极简滑动窗口限流（进程内存，够单实例部署用）。
 *
 * 目的：公网部署后，登录/注册/邀请码接口会被暴力尝试，AI 接口会被刷额度。
 * 不引入额外依赖，也不做全局限流（避免误伤正常翻页/轮询）。
 *
 * 局限：单实例内存计数，重启即清零；多实例部署需要换成 Redis 之类的共享存储。
 */
interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

function envLimit(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** 认证类接口：同一 IP 每分钟最多 40 次（登录/注册/加入小组） */
export const AUTH_LIMIT_PER_MIN = envLimit("RATE_LIMIT_AUTH_PER_MIN", 40);
/** AI 类接口：同一用户每分钟最多 20 次（拆分/转写/纪要） */
export const AI_LIMIT_PER_MIN = envLimit("RATE_LIMIT_AI_PER_MIN", 20);

const WINDOW_MS = 60_000;

/**
 * 记一次请求；超限抛 429。
 * @param scope 用途前缀（auth / ai），同一个 key 各自计数
 */
export function rateLimit(scope: string, key: string, limit: number): void {
  const now = Date.now();
  const id = `${scope}:${key}`;
  const bucket = buckets.get(id) ?? { hits: [] };

  // 丢掉窗口外的记录
  bucket.hits = bucket.hits.filter((at) => now - at < WINDOW_MS);

  if (bucket.hits.length >= limit) {
    const retryAfter = Math.ceil(
      (WINDOW_MS - (now - (bucket.hits[0] ?? now))) / 1000,
    );
    buckets.set(id, bucket);
    throw new ApiError(
      429,
      `操作太频繁了（每分钟最多 ${limit} 次），请 ${retryAfter > 0 ? retryAfter : 1} 秒后再试`,
    );
  }

  bucket.hits.push(now);
  buckets.set(id, bucket);
}

/** 定期清理空桶，避免内存无限增长（进程退出时不影响） */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, bucket] of buckets) {
    if (bucket.hits.every((at) => now - at >= WINDOW_MS)) buckets.delete(id);
  }
}, WINDOW_MS);
sweeper.unref();

/** 当前活跃的限流桶数量（自检/排查用） */
export function activeBucketCount(): number {
  return buckets.size;
}
