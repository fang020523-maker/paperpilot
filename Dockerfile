# PaperPilot 生产部署镜像（Node 长驻进程，保证知识库内存索引与 .data 持久化）
# 注意：onnxruntime-node 需要 glibc，故用 debian-slim 而非 alpine
FROM node:22-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
# 首次可挂载卷保存 .data/；或启动后执行 npm run seed:demo 导入演示语料
CMD ["npm", "start"]
