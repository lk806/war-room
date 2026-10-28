/**
 * P3 贡献记录自检：事件埋点、算分（完成10/评审4/文件2/评论1）、汇总、CSV。
 * 用法：node scripts/check-p3.mjs [baseUrl]
 * 会注册一个全新的小组，不依赖演示数据。
 */
const BASE = process.argv[2] ?? "http://localhost:4000";
const stamp = Date.now();

let cookie = "";
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

const jar = (res) => {
  for (const item of res.headers.getSetCookie?.() ?? []) {
    const pair = item.split(";")[0];
    if (pair.startsWith("wr_session=")) cookie = pair;
  }
};

async function call(method, path, body, expectStatus) {
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
    throw new Error(`${method} ${path} -> ${res.status}（期望 ${expectStatus}）: ${text.slice(0, 200)}`);
  }
  return { status: res.status, data };
}

const summaryOf = async (range = "all") =>
  (await call("GET", `/api/groups/${group.id}/contributions?range=${range}`, undefined, 200)).data;

console.log(`\n🔍 P3 贡献记录自检 ${BASE}\n`);

/* ---------------- 准备：两个账号 + 一个全新小组 ---------------- */
const leaderEmail = `p3-leader-${stamp}@test.local`;
const memberEmail = `p3-member-${stamp}@test.local`;

await call("POST", "/api/auth/register", { name: "组长甲", email: leaderEmail, password: "p3pass123" }, 200);
const group = (await call("POST", "/api/groups", { name: "P3 贡献验证组", course: "软件工程" }, 201)).data.group;

// 第二个成员
cookie = "";
await call("POST", "/api/auth/register", { name: "组员乙", email: memberEmail, password: "p3pass123" }, 200);
await call("POST", "/api/groups/join", { inviteCode: group.inviteCode }, 201);
const memberId = (await call("GET", "/api/auth/me", undefined, 200)).data.user.id;

// 切回组长
cookie = "";
await call("POST", "/api/auth/login", { email: leaderEmail, password: "p3pass123" }, 200);
const leaderId = (await call("GET", "/api/auth/me", undefined, 200)).data.user.id;

const empty = await summaryOf();
check("新小组初始贡献为 0", empty.totalEvents === 0 && empty.totalScore === 0, JSON.stringify(empty.totalScore));
check("成员列表包含两个成员", empty.members.length === 2, `members=${empty.members.length}`);

/* ---------------- 事件 1：建任务（+2） ---------------- */
const taskA = (
  await call("POST", `/api/groups/${group.id}/tasks`, { title: "P3 自建任务（自己完成）" }, 201)
).data.task;
let s = await summaryOf();
check("创建任务记 2 分", s.totalScore === 2, `score=${s.totalScore}`);
check("事件类型为 task_created", s.kinds.find((k) => k.kind === "task_created")?.count === 1);

/* ---------------- 事件 2：自己完成（+10，记给负责人） ---------------- */
await call("PATCH", `/api/tasks/${taskA.id}`, { status: "DONE" }, 200);
s = await summaryOf();
check("完成任务记 10 分", s.totalScore === 12, `score=${s.totalScore}`);
const leaderAfterSelf = s.members.find((m) => m.userId === leaderId);
check("完成分记给负责人", leaderAfterSelf?.score === 12, `leader=${leaderAfterSelf?.score}`);
check("自己完成不算评审分", s.kinds.find((k) => k.kind === "task_reviewed")?.count === 0);

/* ---------------- 事件 3：评论（+1） ---------------- */
await call("POST", `/api/tasks/${taskA.id}/comments`, { body: "P3 自检评论" }, 201);
s = await summaryOf();
check("发表评论记 1 分", s.totalScore === 13, `score=${s.totalScore}`);

/* ---------------- 事件 4：上传文件（+2） ---------------- */
const form = new FormData();
form.append("file", new Blob(["p3 contribution check"], { type: "text/plain" }), `p3-${stamp}.txt`);
const upload = await fetch(`${BASE}/api/groups/${group.id}/files`, {
  method: "POST",
  headers: { cookie },
  body: form,
});
check("上传文件成功", upload.status === 201, `status=${upload.status}`);
s = await summaryOf();
check("上传文件记 2 分", s.totalScore === 15, `score=${s.totalScore}`);

