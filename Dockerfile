# Production image — Render ke alawa kisi bhi VPS / AWS / GCP / Railway pe chalega
FROM node:22-alpine
ENV NODE_ENV=production TZ=Asia/Kolkata PORT=3000
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
# SIGTERM pe chal rahi calls ko 25s tak khatam hone deta hai (server.js)
CMD ["node", "server.js"]
