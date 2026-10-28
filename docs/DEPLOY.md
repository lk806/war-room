# 部署指南 · 让组员用链接访问

> 目标：把「小组作业作战室」放到公网，组员打开 `https://xxx.up.railway.app` 就能用。
> 结论先说：**Railway / Render / Fly.io / 自己的 VPS 可以，Vercel 不行**（原因见下）。

---

## 1. 先选平台

这个项目的运行时特征决定了它能去哪：

| 需求 | 说明 |
| --- | --- |
| **长驻进程** | Fastify 一直跑着，还要跑定时器（DDL 提醒扫描）和 SSE 长连接 |
| **持久化磁盘** | SQLite 数据库 + 上传的文件 + 会话密钥都在 `DATA_DIR` 里 |
| **单实例** | 数据在本地磁盘，不能水平扩容（小组规模完全够用） |

| 平台 | 适合度 | 说明 |
| --- | --- | --- |
| **Railway** | ✅ 推荐 | 原生支持 Dockerfile + Volume + 自动 HTTPS，最快 10 分钟能上线；约 $5/月 |
| **Render** | ✅ 可以 | 用 Docker 部署；**注意免费实例没有持久磁盘**，数据会丢，需要 Starter 实例才能挂盘 |
| **Fly.io** | ✅ 可以 | 免费额度含小容量卷，但需要装 `flyctl`，上手稍陡 |
| **自有 VPS**（阿里云/腾讯云/搬瓦工） | ✅ 稳妥 | 完全可控，需自己配 Nginx + HTTPS；国内访问快 |
| **Vercel** | ❌ 不适合 | 见下一节 |
| **Netlify / Cloudflare Pages** | ❌ | 纯静态托管，跑不了这个后端 |

---

## 2. 为什么 Vercel 不行

Vercel 的函数是无状态、短生命周期的，和这个项目有三处硬冲突：

| 冲突点 | 具体表现 |
| --- | --- |
| 没有持久文件系统 | `node:sqlite` 写的 `.db` 文件在函数实例之间不共享、重启即丢；上传的音频/文件同理 |
| 函数有时长上限 | SSE（`/api/groups/:id/events`）是长连接，会被平台掐断；DDL 提醒的 60s 定时器也不会一直活在 |
| 请求体 4.5MB 上限 | 文件区上限 200MB、会议音频更大，直接 413 |

**如果一定要上 Vercel**，需要重写数据层，工作量约等于一个新项目：

1. 数据库换 **Turso（libSQL）** 或 **Neon（Postgres）**，把所有 `db/index.ts` 的同步 SQL 改成异步客户端；
2. 上传换 **Vercel Blob / S3**，`storage` 那套内容寻址要改成对象存储 key；
3. 实时改 **轮询** 或第三方（Pusher/Ably），或者把 SSE 换成 Serverless 能支持的短轮询；
4. 定时提醒改 **Vercel Cron** 调一个 `/api/cron/reminders` 路由（加鉴权）。

课程项目不建议走这条路；下面按 Railway 走最短路径。

---

## 3. 部署前准备（5 分钟）

```bash
# 1) 确认能本地跑通生产模式
npm run build
npm start            # 打开 http://localhost:4000 应该能登录

# 2) 确认自检过
npm run smoke && npm run check:p1 && npm run check:p2

# 3) 提交到 GitHub（.env 已在 .gitignore 里，不会被提交）
git add -A
git commit -m "feat: war room P2"
git push origin main
```

仓库里已经放好了部署所需的文件：

| 文件 | 作用 |
| --- | --- |
| `Dockerfile` | `node:24-alpine`，`npm ci` → `npm run build` → `npm start`，暴露 4000，`DATA_DIR=/data` |
| `.dockerignore` | 排除 `node_modules` / `dist` / `data` / `.env`，避免把本地数据打进镜像 |
| `railway.json` | 指定用 Dockerfile 构建、健康检查路径 `/api/health` |
| `.nvmrc` | Node 24（如果平台不用 Docker 而是自动识别 Node 项目时生效） |

