FROM node:20-alpine AS builder

WORKDIR /app

# Копируем package.json и package-lock.json для установки зависимостей
COPY packages/shared/package.json packages/shared/package-lock.json ./packages/shared/
COPY services/api/package.json services/api/package-lock.json ./services/api/

# Устанавливаем зависимости для shared пакета
WORKDIR /app/packages/shared
RUN npm ci

# Копируем исходный код shared
COPY packages/shared/ ./

# Собираем shared пакет
RUN npm run build

# Возвращаемся в корень и копируем исходный код API (включая tsconfig.json и nest-cli.json)
WORKDIR /app
COPY services/api ./services/api

# Устанавливаем зависимости для API сервиса
WORKDIR /app/services/api
RUN npm ci --ignore-scripts

# Копируем собранный shared пакет в node_modules для правильного разрешения зависимостей
RUN rm -rf node_modules/@visa-monitor/shared 2>/dev/null || true && \
    mkdir -p node_modules/@visa-monitor/shared && \
    cp -r /app/packages/shared/dist node_modules/@visa-monitor/shared/ && \
    cp /app/packages/shared/package.json node_modules/@visa-monitor/shared/

# Собираем API сервис
RUN npx nest build && npm run postbuild

# Production образ
FROM node:20-alpine

WORKDIR /app

# Копируем package.json и package-lock.json для установки production зависимостей
COPY packages/shared/package.json packages/shared/package-lock.json ./packages/shared/
COPY services/api/package.json services/api/package-lock.json ./services/api/

# Копируем собранный shared пакет (dist) из builder stage
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/

# Устанавливаем production зависимости для shared
WORKDIR /app/packages/shared
RUN npm ci --omit=dev

# Устанавливаем production зависимости для API
WORKDIR /app/services/api
RUN npm ci --omit=dev --ignore-scripts

# Копируем собранный shared пакет в node_modules для правильного разрешения зависимостей
RUN rm -rf node_modules/@visa-monitor/shared 2>/dev/null || true && \
    mkdir -p node_modules/@visa-monitor/shared && \
    cp -r /app/packages/shared/dist node_modules/@visa-monitor/shared/ && \
    cp /app/packages/shared/package.json node_modules/@visa-monitor/shared/

# Копируем собранные файлы API из builder stage (включая миграции)
COPY --from=builder /app/services/api/dist ./dist
COPY --from=builder /app/services/api/package.json ./

WORKDIR /app/services/api

EXPOSE 8989

CMD ["node", "dist/main.js"]
