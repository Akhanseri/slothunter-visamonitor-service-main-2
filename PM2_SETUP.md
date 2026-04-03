# 🚀 Настройка PM2 для запуска приложения

## 📋 Требования

- Node.js 20+
- PostgreSQL (запущенный отдельно)
- PM2 (устанавливается автоматически скриптом)

## 🔧 Установка и запуск

### 1. Подготовка

```bash
# Убедитесь что .env.production настроен
cp env.example .env.production
# Отредактируйте .env.production с правильными значениями
```

### 2. Запуск через PM2

```bash
# Запуск всех сервисов
./pm2-start.sh
```

Скрипт автоматически:
- ✅ Проверит установлен ли PM2 (установит если нет)
- ✅ Соберет все сервисы (shared, api, parser)
- ✅ Запустит через PM2
- ✅ Настроит автозапуск при перезагрузке системы

### 3. Остановка

```bash
# Остановка всех сервисов
./pm2-stop.sh
```

## 📊 Управление процессами

### Основные команды PM2

```bash
# Статус всех процессов
pm2 status

# Логи всех процессов
pm2 logs

# Логи конкретного процесса
pm2 logs visa-monitor-api
pm2 logs visa-monitor-parser-resident
pm2 logs visa-monitor-parser-non-resident

# Перезапуск всех
pm2 restart all

# Перезапуск конкретного процесса
pm2 restart visa-monitor-api

# Остановка всех
pm2 stop all

# Удаление всех процессов
pm2 delete all

# Мониторинг в реальном времени
pm2 monit
```

## 📁 Структура процессов

PM2 запускает 3 процесса:

1. **visa-monitor-api** - API сервер (порт 8989)
2. **visa-monitor-parser-resident** - Парсер для резидентных клиентов
3. **visa-monitor-parser-non-resident** - Парсер для нерезидентных клиентов

## 📝 Логи

Логи сохраняются в директории `logs/`:

- `logs/api-error.log` - ошибки API
- `logs/api-out.log` - вывод API
- `logs/api-combined.log` - все логи API
- `logs/parser-resident-error.log` - ошибки parser-resident
- `logs/parser-resident-out.log` - вывод parser-resident
- `logs/parser-resident-combined.log` - все логи parser-resident
- `logs/parser-non-resident-error.log` - ошибки parser-non-resident
- `logs/parser-non-resident-out.log` - вывод parser-non-resident
- `logs/parser-non-resident-combined.log` - все логи parser-non-resident

## 🔄 Обновление кода

После изменений в коде:

```bash
# 1. Соберите изменения
npm run build --prefix packages/shared
npm run build --prefix services/api
npm run build --prefix services/parser

# 2. Перезапустите процессы
pm2 restart all

# Или перезапустите конкретный процесс
pm2 restart visa-monitor-api
```

## ⚙️ Конфигурация

Конфигурация PM2 находится в `ecosystem.config.js`.

Основные параметры:
- `instances: 1` - один экземпляр каждого процесса
- `exec_mode: "fork"` - режим fork (не cluster)
- `autorestart: true` - автоматический перезапуск при падении
- `max_restarts: 10` - максимум 10 перезапусков
- `min_uptime: "10s"` - минимум 10 секунд работы
- `max_memory_restart: "500M"` - перезапуск при превышении 500MB памяти

## 🐛 Отладка

### Просмотр логов в реальном времени

```bash
# Все логи
pm2 logs

# Конкретный процесс
pm2 logs visa-monitor-api --lines 100

# Только ошибки
pm2 logs --err
```

### Проверка статуса

```bash
pm2 status
pm2 info visa-monitor-api
```

### Мониторинг ресурсов

```bash
pm2 monit
```

## 🔐 Автозапуск при перезагрузке

PM2 автоматически настроит автозапуск при перезагрузке системы при первом запуске `pm2-start.sh`.

Если нужно настроить вручную:

```bash
pm2 startup
# Выполните команду, которую покажет PM2
pm2 save
```

## 📦 Отличия от Docker

### Преимущества PM2:
- ✅ Проще отладка (прямой доступ к процессам)
- ✅ Меньше overhead (нет контейнеризации)
- ✅ Проще логирование
- ✅ Быстрее перезапуск

### Недостатки PM2:
- ❌ Нет изоляции процессов
- ❌ Нужно управлять зависимостями вручную
- ❌ PostgreSQL должен быть запущен отдельно

## 🚨 Важные замечания

1. **PostgreSQL должен быть запущен** перед запуском приложения
2. **Миграции** нужно запустить вручную перед первым запуском:
   ```bash
   npm run migration:run --prefix services/api
   ```
3. **.env.production** должен быть настроен правильно
4. **Порты** должны быть свободны (8989 для API, 8991 для parser)

## 🔄 Миграция с Docker на PM2

Если вы переходите с Docker:

1. Остановите Docker контейнеры:
   ```bash
   docker-compose down
   ```

2. Убедитесь что PostgreSQL запущен (или запустите отдельно)

3. Запустите через PM2:
   ```bash
   ./pm2-start.sh
   ```

4. Проверьте логи:
   ```bash
   pm2 logs
   ```

