#!/bin/bash

set -e

echo "🚀 Запуск приложения через PM2..."

# Проверяем что PM2 установлен
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 не установлен. Устанавливаю..."
    npm install -g pm2
fi

# Создаем директорию для логов
mkdir -p logs

# Проверяем что .env.production существует
if [ ! -f .env.production ]; then
    echo "❌ Файл .env.production не найден!"
    exit 1
fi

# Собираем все сервисы
echo "📦 Сборка сервисов..."
npm run build --prefix packages/shared
npm run build --prefix services/api
npm run build --prefix services/parser

# Останавливаем существующие процессы PM2
echo "🛑 Остановка существующих процессов..."
pm2 delete all 2>/dev/null || true

# Запускаем через PM2
echo "✅ Запуск через PM2..."
pm2 start ecosystem.config.js

# Сохраняем конфигурацию PM2
pm2 save

# Настраиваем автозапуск при перезагрузке системы
pm2 startup

echo ""
echo "✅ Приложение запущено через PM2!"
echo ""
echo "📊 Полезные команды:"
echo "  pm2 status              - статус процессов"
echo "  pm2 logs                - логи всех процессов"
echo "  pm2 logs api            - логи API"
echo "  pm2 logs parser-resident - логи parser-resident"
echo "  pm2 restart all         - перезапуск всех"
echo "  pm2 stop all            - остановка всех"
echo "  pm2 delete all          - удаление всех"

