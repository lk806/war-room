-- 小组作业作战室 · P0 数据模型
-- 说明：所有表一次建好（含 P1+ 才用到的 files / contribution_events / meetings / ai_jobs），
-- 避免后续反复迁移；P0 只写入 users / groups / memberships / tasks / task_activity / comments
-- / contribution_events 的一部分。时间统一存 UTC ISO 字符串。

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_color  TEXT NOT NULL DEFAULT '#6366f1',
  -- AI 功能（纪要 / 拆分 / 转写）需要单独授权，默认关闭
  can_use_ai    INTEGER NOT NULL DEFAULT 0,
  -- 用户自带的 DeepSeek Key（AES-256-GCM 加密存储，格式 enc:v1:iv:tag:data）
  user_deepseek_key TEXT,
  created_at    TEXT NOT NULL
);

-- 注：SQLite 里 GROUPS 是窗口函数关键字，表名用 teams 表示「小组」
CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  course      TEXT NOT NULL DEFAULT '',
  invite_code TEXT NOT NULL UNIQUE,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  group_id  TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('LEADER', 'MEMBER')),
  skills    TEXT NOT NULL DEFAULT '[]',
  joined_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  group_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  parent_id      TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'TODO'
                 CHECK (status IN ('TODO', 'IN_PROGRESS', 'REVIEW', 'DONE')),
  priority       TEXT NOT NULL DEFAULT 'MEDIUM'
                 CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
  due_at         TEXT,
  assignee_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  estimate_hours REAL,
  position       REAL NOT NULL DEFAULT 1024,
  meeting_id     TEXT,
  created_by     TEXT NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  completed_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(group_id, status, position);
CREATE INDEX IF NOT EXISTS idx_tasks_due   ON tasks(group_id, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_mine  ON tasks(group_id, assignee_id);

CREATE TABLE IF NOT EXISTS task_activity (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id    TEXT NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  payload_json TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_task ON task_activity(task_id, created_at);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);

-- P1：文件共享
CREATE TABLE IF NOT EXISTS files (
  id             TEXT PRIMARY KEY,
  group_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  uploader_id    TEXT NOT NULL REFERENCES users(id),
  name           TEXT NOT NULL,
  mime           TEXT NOT NULL,
  size           INTEGER NOT NULL,
  storage_key    TEXT NOT NULL,
  sha256         TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  task_id        TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  download_count INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_group ON files(group_id, created_at);

-- 贡献事件：append-only，唯一事实来源，统计一律从这里聚合
CREATE TABLE IF NOT EXISTS contribution_events (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  ref_type   TEXT NOT NULL,
  ref_id     TEXT NOT NULL,
  weight     REAL NOT NULL DEFAULT 0,
  meta_json  TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contrib_group ON contribution_events(group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contrib_user  ON contribution_events(group_id, user_id, created_at);

-- 会议与纪要（P2）
CREATE TABLE IF NOT EXISTS meetings (
  id               TEXT PRIMARY KEY,
  group_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  started_at       TEXT NOT NULL,
  duration_sec     INTEGER NOT NULL DEFAULT 0,
  audio_key        TEXT,
  audio_mime       TEXT,
  status           TEXT NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT', 'TRANSCRIBING', 'TRANSCRIBED', 'SUMMARIZED', 'FAILED')),
  transcript_json  TEXT,
  minutes_markdown TEXT,
  action_items_json TEXT,
  engine           TEXT,
  error            TEXT,
  created_by       TEXT NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL
);

-- P2+：AI 异步任务（转写 / 拆分 / 总结）
CREATE TABLE IF NOT EXISTS ai_jobs (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('ASR', 'SPLIT', 'SUMMARY')),
  status      TEXT NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED')),
  input_json  TEXT,
  output_json TEXT,
  error       TEXT,
  token_usage INTEGER,
  cost_cents  INTEGER,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS reminders (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  group_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  level      TEXT NOT NULL CHECK (level IN ('24H', '1H')),
  sent_at    TEXT NOT NULL,
  UNIQUE (task_id, level)
);
