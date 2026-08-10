FROM node:22-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN addgroup -S app && adduser -S -G app app \
    && mkdir -p /app/.data \
    && chown -R app:app /app

USER app

CMD ["node", "dist/index.js"]
