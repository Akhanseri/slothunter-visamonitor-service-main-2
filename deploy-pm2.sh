#!/bin/bash
#
# Скрипт деплоя приложения на production с PM2
# Использование: ./deploy-pm2.sh
#

set -e

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функции логирования
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"
}

# Проверка что скрипт запущен из корня проекта
if [ ! -f "ecosystem.config.js" ]; then
    log_error "Скрипт должен быть запущен из корня проекта!"
    exit 1
fi

# Загрузка NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Проверка Node.js
if ! command -v node &> /dev/null; then
    log_error "Node.js не установлен! Установите через nvm: nvm install 20"
    exit 1
fi

log_step "🚀 Деплой Visa Monitor на Production (PM2)"

# Шаг 1: Проверка .env.production
log_step "1️⃣  Проверка .env.production"
if [ ! -f .env.production ]; then
    log_error ".env.production не найден!"
    log_info "Создайте файл .env.production на основе env.example"
    exit 1
fi
log_info "✅ .env.production найден"

# Шаг 2: Проверка PostgreSQL
log_step "2️⃣  Проверка PostgreSQL"
if ! systemctl is-active --quiet postgresql; then
    log_warn "PostgreSQL не запущен, запускаю..."
    systemctl start postgresql
    sleep 3
fi

if systemctl is-active --quiet postgresql; then
    log_info "✅ PostgreSQL запущен"
else
    log_error "Не удалось запустить PostgreSQL!"
    exit 1
fi

# Шаг 3: Установка зависимостей
log_step "3️⃣  Установка зависимостей"
log_info "Установка зависимостей для shared..."
npm install --prefix packages/shared

log_info "Установка зависимостей для api..."
npm install --prefix services/api

log_info "Установка зависимостей для parser..."
npm install --prefix services/parser

log_info "✅ Зависимости установлены"

# Шаг 4: Сборка проектов
log_step "4️⃣  Сборка проектов"
log_info "Сборка shared..."
npm run build --prefix packages/shared

log_info "Сборка api..."
npm run build --prefix services/api

log_info "Сборка parser..."
npm run build --prefix services/parser

log_info "✅ Проекты собраны"

# Шаг 5: Применение миграций
log_step "5️⃣  Применение миграций БД"
log_info "Запуск миграций..."

# Проверяем что миграции могут быть запущены
if npm run migration:run --prefix services/api 2>&1 | tee /tmp/migration.log; then
    log_info "✅ Миграции применены успешно"
else
    log_warn "⚠️  Возможны ошибки при применении миграций (проверьте /tmp/migration.log)"
    log_info "Продолжаю деплой..."
fi

# Шаг 6: Остановка старых процессов PM2
log_step "6️⃣  Остановка старых процессов PM2"
if pm2 list | grep -q "visa-monitor"; then
    log_info "Останавливаю старые процессы..."
    pm2 stop all 2>/dev/null || true
    pm2 delete all 2>/dev/null || true
    log_info "✅ Старые процессы остановлены"
else
    log_info "Нет запущенных процессов PM2"
fi

# Шаг 7: Запуск через PM2
log_step "7️⃣  Запуск приложения через PM2"
log_info "Запуск процессов из ecosystem.config.js..."
pm2 start ecosystem.config.js

log_info "Сохранение конфигурации PM2..."
pm2 save

log_info "✅ Приложение запущено через PM2"

# Шаг 8: Ожидание и проверка
log_step "8️⃣  Проверка статуса"
sleep 5

log_info "Статус процессов:"
pm2 status

log_info "\nОжидание запуска приложений (10 секунд)..."
sleep 10

# Проверка логов на ошибки
log_step "9️⃣  Проверка логов"
ERRORS=$(pm2 logs --lines 50 --nostream 2>&1 | grep -i "error\|exception" | grep -v "ERROR \[TypeOrmModule\]" | head -5 || true)

if [ -n "$ERRORS" ]; then
    log_warn "⚠️  Найдены ошибки в логах:"
    echo "$ERRORS"
else
    log_info "✅ Критических ошибок не найдено"
fi

# Финальная проверка
log_step "🔟 Финальная проверка"
log_info "Проверка подключения к БД..."

DB_PASSWORD=$(grep "^DB_PASSWORD=" .env.production | cut -d'=' -f2)
if PGPASSWORD="$DB_PASSWORD" psql -h localhost -U postgres -d visa_monitor -c "SELECT 1;" &>/dev/null; then
    log_info "✅ Подключение к БД работает"
else
    log_warn "⚠️  Не удалось подключиться к БД"
fi

# Итоговый статус
log_step "✅ Деплой завершен!"
echo ""
log_info "📊 Статус процессов:"
pm2 status
echo ""
log_info "📝 Полезные команды:"
echo "  pm2 status              - статус процессов"
echo "  pm2 logs                - логи всех процессов"
echo "  pm2 logs visa-monitor-api - логи API"
echo "  pm2 restart all         - перезапуск всех"
echo "  pm2 monit               - мониторинг"
echo ""
log_info "🌐 API доступен на: http://localhost:8989/api"
log_info "📚 Swagger: http://localhost:8989/api/docs"
echo ""

