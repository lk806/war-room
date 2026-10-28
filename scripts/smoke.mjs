/**
 * 接口冒烟测试：不依赖任何测试框架，直接跑真实 HTTP 请求。
 * 用法：node scripts/smoke.mjs [baseUrl]（默认 http://localhost:4000）
 * 退出码 0 表示全部通过。
 */
const BASE = process.argv[2] ?? "http://localhost:4000";

let cookie = "";
let passed = 0;
const failures = [];

const jar = (res) => {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const item of raw) {
    const pair = item.split(";")[0];
    if (pair.startsWith("wr_session=")) cookie = pair;
  }
};

async function call(method, path, body, { expectStatus } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  jar(res);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (expectStatus !== undefined && res.status !== expectStatus) {
    throw new Error(
      `${method} ${path} 期望 ${expectStatus} 实际 ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return { status: res.status, data };
}

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(`${name} ${detail}`);
    console.log(`  ❌ ${name} ${detail}`);
  }
}

const stamp = Date.now();
const email = `smoke-${stamp}@war-room.local`;

console.log(`\n🔍 冒烟测试 ${BASE}\n`);

// 1. 健康检查
const health = await call("GET", "/api/health");
check("健康检查返回 ok", health.data?.ok === true);

// 2. 未登录访问受保护接口
const unauth = await call("GET", "/api/groups", undefined, { expectStatus: 401 });
check("未登录访问 /api/groups 返回 401", unauth.status === 401);

// 3. 注册 + 会话
const reg = await call("POST", "/api/auth/register", {
  name: "冒烟测试员",
  email,
  password: "smoke1234",
}, { expectStatus: 200 });
check("注册成功并返回用户", reg.data?.user?.email === email);
check("注册后写入 httpOnly Cookie", cookie.startsWith("wr_session="));

const me = await call("GET", "/api/auth/me", undefined, { expectStatus: 200 });
check("/api/auth/me 返回当前用户", me.data?.user?.email === email);

// 4. 注册校验
const badReg = await call("POST", "/api/auth/register", {
  name: "",
  email: "not-an-email",
  password: "123",
}, { expectStatus: 400 });
check("注册参数校验生效", typeof badReg.data?.error === "string");

// 5. 建组
const groupRes = await call("POST", "/api/groups", {
  name: "冒烟测试小组",
  course: "软件工程",
}, { expectStatus: 201 });
const group = groupRes.data?.group;
check("建组成功并成为组长", group?.myRole === "LEADER");
check("邀请码为 6–12 位大写字母数字", /^[A-Z0-9]{6,12}$/.test(group?.inviteCode ?? ""), group?.inviteCode);

// 6. 建任务
const taskA = (await call("POST", `/api/groups/${group.id}/tasks`, {
  title: "写需求文档",
  priority: "HIGH",
  dueAt: new Date(Date.now() + 86400000).toISOString(),
  estimateHours: 4,
}, { expectStatus: 201 })).data.task;

const taskB = (await call("POST", `/api/groups/${group.id}/tasks`, {
  title: "画原型图",
}, { expectStatus: 201 })).data.task;

check("任务创建成功", Boolean(taskA?.id && taskB?.id));
check("新任务默认待办", taskA?.status === "TODO");
// 后建的任务插到列首，所以 position 更小
check("新任务插到列首（position 递减）", taskB.position < taskA.position);

// 7. 看板聚合
const board = await call("GET", `/api/groups/${group.id}/board`, undefined, { expectStatus: 200 });
check("看板返回组信息 + 成员 + 任务", board.data?.tasks?.length === 2 && board.data?.members?.length === 1);

// 8. 拖拽流转
const moved = await call("POST", `/api/tasks/${taskA.id}/move`, {
  status: "IN_PROGRESS",
  position: 512,
  expectedUpdatedAt: taskA.updatedAt,
}, { expectStatus: 200 });
check("任务从待办流转到进行中", moved.data?.task?.status === "IN_PROGRESS");

const done = await call("POST", `/api/tasks/${taskA.id}/move`, {
  status: "DONE",
  position: 512,
}, { expectStatus: 200 });
check("任务标记完成并记录 completedAt", done.data?.task?.status === "DONE" && Boolean(done.data?.task?.completedAt));

// 9. 乐观锁：用过期 updatedAt 再改一次
const stale = await call("PATCH", `/api/tasks/${taskA.id}`, {
  title: "改个标题",
  expectedUpdatedAt: taskA.updatedAt,
}, { expectStatus: 409 });
check("过期版本号触发 409 冲突", stale.status === 409);

// 10. 评论
const comment = await call("POST", `/api/tasks/${taskA.id}/comments`, {
  body: "这版可以，明天一起过一遍",
}, { expectStatus: 201 });
check("发表评论成功", comment.data?.comment?.body?.includes("明天"));

// 11. 动态流
const activity = await call("GET", `/api/tasks/${taskA.id}/activity`, undefined, { expectStatus: 200 });
const types = new Set((activity.data?.activity ?? []).map((a) => a.type));
check("动态流包含创建/流转/评论", types.has("CREATED") && types.has("STATUS_CHANGED") && types.has("COMMENTED"));

// 12. 权限：非组员访问他人小组
const otherCookie = cookie;
cookie = "";
await call("POST", "/api/auth/register", {
  name: "路人甲",
  email: `outsider-${stamp}@war-room.local`,
  password: "smoke1234",
}, { expectStatus: 200 });
const forbidden = await call("GET", `/api/groups/${group.id}/board`, undefined, { expectStatus: 403 });
check("非组员访问看板返回 403", forbidden.status === 403);
cookie = otherCookie;

// 13. SSE 实时推送
const controller = new AbortController();
const sse = await fetch(`${BASE}/api/groups/${group.id}/events`, {
  headers: { cookie },
  signal: controller.signal,
});
check("SSE 连接建立", sse.status === 200 && String(sse.headers.get("content-type")).includes("text/event-stream"));

const ssePromise = (async () => {
  const reader = sse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes("event: ready")) {
      await call("POST", `/api/groups/${group.id}/tasks`, { title: "SSE 触发任务" });
    }
    if (buffer.includes("event: task.created")) return true;
  }
  return false;
})();

const gotEvent = await ssePromise;
controller.abort();
check("SSE 收到 task.created 广播", gotEvent === true);

// 14. 退出登录
const logout = await call("POST", "/api/auth/logout", undefined, { expectStatus: 200 });
check("退出登录成功", logout.data?.ok === true);
const afterLogout = await call("GET", "/api/auth/me", undefined, { expectStatus: 401 });
check("退出后会话失效", afterLogout.status === 401);

console.log(`\n结果：${passed} 项通过，${failures.length} 项失败\n`);
if (failures.length > 0) {
  console.log("失败详情：");
  for (const failure of failures) console.log("  - " + failure);
  process.exit(1);
}
