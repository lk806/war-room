# 从零上线：GitHub → Railway

> 面向**没有 Git、没有 GitHub 仓库**的情况。按顺序复制粘贴即可，全程约 20 分钟（含下载安装）。
> 命令都在 **PowerShell** 或 **Git Bash** 里执行；`<尖括号>` 的内容要换成你自己的。

---

## 第 0 步：确认两件事

- 有一个 **GitHub 账号**（没有就去 <https://github.com/signup> 注册，邮箱验证一下）。
- 知道项目的完整路径。本文假设是：

```
C:\Users\DELL\Documents\deepseek-harness\default-workspace\war-room
```

---

## 第 1 步：安装 Git

PowerShell 里执行：

```powershell
winget install --id Git.Git -e --source winget
```

安装完成后**必须关掉当前终端窗口，重新打开一个**（PATH 才会生效）。然后验证：

```powershell
git --version
```

看到 `git version 2.x.x` 就成功了。

> 如果 `winget` 也不可用，去 <https://git-scm.com/download/win> 下载安装包，一路默认下一步即可。

---

## 第 2 步：配置提交身份

```powershell
git config --global user.name "你的名字"
git config --global user.email "你注册GitHub用的邮箱"
git config --global init.defaultBranch main
```

检查是否写进去了：

```powershell
git config --global --list
```

---

## 第 3 步：在本地把项目变成 Git 仓库

```powershell
cd C:\Users\DELL\Documents\deepseek-harness\default-workspace\war-room
git init -b main
git add -A
git status --short
```

### ⚠️ 这一步务必检查

`git status --short` 的输出里**绝对不能出现**下面这些：

| 不该出现 | 原因 |
| --- | --- |
| `.env` | 里面有你的 API Key |
| `node_modules/` | 依赖目录，几百 MB |
| `apps/api/data/` | 你的本地数据库和上传文件 |
| `apps/web/dist/` | 构建产物 |

出现了就说明 `.gitignore` 没生效，**先别提交**，把输出发我。

确认干净后提交：

```powershell
git commit -m "feat: 小组作业作战室 P0-P2（看板/DDL/文件/会议纪要/AI 拆分）"
```

---

## 第 4 步：在 GitHub 创建空仓库

1. 打开 <https://github.com/new>
2. **Repository name** 填：`war-room`
3. 可见性选 **Private**（推荐；后面 Railway 也能部署私有库）
4. ⚠️ **不要**勾选 "Add a README file"、"Add .gitignore"、"Choose a license"
5. 点 **Create repository**

创建完成后，页面上会显示一段带仓库地址的提示，把它复制下来，形如：

```
https://github.com/<你的用户名>/war-room.git
```

---

## 第 5 步：关联远程仓库并推送

把下面命令里的 `<你的用户名>` 换成你的 GitHub 用户名：

```powershell
git remote add origin https://github.com/<你的用户名>/war-room.git
git push -u origin main
```

### 第一次推送会弹窗

Git for Windows 自带 **Git Credential Manager**，会弹出浏览器窗口：

1. 选 **Sign in with your browser**（或 GitHub）
2. 浏览器里点 **Authorize**
3. 回到终端，看到 `main -> main` 就成功了

> 没弹窗、或推送时提示输入密码：GitHub 不接受账号密码，用 **Personal Access Token**。
> 生成地址：GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token，
> 勾选 **`repo`** 权限 → 生成后复制，推送时**用户名填 GitHub 用户名，密码位置粘贴 token**。

---

## 第 6 步：确认代码已经在 GitHub 上

打开 `https://github.com/<你的用户名>/war-room`，应该能看到：

- `README.md`、`Dockerfile`、`railway.json` 等文件
- **看不到** `.env`（如果看到了，立刻删除该文件并 `git rm --cached .env` + 重新提交）

---

## 第 7 步：Railway 部署

### 7.1 连接仓库

1. 打开 <https://railway.app> → **Login with GitHub**。
2. **New Project** → **Deploy from GitHub repo**。
3. 第一次会让你安装 GitHub App：选 **Only select repositories** → 勾选 `war-room` → **Install & Authorize**。
4. 回到 Railway，点选 `war-room` 仓库。

仓库里有 `Dockerfile` + `railway.json`，Railway 会自动用 Docker 构建，等 2–4 分钟。

### 7.2 配置环境变量

Service 页 → **Variables** → 右上角 **Raw Editor**，粘贴（换成你自己的 Key）：

