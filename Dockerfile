# 小组作业作战室 · 生产镜像
# 单进程：Fastify 同时提供 /api 与前端静态文件，SQLite + 上传文件落在 DATA_DIR
FROM node:24-alpine

WORKDIR /app

# 只用 package.json 先装依赖，利用镜像层缓存
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json

# --ignore-scripts：esbuild / tailwind 的原生二进制来自 optionalDependencies，
# 不依赖 postinstall；跳过它还能绕开新版 npm 的脚本审批限制
RUN npm ci --ignore-scripts

# 拷贝源码并构建前端（产物在 apps/web/dist，由 Fastify 托管）
COPY . .
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000 \
    DATA_DIR=/data \
    COOKIE_SECURE=true

# 挂载卷到这个目录，SQLite 与上传文件才能持久化
VOLUME ["/data"]

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
