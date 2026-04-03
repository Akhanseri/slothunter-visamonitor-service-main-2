#!/bin/bash
#
# Скрипт автоматической очистки системы (Docker, логи, кэш)
# Использование: ./cleanup-system.sh
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

log_step "🧹 Автоматическая очистка системы"

# Проверка использования диска до очистки
DISK_USAGE_BEFORE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
DISK_AVAIL_BEFORE=$(df -h / | awk 'NR==2 {print $4}')
log_info "Использование диска до очистки: ${DISK_USAGE_BEFORE}% (доступно: ${DISK_AVAIL_BEFORE})"

TOTAL_FREED=0

# 1. Очистка старых логов journald (старше 7 дней)
log_info "1️⃣  Очистка старых системных логов..."
JOURNAL_SIZE_BEFORE=$(journalctl --disk-usage 2>/dev/null | awk '{print $7}' || echo "0")
journalctl --vacuum-time=7d > /dev/null 2>&1 || true
JOURNAL_SIZE_AFTER=$(journalctl --disk-usage 2>/dev/null | awk '{print $7}' || echo "0")
log_info "   Journal logs: ${JOURNAL_SIZE_BEFORE} → ${JOURNAL_SIZE_AFTER}"

# 2. Очистка старых логов приложения (старше 30 дней)
log_info "2️⃣  Очистка старых логов приложения..."
if [ -d "/root/visamonitor/logs" ]; then
    LOGS_CLEANED=$(find /root/visamonitor/logs -type f -name "*.log" -mtime +30 -delete -print 2>/dev/null | wc -l)
    if [ $LOGS_CLEANED -gt 0 ]; then
        log_info "   Удалено старых логов: ${LOGS_CLEANED} файлов"
    else
        log_info "   Старых логов не найдено"
    fi
fi

# 3. Очистка временных файлов
log_info "3️⃣  Очистка временных файлов..."
TMP_CLEANED=$(find /tmp -type f -mtime +7 -delete -print 2>/dev/null | wc -l)
if [ $TMP_CLEANED -gt 0 ]; then
    log_info "   Удалено временных файлов: ${TMP_CLEANED}"
else
    log_info "   Временных файлов для удаления не найдено"
fi

# 4. Очистка кэша Puppeteer (старше 30 дней)
log_info "4️⃣  Очистка старого кэша Puppeteer..."
if [ -d "/root/.cache/puppeteer" ]; then
    PUPPETEER_SIZE_BEFORE=$(du -sh /root/.cache/puppeteer 2>/dev/null | awk '{print $1}' || echo "0")
    find /root/.cache/puppeteer -type d -mtime +30 -exec rm -rf {} + 2>/dev/null || true
    PUPPETEER_SIZE_AFTER=$(du -sh /root/.cache/puppeteer 2>/dev/null | awk '{print $1}' || echo "0")
    log_info "   Puppeteer cache: ${PUPPETEER_SIZE_BEFORE} → ${PUPPETEER_SIZE_AFTER}"
fi

# Проверка использования диска после очистки
DISK_USAGE_AFTER=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
DISK_AVAIL_AFTER=$(df -h / | awk 'NR==2 {print $4}')
DISK_FREED=$((DISK_USAGE_BEFORE - DISK_USAGE_AFTER))

log_info "Использование диска после очистки: ${DISK_USAGE_AFTER}% (доступно: ${DISK_AVAIL_AFTER})"

if [ $DISK_FREED -gt 0 ]; then
    log_info "✅ Освобождено: ${DISK_FREED}% дискового пространства"
else
    log_info "ℹ️  Дополнительное место не освобождено"
fi

# Предупреждение если диск все еще заполнен более чем на 80%
if [ $DISK_USAGE_AFTER -gt 80 ]; then
    log_warn "⚠️  Диск все еще заполнен более чем на 80% (${DISK_USAGE_AFTER}%)"
    log_warn "Рекомендуется проверить вручную: du -h --max-depth=1 /var | sort -hr"
fi

log_step "✅ Очистка завершена"

