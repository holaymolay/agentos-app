FROM node:22-bookworm AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts vitest.config.ts ./
COPY src ./src
COPY web ./web
COPY test ./test
COPY .env.example ./
COPY README.md LICENSE ./

RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./src/db/migrations
COPY .env.example ./

RUN mkdir -p /app/data/artifacts

EXPOSE 3000

CMD ["npm", "run", "start:web"]
