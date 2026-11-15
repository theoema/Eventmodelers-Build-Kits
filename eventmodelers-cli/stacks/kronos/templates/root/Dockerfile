# The app as it runs in production: `src/main.ts` on Bun, with the dependencies it runs with and its migrations
# (applied at boot). It needs what `src/env.ts` requires: DATABASE_URL and KRONOSDB_HOST, at least.
#   docker build -t app .
#   docker run -p 3000:3000 -e DATABASE_URL=… -e KRONOSDB_HOST=… app
FROM oven/bun:1.4.4-slim AS dependencies
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.4-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules node_modules
COPY . .
USER bun
EXPOSE 3000
CMD ["bun", "src/main.ts"]
