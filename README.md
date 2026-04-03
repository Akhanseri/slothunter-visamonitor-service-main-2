# Visa Monitor Backend

Мониторинг системы для отслеживания доступных слотов на визу в США.

## 🚀 Quick Start

### Production деплой

**Приложение запущено на production через PM2!**

- ✅ **API**: http://89.207.255.163:8989/api/docs
- ✅ **Health**: http://89.207.255.163:8989/api/health

**Деплой новых изменений:**

```bash
# На сервере
cd /root/visamonitor
./deploy-pm2.sh
```

**Подробная инструкция**: [DEPLOY.md](./DEPLOY.md)

---

## 📚 Документация

- [DEPLOY.md](./DEPLOY.md) - Инструкция по деплою
- [PM2_COMMANDS.md](./PM2_COMMANDS.md) - Команды для управления PM2
- [PM2_SETUP.md](./PM2_SETUP.md) - Настройка PM2
- [QUEUE_SYSTEM.md](./QUEUE_SYSTEM.md) - Система очередей клиентов
- [MATCHING_FLOW.md](./MATCHING_FLOW.md) - Логика matching слотов
- [MATCHING_LOGIC_ANALYSIS.md](./MATCHING_LOGIC_ANALYSIS.md) - Анализ логики matching

---

## 🏗️ Архитектура

### Сервисы

1. **API** (`services/api`) - REST API сервер
   - Порт: 8989
   - Swagger: `/api/docs`
   - Health: `/api/health`

2. **Parser Resident** (`services/parser`) - Парсер для резидентных клиентов
   - Обрабатывает резидентных клиентов
   - Round-Robin очередь

3. **Parser Non-Resident** (`services/parser`) - Парсер для нерезидентных клиентов
   - Обрабатывает нерезидентных клиентов
   - Round-Robin очередь

### База данных

- **PostgreSQL 14+** на сервере
- База: `visa_monitor`
- Миграции: TypeORM

### Управление процессами

- **PM2** - менеджер процессов Node.js
- Автозапуск при перезагрузке системы
- Логирование в `logs/`

---

## 🛠️ Локальная разработка

### Требования

- Node.js 20+
- PostgreSQL 14+
- npm

### Установка

```bash
# 1. Установите зависимости
npm install --prefix packages/shared
npm install --prefix services/api
npm install --prefix services/parser

# 2. Соберите shared пакет
npm run build --prefix packages/shared

# 3. Создайте .env.local файл
cp env.example .env.local
# Отредактируйте .env.local с вашими настройками

# 4. Запустите PostgreSQL локально
# Или используйте Docker:
docker run -d --name postgres -e POSTGRES_PASSWORD=password -p 5432:5432 postgres:14

# 5. Примените миграции
npm run migration:run --prefix services/api

# 6. Запустите сервисы
npm run start:dev --prefix services/api
npm run start:dev --prefix services/parser
```

---

## 📦 Структура проекта

```
.
├── packages/
│   └── shared/          # Общий пакет (entities, services, migrations)
├── services/
│   ├── api/             # API сервер
│   └── parser/          # Парсер слотов
├── deploy-pm2.sh        # Скрипт деплоя на production
├── ecosystem.config.js  # Конфигурация PM2
├── env.example          # Пример переменных окружения
└── README.md
```

---

## 🔧 Основные команды

### PM2 (Production)

```bash
# Статус
pm2 status

# Логи
pm2 logs

# Перезапуск
pm2 restart all --update-env

# Остановка
pm2 stop all
```

См. [PM2_COMMANDS.md](./PM2_COMMANDS.md) для полного списка команд.

### Миграции

```bash
# Применить миграции
npm run migration:run --prefix services/api

# Откатить последнюю миграцию
npm run migration:revert --prefix services/api

# Создать новую миграцию
npm run migration:generate --prefix services/api -- src/migrations/MigrationName -d src/data-source.ts
```

---

## 🔐 Переменные окружения

Основные переменные (см. `env.example`):

- `DB_HOST` - хост PostgreSQL
- `DB_PORT` - порт PostgreSQL
- `DB_USERNAME` - пользователь БД
- `DB_PASSWORD` - пароль БД
- `DB_DATABASE` - имя БД
- `TELEGRAM_BOT_TOKEN` - токен Telegram бота
- `TELEGRAM_CHAT_ID` - ID чата для уведомлений
- `NODE_ENV` - окружение (production/development)

---

## 📊 Мониторинг

### Health Check

```bash
curl http://localhost:8989/api/health
```

### Логи

```bash
# Все логи
pm2 logs

# Логи API
pm2 logs visa-monitor-api

# Логи парсера
pm2 logs visa-monitor-parser-resident
```

### База данных

```bash
# Подключение
psql -h localhost -U postgres -d visa_monitor

# Статистика
psql -h localhost -U postgres -d visa_monitor -c "SELECT COUNT(*) FROM clients;"
```

---

## 🐛 Troubleshooting

### Приложения не запускаются

1. Проверьте логи: `pm2 logs`
2. Проверьте переменные окружения: `pm2 env 0`
3. Проверьте подключение к БД: `psql -h localhost -U postgres -d visa_monitor`

### Ошибки миграций

1. Проверьте подключение к БД
2. Запустите миграции вручную: `npm run migration:run --prefix services/api`

### PostgreSQL не запускается

```bash
systemctl start postgresql
systemctl status postgresql
```

---

## 📝 Лицензия

Private