---

## 4. Railway 手把手（推荐）

### 4.1 创建项目

1. 打开 <https://railway.app> → 用 GitHub 登录。
2. **New Project** → **Deploy from GitHub repo** → 选择你的仓库。
3. 因为仓库里有 `railway.json` + `Dockerfile`，Railway 会自动用 Dockerfile 构建。
   第一次构建约 2–4 分钟（装依赖 + 构建前端）。

> 如果它没识别，进入 Service → **Settings** → **Build** → Builder 选 **Dockerfile**，路径填 `Dockerfile`。

### 4.2 配环境变量

Service → **Variables** → **Raw Editor**，把下面整段贴进去（值换成你自己的）：

```dotenv
AI_API_KEY=sk-你的文本模型Key
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat

ASR_API_KEY=sk-你的语音Key
ASR_BASE_URL=https://api.siliconflow.cn/v1
ASR_MODEL=FunAudioLLM/SenseVoiceSmall

DATA_DIR=/data
COOKIE_SECURE=true
```

说明：

- `DATA_DIR=/data` 必须和下面的卷挂载路径一致，否则重启就丢数据。
- `COOKIE_SECURE=true` 让登录 Cookie 只在 HTTPS 下发送；Railway 的域名默认是 HTTPS。
- **不要**手动设 `PORT`：Railway 会自己注入，写死会冲突。
- 不填 AI 变量也能跑，会自动进入演示模式（页面顶部有提示）。

### 4.3 挂载持久化卷（关键）

Service 页面右键 → **Add Volume**（或 **Attach Volume**）：

- **Mount path 填 `/data`**（必须和 `DATA_DIR` 一模一样）
- 大小按需，1GB 足够课程项目用

没有这一步，每次重新部署数据库和上传的文件都会消失。

### 4.4 生成公网域名

Service → **Settings** → **Networking** → **Generate Domain** → 得到一个 `https://xxx.up.railway.app`。

浏览器打开，应该看到登录页。**第一次使用需要注册账号**（数据库是空的，不会自动塞演示数据）。

### 4.5 首次使用（组员加入）

1. 你注册 → 建小组 → 侧边栏能看到 6 位邀请码；
2. 把链接 + 邀请码发给组员；
3. 组员用自己的邮箱注册 → 输入邀请码加入 → 进入同一个看板。

> 想让演示数据也在线上：在 Railway 的 **Command** 里执行 `npm run seed`（或本地 `railway run npm run seed`）。
> ⚠️ 种子数据里有 `demo@war-room.local / demo1234` 这个弱口令账号，公网演示完请删掉这条记录或改密码。

### 4.6 常用命令（CLI，可选）

```bash
npm i -g @railway/cli
railway login
railway link                 # 关联到已有项目
railway up                   # 本地代码直接部署
railway logs                 # 看实时日志
railway variables            # 查看环境变量
railway run npm run seed     # 用线上环境变量在本地执行脚本
```

---

## 5. Render（备选）

1. **New** → **Web Service** → 连接仓库。
2. **Runtime** 选 **Docker**，Dockerfile 路径 `Dockerfile`。
3. **Environment** 里加和上面一样的环境变量（`DATA_DIR=/data`、`COOKIE_SECURE=true`、AI 相关）。
4. **Disks** → Add Disk，Mount Path 填 `/data`（⚠️ 免费实例不支持挂盘，必须选 **Starter** 及以上，否则重启丢数据）。
5. 部署完成后用 `https://xxx.onrender.com` 访问。

> Render 免费实例 15 分钟无请求会休眠，冷启动约 30–60 秒；SSE 在休眠时自然断开，重连即可。

---

## 6. Fly.io（备选，免费额度友好）

```bash
# 首次
fly launch --no-deploy          # 会生成 fly.toml，Dockerfile 已被识别
fly volumes create war_data --size 1 --region sin   # 新加坡；国内可选 hkg
fly secrets set AI_API_KEY=sk-xxx ASR_API_KEY=sk-xxx \
  ASR_BASE_URL=https://api.siliconflow.cn/v1 ASR_MODEL=FunAudioLLM/SenseVoiceSmall \
  AI_BASE_URL=https://api.deepseek.com/v1 AI_MODEL=deepseek-chat
fly deploy
```

