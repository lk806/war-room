/**
 * 限流自检：确认认证接口在超过阈值后返回 429 且提示可读。
 *
 * 需要先用一个较小阈值启动服务：
 *   $env:RATE_LIMIT_AUTH_PER_MIN="3"; npm run dev:api
 * 然后：
 *   node scripts/check-rate-limit.mjs http://localhost:4000
 */
const BASE = process.argv[2] ?? "http://localhost:4000";
const stamp = Date.now();

let passed = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ❌ ${name} ${detail}`);
  }
};

console.log(`\n🚦 限流自检 ${BASE}\n`);

const statuses = [];
let lastMessage = "";
for (let index = 0; index < 8; index += 1) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `rate-limit-${stamp}-${index}@test.local`,
      password: "wrongpass123",
    }),
  });
  statuses.push(res.status);
  if (res.status === 429) {
    lastMessage = (await res.json().catch(() => ({}))).error ?? "";
  }
}

const limited = statuses.filter((status) => status === 429).length;
console.log(`     状态序列: ${statuses.join(", ")}`);

check("连续请求最终会触发 429", limited > 0, statuses.join(","));
check(
  "429 提示是中文且说明间隔",
  lastMessage.includes("频繁") || lastMessage.includes("秒后再试"),
  lastMessage,
);
check("未被限流的请求仍正常返回 401（而不是 500）", statuses.includes(401), statuses.join(","));

console.log(`\n结果：${passed} 项通过，${failures.length} 项失败\n`);
if (failures.length) process.exit(1);
