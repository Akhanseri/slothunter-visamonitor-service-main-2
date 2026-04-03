# PM2 Команды для управления приложением

## Основные команды

### Статус и мониторинг

```bash
# Статус всех процессов
pm2 status

# Детальная информация о процессе
pm2 describe visa-monitor-api

# Мониторинг в реальном времени
pm2 monit

# Список всех процессов
pm2 list
```

### Логи

```bash
# Логи всех процессов
pm2 logs

# Логи конкретного процесса
pm2 logs visa-monitor-api
pm2 logs visa-monitor-parser-resident
pm2 logs visa-monitor-parser-non-resident

# Последние N строк логов
pm2 logs --lines 50

# Логи без tail (только последние строки)
pm2 logs --nostream --lines 20

# Очистка логов
pm2 flush
```

### Управление процессами

```bash
# Запуск всех процессов из ecosystem.config.js
pm2 start ecosystem.config.js

# Остановка всех процессов
pm2 stop all

# Остановка конкретного процесса
pm2 stop visa-monitor-api

# Перезапуск всех процессов
pm2 restart all

# Перезапуск конкретного процесса
pm2 restart visa-monitor-api

# Перезапуск с обновлением переменных окружения
pm2 restart all --update-env

# Удаление всех процессов
pm2 delete all

# Удаление конкретного процесса
pm2 delete visa-monitor-api

# Перезагрузка без простоя (zero-downtime)
pm2 reload all
```

### Переменные окружения

```bash
# Просмотр переменных окружения процесса
pm2 env 0

# Обновление переменных окружения
pm2 restart all --update-env
```

### Сохранение и автозапуск

```bash
# Сохранить текущую конфигурацию PM2
pm2 save

# Настроить автозапуск при перезагрузке системы
pm2 startup

# Удалить автозапуск
pm2 unstartup
```

### Информация и статистика

```bash
# Детальная информация о процессе
pm2 show visa-monitor-api

# Статистика использования ресурсов
pm2 info visa-monitor-api

# JSON вывод статуса
pm2 jlist
```

### Полезные команды

```bash
# Перезапуск всех процессов с очисткой логов
pm2 restart all && pm2 flush

# Просмотр логов с фильтрацией
pm2 logs | grep ERROR

# Просмотр только ошибок
pm2 logs --err

# Просмотр только stdout
pm2 logs --out

# Экспорт конфигурации
pm2 ecosystem
```

## Структура процессов

- **visa-monitor-api** - API сервер (порт 8989)
- **visa-monitor-parser-resident** - Парсер для резидентных клиентов
- **visa-monitor-parser-non-resident** - Парсер для нерезидентных клиентов

## Быстрые команды

```bash
# Проверка статуса
pm2 status

# Просмотр логов всех сервисов
pm2 logs --lines 30

# Перезапуск после изменений
pm2 restart all --update-env

# Остановка всех
pm2 stop all

# Запуск всех
pm2 start ecosystem.config.js
```