在 `fly.toml` 里补上挂载和端口：

```toml
[env]
  DATA_DIR = "/data"
  COOKIE_SECURE = "true"

[[mounts]]
  source = "war_data"
  destination = "/data"

[http_service]
  internal_port = 4000
  force_https = true
```

---

## 7. 自有 VPS（最稳，国内访问快）

```bash
# 服务器上（假设已装 Docker）
git clone <your-repo> war-room && cd war-room

# 用平台无关的生产 env 文件（不要提交到 git）
cat > .env.production <<'EOF'
AI_API_KEY=sk-xxx
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
ASR_API_KEY=sk-xxx
ASR_BASE_URL=https://api.siliconflow.cn/v1
ASR_MODEL=FunAudioLLM/SenseVoiceSmall
DATA_DIR=/data
COOKIE_SECURE=true
EOF

docker build -t war-room .
# 注意：.env* 已被 .dockerignore 排除，密钥不会被打进镜像层；
# 下面用 --env-file 在「运行时」注入，镜像可以安全地分享/推送。
docker run -d --name war-room --restart unless-stopped \
  -p 3000:4000 \
  -v /opt/war-room/data:/data \
  --env-file .env.production \
  war-room
```

Nginx 反代（**SSE 必须关缓冲**，否则实时推送会卡住）：

```nginx
server {
  listen 443 ssl http2;
  server_name war.example.com;

  client_max_body_size 210m;        # 文件区上限 200MB，留点余量

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SSE 必需
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
  }
}
```

HTTPS 用 `certbot --nginx -d war.example.com` 一条命令搞定。

---

## 8. 环境变量速查

| 变量 | 必填 | 生产建议值 | 说明 |
| --- | --- | --- | --- |
| `DATA_DIR` | ✅ | `/data` | SQLite + 上传文件 + 会话密钥，**必须在持久卷上** |
| `COOKIE_SECURE` | ✅ | `true` | 域名是 HTTPS 时开；本地 http 调试可设 `false` |
| `AI_API_KEY` | 建议 | `sk-...` | 不填则文本 AI 走演示模式 |
| `AI_BASE_URL` / `AI_MODEL` | 建议 | `https://api.deepseek.com/v1` / `deepseek-chat` | OpenAI 兼容服务均可 |
| `ASR_API_KEY` / `ASR_BASE_URL` / `ASR_MODEL` | 建议 | 硅基流动 + `FunAudioLLM/SenseVoiceSmall` | 不填则转写走内置样例 |
| `AUTH_SECRET` | 多实例必填 | 32+ 位随机串 | 不设会自动生成并存在 `DATA_DIR/.auth-secret`（单实例够用） |
| `AI_PROVIDER` | 可选 | `mock` | 强制演示模式，防止公网被别人刷 AI 额度 |
| `PORT` | ❌ 别设 | — | 平台自动注入 |
| `LOG_LEVEL` | 可选 | `info` | 排错时可用 `debug` |

---

## 9. 数据与备份

所有数据都在卷里：

```
/data/war-room.db       SQLite 主库（含 -wal / -shm）
/data/storage/<sha256>  上传的文件与会议音频（内容寻址）
/data/.auth-secret      会话签名密钥（丢了所有人要重新登录）
```

**备份（有 shell 时）**：

```bash
# Railway（付费计划支持 railway ssh）/ VPS
tar -czf /tmp/war-room-$(date +%F).tgz -C /data .
```

**恢复**：停服务 → 解开 tar 覆盖 `/data` → 启动。

> 目前没有内置「导出备份」接口；如果经常需要，P3 可以加一个管理员专用的 `/api/admin/backup`（返回 tar 流）。

---

## 10. 上线后自检清单

按顺序点一遍，5 分钟能确认部署没问题：

