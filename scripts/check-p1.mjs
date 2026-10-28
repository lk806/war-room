/**
 * P1 功能的快速自检脚本（服务需已启动在 baseUrl）。
 * 覆盖：DDL 提醒扫描 / 文件上传 / 下载 / 删除 / 类型拦截 / 权限。
 */
const BASE = process.argv[2] ?? "http://localhost:4000";
let cookie = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    throw new Error(`${method} ${path} -> ${res.status} (期望 ${expectStatus}): ${text.slice(0, 200)}`);
  }
  return { status: res.status, data, res };
}

const stamp = Date.now();
console.log(`\n🔍 P1 功能自检 ${BASE}\n`);

// 登录演示账号
await call("POST", "/api/auth/login", { email: "demo@war-room.local", password: "demo1234" }, 200);
const groups = (await call("GET", "/api/groups", undefined, 200)).data.groups;
const group = groups[0];
check("登录并拿到小组", Boolean(group?.id));

/* ------------------------- 1. DDL 提醒 ------------------------- */
const before = (await call("GET", `/api/groups/${group.id}/reminders`, undefined, 200)).data.reminders;
await call(
  "POST",
  `/api/groups/${group.id}/tasks`,
  { title: `自检-30分钟后到期-${stamp}`, dueAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() },
  201,
);
const after = (await call("GET", `/api/groups/${group.id}/reminders`, undefined, 200)).data.reminders;
check("30 分钟内到期的任务触发 1H 提醒", after.length > before.length && after[0]?.level === "1H", `level=${after[0]?.level}`);

const sweep = await call("POST", `/api/groups/${group.id}/reminders/sweep`, undefined, 200);
check("重复扫描不会重复发提醒（去重生效）", sweep.data.sent === 0, `sent=${sweep.data.sent}`);

/* ------------------------- 2. 文件上传 ------------------------- */
const form = new FormData();
const content = `小组作业作战室 自检文件 ${stamp}\n第二行内容。`;
form.append("file", new Blob([content], { type: "text/plain" }), `自检说明-${stamp}.txt`);
const uploadRes = await fetch(`${BASE}/api/groups/${group.id}/files`, {
  method: "POST",
  headers: { cookie },
  body: form,
});
const upload = await uploadRes.json();
check("上传文件成功（201）", uploadRes.status === 201, JSON.stringify(upload).slice(0, 160));
check("中文文件名正确保留", upload.file?.name === `自检说明-${stamp}.txt`, upload.file?.name);
check("记录了大小与版本", upload.file?.size === Buffer.byteLength(content) && upload.file?.version === 1);

// 同名再传一次 -> 版本号 +1
const form2 = new FormData();
form2.append("file", new Blob([content + "\n补充一行"], { type: "text/plain" }), `自检说明-${stamp}.txt`);
const upload2 = await (await fetch(`${BASE}/api/groups/${group.id}/files`, {
  method: "POST",
  headers: { cookie },
  body: form2,
})).json();
check("同名文件再次上传版本号 +1", upload2.file?.version === 2, `version=${upload2.file?.version}`);

/* ------------------------- 3. 下载 ------------------------- */
const downloadRes = await fetch(`${BASE}/api/files/${upload.file.id}/download`, {
  headers: { cookie },
});
const downloaded = await downloadRes.text();
check("下载内容与上传一致", downloaded === content);
check("下载头包含 RFC5987 文件名", (downloadRes.headers.get("content-disposition") ?? "").includes("filename*=UTF-8''"));
const list = (await call("GET", `/api/groups/${group.id}/files`, undefined, 200)).data.files;
const sameName = list.filter((f) => f.name === upload.file.name);
check("文件列表按时间倒序且含两个版本", sameName.length === 2 && sameName[0].version === 2);
check("下载计数 +1", (sameName.find((f) => f.id === upload.file.id)?.downloadCount ?? 0) === 1);

