FROM node:20-alpine AS builder

WORKDIR /app

# Копируем package.json и package-lock.json для установки зависимостей
COPY packages/shared/package.json packages/shared/package-lock.json ./packages/shared/
COPY services/parser/package.json services/parser/package-lock.json ./services/parser/

# Устанавливаем зависимости для shared пакета
WORKDIR /app/packages/shared
RUN npm ci

# Копируем исходный код shared
COPY packages/shared/ ./

# Собираем shared пакет
RUN npm run build

# Возвращаемся в корень и копируем исходный код parser (включая tsconfig.json и nest-cli.json)
WORKDIR /app
COPY services/parser ./services/parser

# Устанавливаем зависимости для parser сервиса
WORKDIR /app/services/parser
RUN npm ci --ignore-scripts

# Копируем собранный shared пакет в node_modules для правильного разрешения зависимостей
RUN rm -rf node_modules/@visa-monitor/shared 2>/dev/null || true && \
    mkdir -p node_modules/@visa-monitor/shared && \
    cp -r /app/packages/shared/dist node_modules/@visa-monitor/shared/ && \
    cp /app/packages/shared/package.json node_modules/@visa-monitor/shared/

# Собираем parser сервис
RUN npx nest build && npm run postbuild

# Production образ
FROM node:20-alpine

WORKDIR /app

# Копируем package.json и package-lock.json для установки production зависимостей
COPY packages/shared/package.json packages/shared/package-lock.json ./packages/shared/
COPY services/parser/package.json services/parser/package-lock.json ./services/parser/

# Копируем собранный shared пакет (dist) из builder stage
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/

# Устанавливаем production зависимости для shared
WORKDIR /app/packages/shared
RUN npm ci --omit=dev

# Устанавливаем production зависимости для parser
WORKDIR /app/services/parser
RUN npm ci --omit=dev --ignore-scripts

# Копируем собранный shared пакет в node_modules для правильного разрешения зависимостей
RUN rm -rf node_modules/@visa-monitor/shared 2>/dev/null || true && \
    mkdir -p node_modules/@visa-monitor/shared && \
    cp -r /app/packages/shared/dist node_modules/@visa-monitor/shared/ && \
    cp /app/packages/shared/package.json node_modules/@visa-monitor/shared/

# Копируем собранные файлы parser из builder stage
COPY --from=builder /app/services/parser/dist ./dist
COPY --from=builder /app/services/parser/package.json ./

WORKDIR /app/services/parser

EXPOSE 8991

CMD ["node", "dist/main.js"]