- [ ] `https://<域名>/api/health` 返回 `{"ok":true,"db":"ok",...}`
- [ ] 打开首页能看到登录页（不是 404 / 502）
- [ ] 注册账号 → 建小组 → 侧边栏看到邀请码
- [ ] 新建任务 → 拖到"进行中" → 刷新页面状态还在（说明数据库可写）
- [ ] `https://<域名>/api/ai/status` 显示 `engine:"remote"`（配了 Key 的话）
- [ ] 上传一个文件 → 下载回来内容一致（说明磁盘可写）
- [ ] 新建会议 → 上传音频 → 逐字稿出现（说明 ASR 通）
- [ ] 两个浏览器登录不同账号，A 改任务 B 自动刷新（说明 SSE 通）
- [ ] 手机打开链接，底部导航正常

---

## 11. 排错

| 现象 | 常见原因 | 处理 |
| --- | --- | --- |
| 502 / 一直部署失败 | 端口不对 | 不要手设 `PORT`；确认容器监听 `0.0.0.0`（默认就是） |
| 打开是 404 或空白 | 前端没构建 | 镜像里必须执行过 `npm run build`；确认 `apps/web/dist` 存在 |
| 登录后一刷新就掉线 | Cookie `Secure` 与协议不匹配 | 用 HTTPS 访问；临时可设 `COOKIE_SECURE=false` |
| 重启后数据全没了 | 没挂卷 / 挂错路径 | 卷挂到 `/data`，且 `DATA_DIR=/data` |
| SQLite 报 `readonly database` | 卷没挂上或权限不足 | 检查卷挂载；Docker 里可加 `-u 0` 临时排查权限 |
| AI 调用 401 / 402 | Key 错或余额不足 | 看 `railway logs` 里的错误片段；用 `npm run env:check` 本地核对 |
| 上传大文件 413 | 反向代理体积限制 | Nginx `client_max_body_size 210m`；平台侧确认没有更小的限制（单文件上限默认 200MB，可用 `MAX_UPLOAD_BYTES` 调整） |
| SSE 不推送 | 代理缓冲了长连接 | Nginx 关 `proxy_buffering`；平台一般不用管 |
| 构建时报 `bad option: --env-file-if-exists` | 平台 Node < 22.9 | 用仓库里的 Dockerfile（固定 `node:24-alpine`），或设 `NODE_VERSION=24` |
| 部署后看到 `Port 4000 already in use` | 同一容器里起了两个进程 | 确认启动命令只有 `npm start` |

---

## 12. 安全与成本

公网链接一旦发出去，任何人都能访问。三件事建议现在就做：

1. **别公开发链接**：只发给组员；注册虽然开放，但你的小组有邀请码，别人进不来。
2. **防 AI 额度被刷**：注册用户可以自己建小组并调用 AI 接口，等于能花你的钱。建议：
   - 在 DeepSeek / 硅基流动控制台设置**消费限额与用量告警**；
   - 或者上线演示时设 `AI_PROVIDER=mock`，需要演示真实效果时再临时改成 remote。
3. **密钥只放平台变量**，永远不要把 `.env` 提交到仓库（`.gitignore` 已经排除，但提交前用 `git status` 再确认一次）。

其他：

- 生产环境别用 `seed` 里的 `demo1234` 弱口令账号；如果已经跑了 seed，删掉那个用户。
- 建议给 `/api/auth/*` 加限流（`@fastify/rate-limit`），防暴力破解；当前版本未内置。
- 平台免费实例（Render 等）会休眠，答辩演示前先访问一次"唤醒"。

---

## 13. 更新与回滚

- **更新**：`git push` → 平台自动重新构建部署（数据在卷里不受影响）。
- **回滚**：Railway → Deployments → 选上一个版本 → **Redeploy**。
- **改表结构**：当前是「幂等建表 + 启动时补列」，加字段安全；删字段/改类型需要自己写迁移，先在本地备份数据库再操作。

---

需要更省事的方案？如果只是给组员临时用一周，**Railway + Dockerfile + 一个 /data 卷** 是最短路径，全程不超过 15 分钟。