```dotenv
DATA_DIR=/data
COOKIE_SECURE=true
AI_API_KEY=sk-你的文本模型Key
AI_BASE_URL=https://api.deepseek.com/v1
AI_MODEL=deepseek-chat
ASR_API_KEY=sk-你的语音Key
ASR_BASE_URL=https://api.siliconflow.cn/v1
ASR_MODEL=FunAudioLLM/SenseVoiceSmall
```

> 不填 AI 那几行也能跑（演示模式）。**不要设 `PORT`**，Railway 会自动注入。

### 7.3 挂持久化磁盘（不做这步，重启就丢数据）

Service 上右键 → **Add Volume**（或 **Attach Volume**）：

- **Mount path** 必须填 `/data`
- 大小 1GB 足够

### 7.4 生成公网域名

Service → **Settings** → **Networking** → **Generate Domain**

得到类似 `https://war-room-production-xxxx.up.railway.app` 的地址，打开它。

### 7.5 第一次使用

1. 打开域名 → 页面显示「登录作战室」→ 点 **注册一个** → 用你的邮箱注册。
2. 登录后进入引导页 → **新建小组** → 填小组名和课程名。
3. 侧边栏左下角能看到 **6 位邀请码**。
4. 把 **链接 + 邀请码** 发给组员：他们注册后选「用邀请码加入」，输入 6 位码即进入同一个看板。

> 线上不需要跑 `npm run seed`（那是本地演示数据）。想让线上也有演示数据，可以在 Railway 的 Service → **Command** 里执行 `npm run seed`，但**别把 `demo1234` 这个弱口令账号留在公网**。

---

## 第 8 步：以后怎么更新

改完代码后：

```powershell
cd C:\Users\DELL\Documents\deepseek-harness\default-workspace\war-room
git add -A
git commit -m "fix: 改了什么"
git push
```

Railway 会自动重新构建部署，数据在 `/data` 卷里不受影响。

---

## 常见报错对照

| 报错 | 原因 | 解决 |
| --- | --- | --- |
| `git : 无法将"git"项识别为...` | 装完没重开终端 | 关掉终端重新打开 |
| `fatal: not a git repository` | 不在项目目录 | 先 `cd` 到 `war-room` 目录 |
| `remote origin already exists` | 之前加过 | `git remote set-url origin <新地址>` |
| `rejected ... non-fast-forward` | 建仓库时勾了 README | `git pull --rebase origin main` 后再 `git push` |
| `Authentication failed` / 403 | 用了账号密码 / token 过期 | 用 PAT，或在「Windows 凭据管理器」删除 `github.com` 条目重试 |
| 推送很慢/卡住 | 网络问题 | 重试；或配置代理后再 push |
| Railway 构建失败 | 看 `Deploy Logs` | 把日志发我；常见是 Node 版本或 `npm ci` 锁文件不一致 |
| 打开域名 502 | 端口不对 | 删掉自己设的 `PORT` 变量 |
| 登录后刷新掉线 | 没用 HTTPS / Cookie 设置 | 用 `https://` 访问；或临时设 `COOKIE_SECURE=false` |
| 重启后数据没了 | 没挂卷 | Volume 挂到 `/data`，且 `DATA_DIR=/data` |

---

## 想更省事：用 GitHub CLI（可选）

装了 `gh` 可以跳过第 4、5 步手建仓库：

```powershell
winget install --id GitHub.cli -e --source winget
# 重开终端
gh auth login
cd C:\Users\DELL\Documents\deepseek-harness\default-workspace\war-room
git init -b main
git add -A
git commit -m "feat: 小组作业作战室 P0-P2"
gh repo create war-room --private --source=. --remote=origin --push
```

`gh auth login` 里选 `GitHub.com` → `HTTPS` → `Login with a web browser` → 复制一次性代码到浏览器粘贴。

---

## 上线后 5 分钟自检

- [ ] `https://<域名>/api/health` 返回 `{"ok":true,"db":"ok",...}`
- [ ] 能注册、能登录（刷新后不掉线）
- [ ] 建小组 → 看到邀请码 → 另一个浏览器用邀请码加入成功
- [ ] 建任务 → 拖到"进行中" → 刷新还在
- [ ] `https://<域名>/api/ai/status` 显示 `engine:"remote"`（配了 Key 的话）
- [ ] 传一个文件 → 下载回来能打开
- [ ] 新建会议 → 上传音频 → 逐字稿出现
- [ ] 两个浏览器同时开着，一边改任务，另一边自动刷新
- [ ] 手机打开链接，底部导航正常
