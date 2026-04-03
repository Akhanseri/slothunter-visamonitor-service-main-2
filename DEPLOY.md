# Деплой приложения на Production

## Требования

- Node.js 20+ (установлен через nvm)
- PM2 (установлен глобально: `npm install -g pm2`)
- PostgreSQL 14+ (установлен на сервере)
- Файл `.env.production` с настройками

## Быстрый деплой

```bash
# На сервере в директории проекта
./deploy-pm2.sh
```

## Подробная инструкция

### 1. Подготовка

Убедитесь что:
- PostgreSQL запущен: `systemctl status postgresql`
- Файл `.env.production` существует и содержит все необходимые переменные
- Node.js установлен: `node --version`

### 2. Запуск деплоя

```bash
cd /root/visamonitor
./deploy-pm2.sh
```

Скрипт автоматически:
1. ✅ Проверит наличие `.env.production`
2. ✅ Проверит и запустит PostgreSQL
3. ✅ Установит зависимости для всех сервисов
4. ✅ Соберет все проекты (shared, api, parser)
5. ✅ Применит миграции БД
6. ✅ Остановит старые процессы PM2
7. ✅ Запустит новые процессы через PM2
8. ✅ Сохранит конфигурацию PM2
9. ✅ Проверит статус и логи

### 3. Проверка после деплоя

```bash
# Статус процессов
pm2 status

# Логи
pm2 logs

# Проверка API
curl http://localhost:8989/api/health

# Проверка Swagger
curl http://localhost:8989/api/docs
```

## Управление после деплоя

См. [PM2_COMMANDS.md](./PM2_COMMANDS.md) для всех команд управления.

### Основные команды

```bash
# Статус
pm2 status

# Логи
pm2 logs

# Перезапуск
pm2 restart all --update-env

# Остановка
pm2 stop all

# Мониторинг
pm2 monit
```

## Миграции

Миграции применяются автоматически при деплое. Для ручного применения:

```bash
npm run migration:run --prefix services/api
```

Для просмотра примененных миграций:

```bash
psql -h localhost -U postgres -d visa_monitor -c "SELECT * FROM migrations ORDER BY timestamp DESC;"
```

## Переменные окружения

Все переменные окружения загружаются из `.env.production` через `ecosystem.config.js`.

Основные переменные:
- `DB_HOST` - хост PostgreSQL (localhost)
- `DB_PORT` - порт PostgreSQL (5432)
- `DB_USERNAME` - пользователь БД (postgres)
- `DB_PASSWORD` - пароль БД
- `DB_DATABASE` - имя БД (visa_monitor)
- `TELEGRAM_BOT_TOKEN` - токен Telegram бота
- `TELEGRAM_CHAT_ID` - ID чата для уведомлений
- `NODE_ENV` - окружение (production)

## Структура процессов PM2

- **visa-monitor-api** - API сервер (порт 8989)
- **visa-monitor-parser-resident** - Парсер для резидентных клиентов
- **visa-monitor-parser-non-resident** - Парсер для нерезидентных клиентов

## Troubleshooting

### Приложения не запускаются

```bash
# Проверьте логи
pm2 logs

# Проверьте переменные окружения
pm2 env 0

# Проверьте подключение к БД
psql -h localhost -U postgres -d visa_monitor
```

### Ошибки миграций

```bash
# Проверьте подключение к БД
psql -h localhost -U postgres -d visa_monitor -c "SELECT 1;"

# Запустите миграции вручную
npm run migration:run --prefix services/api
```

### PostgreSQL не запускается

```bash
# Запустите PostgreSQL
systemctl start postgresql

# Проверьте статус
systemctl status postgresql
```

## Автозапуск при перезагрузке

PM2 автоматически настроен на автозапуск при перезагрузке системы через `pm2 startup`.

Для проверки:
```bash
pm2 startup
```

Для удаления автозапуска:
```bash
pm2 unstartup
```