/* ---------------- 事件 5+6：指派给别人 → 评审通过（+4 / +10） ---------------- */
const taskB = (
  await call("POST", `/api/groups/${group.id}/tasks`, {
    title: "P3 指派任务（由他人评审）",
    assigneeId: memberId,
  }, 201)
).data.task;
await call("POST", `/api/tasks/${taskB.id}/move`, { status: "REVIEW", position: 0 }, 200);
await call("POST", `/api/tasks/${taskB.id}/move`, { status: "DONE", position: 0 }, 200);

s = await summaryOf();
const leader = s.members.find((m) => m.userId === leaderId);
const member = s.members.find((m) => m.userId === memberId);
check("评审通过记 4 分给评审人", leader?.byKind.task_reviewed === 1, `reviewed=${leader?.byKind.task_reviewed}`);
check("完成分记给负责人（组员乙 +10）", member?.score === 10, `member=${member?.score}`);
// 建任务 2×2 + 自己完成 10 + 评论 1 + 文件 2 + 他人完成 10 + 评审 4 = 31
check("总分累计正确（31 分）", s.totalScore === 31, `score=${s.totalScore}`);

/* ---------------- 汇总维度 ---------------- */
const byKind = Object.fromEntries(s.kinds.map((k) => [k.kind, k]));
check("权重口径：完成 10", byKind.task_completed?.weight === 10);
check("权重口径：评审 4", byKind.task_reviewed?.weight === 4);
check("权重口径：文件 2", byKind.file_uploaded?.weight === 2);
check("权重口径：评论 1", byKind.comment_created?.weight === 1);
check("维度分数 = 次数 × 权重", byKind.task_completed?.score === byKind.task_completed?.count * 10);
check("排行按分数降序", s.members[0].score >= s.members[1].score);
check("活跃成员数正确", s.activeMembers === 2, `active=${s.activeMembers}`);
check("近 8 周趋势有 8 个桶", s.weeks.length === 8, `weeks=${s.weeks.length}`);
check("最近动态带金额与标题", s.recent.length > 0 && typeof s.recent[0].weight === "number");

/* ---------------- 时间范围 ---------------- */
const week = await summaryOf("week");
const month = await summaryOf("month");
check("range=week 能取到刚发生的事件", week.totalEvents === s.totalEvents, `week=${week.totalEvents}`);
check("range=month 与全部一致（都是新数据）", month.totalEvents === s.totalEvents);
const invalid = await call("GET", `/api/groups/${group.id}/contributions?range=bad`, undefined, 200);
check("非法 range 回退到默认值", invalid.data.range === "week", invalid.data.range);

/* ---------------- CSV 导出 ---------------- */
const csvRes = await fetch(`${BASE}/api/groups/${group.id}/contributions.csv?range=all`, {
  headers: { cookie },
});
const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
const csv = new TextDecoder("utf-8").decode(csvBytes);
check("CSV 返回 200", csvRes.status === 200);
check("CSV Content-Type 正确", (csvRes.headers.get("content-type") ?? "").includes("text/csv"));
// Response.text() 会按规范吞掉 BOM，所以直接看前三个字节 EF BB BF
check(
  "CSV 带 UTF-8 BOM（Excel 不乱码）",
  csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
  `head=${[...csvBytes.slice(0, 3)].map((b) => b.toString(16)).join(" ")}`,
);
check("CSV 含表头", csv.includes("成员,角色,总分,事件数"));
check("CSV 含两个成员与合计行", csv.includes("组长甲") && csv.includes("组员乙") && csv.includes("合计"));
check(
  "CSV 附件名支持中文",
  (csvRes.headers.get("content-disposition") ?? "").includes("filename*=UTF-8''"),
);
check(
  "CSV 时间是紧凑格式（2026-10-27 19:07）",
  /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(csv),
  csv.split("\r\n").find((line) => line.includes("组长甲")) ?? "",
);
check("CSV 不再出现带 T 的 ISO 时间", !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(csv));

