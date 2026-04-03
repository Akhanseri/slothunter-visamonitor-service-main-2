#!/bin/bash

set -e

echo "🛑 Остановка приложения через PM2..."

pm2 stop all
pm2 delete all

echo "✅ Все процессы остановлены!"