/* --------------------- 4. 上传限制（黑名单策略） --------------------- */
const uploadFile = async (blob, name) => {
  const body = new FormData();
  body.append("file", blob, name);
  const res = await fetch(`${BASE}/api/groups/${group.id}/files`, {
    method: "POST",
    headers: { cookie },
    body,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

// 高危脚本：拒绝
const shUpload = await uploadFile(new Blob(["#!/bin/sh\necho hi"]), "evil.sh");
check("高危脚本 .sh 被拒绝（415）", shUpload.status === 415, `status=${shUpload.status}`);
check(
  "拒绝文案说明是「可执行/脚本」",
  String(shUpload.json.error ?? "").includes("可执行"),
  JSON.stringify(shUpload.json).slice(0, 120),
);
const exeUpload = await uploadFile(new Blob(["MZ fake"]), "setup.exe");
check("可执行文件 .exe 被拒绝（415）", exeUpload.status === 415, `status=${exeUpload.status}`);

// 伪装成 png 的文本
const fakePng = await uploadFile(new Blob(["not an image"], { type: "image/png" }), "fake.png");
check("伪装扩展名被魔数校验拦下（415）", fakePng.status === 415, `status=${fakePng.status}`);

// 可执行内容但改了扩展名
const mzBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const disguised = await uploadFile(new Blob([mzBytes]), "看起来是图片.png");
check("可执行内容改扩展名也会被拦（415）", disguised.status === 415, `status=${disguised.status}`);

// 特殊后缀 / 未知格式：放行（黑名单策略）
const unknownExt = await uploadFile(new Blob(["Figma binary-ish content"]), `设计稿-${stamp}.fig`);
check("未知后缀 .fig 可以上传（201）", unknownExt.status === 201, `status=${unknownExt.status}`);
const noExt = await uploadFile(new Blob(["plain text without extension"]), `README-${stamp}`);
check("无扩展名文件可以上传（201）", noExt.status === 201, `status=${noExt.status}`);

// 常见的 office / 压缩包（zip 魔数）
const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const rarLike = await uploadFile(new Blob([zipBytes]), `资料打包-${stamp}.zip`);
check("zip 压缩包可以上传（201）", rarLike.status === 201, `status=${rarLike.status}`);

/* ---------------- 4.1 特殊字符文件名 ---------------- */
const weirdName = `会议材料 (v2) #1&测试+100%.avif`;
const avifBytes = new Uint8Array([
  0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
  0x00, 0x00, 0x00, 0x00, 0x61, 0x76, 0x69, 0x66, 0x6d, 0x69, 0x66, 0x31,
]);
const weirdUpload = await uploadFile(new Blob([avifBytes], { type: "image/avif" }), weirdName);
check("特殊字符文件名可以上传（201）", weirdUpload.status === 201, `status=${weirdUpload.status}`);
check("特殊字符文件名原样保留", weirdUpload.json.file?.name === weirdName, weirdUpload.json.file?.name);

if (weirdUpload.json.file?.id) {
  const weirdDownload = await fetch(`${BASE}/api/files/${weirdUpload.json.file.id}/download`, {
    headers: { cookie },
  });
  const disposition = weirdDownload.headers.get("content-disposition") ?? "";
  check(
    "下载时用 RFC5987 编码文件名",
    disposition.includes("filename*=UTF-8''") &&
      disposition.includes(encodeURIComponent(weirdName)),
    disposition,
  );
}

/* --------------------- 4.2 AVIF / 网页抓图 --------------------- */
const avifUpload = await uploadFile(new Blob([avifBytes], { type: "image/avif" }), `博客配图-${stamp}.avif`);
check("AVIF 图片可以上传（201）", avifUpload.status === 201, `status=${avifUpload.status}`);

// 有些 CDN 的图片地址长这样：xxx.jpg@dynamic.avif，实际字节是 AVIF
const cdnUpload = await uploadFile(
  new Blob([avifBytes], { type: "image/avif" }),
  `c4b1bdd42e05f9511fd3810cb87f9752152353856.jpg@dynamic.avif`,
);
check("带 @dynamic 后缀的 AVIF 也能上传（201）", cdnUpload.status === 201, `status=${cdnUpload.status}`);

// JPEG 字节挂在 .avif 名下（部分 CDN 转码失败会这样）也应放行
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const mismatchUpload = await uploadFile(new Blob([jpegBytes], { type: "image/jpeg" }), `转码图片-${stamp}.avif`);
check("扩展名 .avif 但内容是 JPEG 时放行（201）", mismatchUpload.status === 201, `status=${mismatchUpload.status}`);

/* --------------------- 4.3 上限口径 --------------------- */
const limitInfo = (await call("GET", `/api/groups/${group.id}/files`, undefined, 200)).data;
check(
  "文件区返回的单文件上限是 200MB",
  limitInfo.maxBytes === 200 * 1024 * 1024,
  `maxBytes=${limitInfo.maxBytes}`,
);

/* ------------------------- 5. 权限 ------------------------- */
const outsider = await fetch(`${BASE}/api/files/${upload.file.id}/download`);
check("未登录不能下载（401）", outsider.status === 401, `status=${outsider.status}`);

const beforeDelete = (await call("GET", `/api/groups/${group.id}/files`, undefined, 200)).data.files;
const delRes = await fetch(`${BASE}/api/files/${upload.file.id}`, {
  method: "DELETE",
  headers: { cookie },
});
check("上传者可以删除自己的文件", delRes.status === 200, `status=${delRes.status}`);
const afterDelete = (await call("GET", `/api/groups/${group.id}/files`, undefined, 200)).data.files;
check(
  "删除后列表减少",
  afterDelete.length === beforeDelete.length - 1 &&
    !afterDelete.some((f) => f.id === upload.file.id),
  `${beforeDelete.length} -> ${afterDelete.length}`,
);

console.log(`\n结果：${passed} 项通过，${failures.length} 项失败\n`);
if (failures.length) {
  console.log("失败详情：", failures.join(" / "));
  process.exit(1);
}