/* ---------------- 只有组长能「待评审 → 已完成」 ---------------- */
const taskC = (
  await call("POST", `/api/groups/${group.id}/tasks`, {
    title: "P3 权限任务（组长把关）",
    assigneeId: leaderId,
  }, 201)
).data.task;
await call("POST", `/api/tasks/${taskC.id}/move`, { status: "REVIEW", position: 0 }, 200);

const leaderCookie = cookie;
cookie = "";
await call("POST", "/api/auth/login", { email: memberEmail, password: "p3pass123" }, 200);
const memberApprove = await call("POST", `/api/tasks/${taskC.id}/move`, { status: "DONE", position: 0 }, 403);
check("组员不能把任务从「待评审」移到「已完成」（403）", memberApprove.status === 403);
check(
  "403 提示说明需要组长",
  String(memberApprove.data?.error ?? "").includes("组长"),
  JSON.stringify(memberApprove.data).slice(0, 100),
);
const memberPatch = await call("PATCH", `/api/tasks/${taskC.id}`, { status: "DONE" }, 403);
check("PATCH 改状态同样被拦（403）", memberPatch.status === 403);

// 从「待办」直接拖到「已完成」也要被拦
const taskD = (
  await call("POST", `/api/groups/${group.id}/tasks`, { title: "P3 直拖任务" }, 201)
).data.task;
const memberDirect = await call("POST", `/api/tasks/${taskD.id}/move`, { status: "DONE", position: 0 }, 403);
check("组员不能把任务从「待办」直接移到「已完成」（403）", memberDirect.status === 403);

// 直接新建为「已完成」同样被拦
const memberCreateDone = await call("POST", `/api/groups/${group.id}/tasks`, {
  title: "P3 直接建已完成任务",
  status: "DONE",
}, 403);
check("组员不能直接新建「已完成」任务（403）", memberCreateDone.status === 403);

cookie = leaderCookie;
const leaderApprove = await call("POST", `/api/tasks/${taskC.id}/move`, { status: "DONE", position: 0 }, 200);
check("组长可以把「待评审」移入「已完成」（200）", leaderApprove.status === 200);

const leaderDirect = await call("POST", `/api/tasks/${taskD.id}/move`, { status: "DONE", position: 0 }, 200);
check("组长可以直接把「待办」移到「已完成」（200）", leaderDirect.status === 200);

const leaderCreateDone = await call("POST", `/api/groups/${group.id}/tasks`, {
  title: "P3 组长直接建已完成任务",
  status: "DONE",
}, 201);
check("组长可以直接新建「已完成」任务（201）", leaderCreateDone.status === 201);

// 反向操作（从已完成退出来）不受限制
cookie = "";
await call("POST", "/api/auth/login", { email: memberEmail, password: "p3pass123" }, 200);
const memberReopen = await call("POST", `/api/tasks/${taskD.id}/move`, { status: "TODO", position: 0 }, 200);
check("组员可以把「已完成」退回「待办」（200）", memberReopen.status === 200);

/* ---------------- 权限 ---------------- */
cookie = "";
await call("POST", "/api/auth/register", {
  name: "局外人",
  email: `p3-outsider-${stamp}@test.local`,
  password: "p3pass123",
}, 200);
const forbidden = await call("GET", `/api/groups/${group.id}/contributions`, undefined, 403);
check("非组员看不到贡献统计（403）", forbidden.status === 403);
const csvForbidden = await fetch(`${BASE}/api/groups/${group.id}/contributions.csv`, { headers: { cookie } });
check("非组员不能导出 CSV（403）", csvForbidden.status === 403);

console.log(`\n结果：${passed} 项通过，${failures.length} 项失败\n`);
if (failures.length) {
  console.log("失败详情：\n" + failures.map((item) => "  - " + item).join("\n"));
  process.exit(1);
}
