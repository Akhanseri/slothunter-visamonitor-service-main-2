#!/bin/bash

# Скрипт для тестирования подключения к Visa API
# Проверяет доступность, заголовки, cookies и т.д.

set -e

BASE_URL="https://ais.usvisa-info.com"
EMAIL="${1:-test@example.com}"
PASSWORD="${2:-testpassword}"

echo "═══════════════════════════════════════════════════════════════"
echo "🔍 ТЕСТИРОВАНИЕ ПОДКЛЮЧЕНИЯ К VISA API"
echo "═══════════════════════════════════════════════════════════════"
echo ""

echo "1️⃣ Проверка доступности базового URL..."
curl -I -s --connect-timeout 10 --max-time 15 "${BASE_URL}" | head -10
echo ""

echo "2️⃣ Проверка главной страницы (GET /ru-kz/niv)..."
curl -v -s --connect-timeout 10 --max-time 15 \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8" \
  -H "Accept-Language: ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7" \
  -H "Cache-Control: max-age=0" \
  -H "Upgrade-Insecure-Requests: 1" \
  "${BASE_URL}/ru-kz/niv" 2>&1 | grep -E "HTTP|Set-Cookie|Location|Connection|refused|timeout" | head -20
echo ""

echo "3️⃣ Проверка страницы входа (GET /ru-kz/niv/users/sign_in)..."
COOKIE_JAR=$(mktemp)
curl -v -s --connect-timeout 10 --max-time 15 \
  -c "$COOKIE_JAR" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8" \
  -H "Accept-Language: ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7" \
  -H "Cache-Control: max-age=0" \
  -H "Upgrade-Insecure-Requests: 1" \
  "${BASE_URL}/ru-kz/niv/users/sign_in" 2>&1 | grep -E "HTTP|Set-Cookie|Location|Connection|refused|timeout|authenticity_token" | head -30
echo ""

echo "4️⃣ Проверка cookies после первого запроса..."
if [ -f "$COOKIE_JAR" ]; then
  echo "Cookies:"
  cat "$COOKIE_JAR"
  echo ""
fi

echo "5️⃣ Проверка DNS резолвинга..."
nslookup ais.usvisa-info.com 2>&1 | head -10
echo ""

echo "6️⃣ Проверка доступности порта 443..."
timeout 5 bash -c "echo > /dev/tcp/ais.usvisa-info.com/443" 2>&1 && echo "✅ Порт 443 доступен" || echo "❌ Порт 443 недоступен"
echo ""

echo "7️⃣ Проверка с использованием openssl (SSL handshake)..."
timeout 5 openssl s_client -connect ais.usvisa-info.com:443 -servername ais.usvisa-info.com < /dev/null 2>&1 | grep -E "CONNECTED|Verify return code|subject|issuer" | head -5
echo ""

echo "8️⃣ Проверка через wget..."
wget --spider --timeout=10 --tries=1 "${BASE_URL}/ru-kz/niv/users/sign_in" 2>&1 | grep -E "connected|refused|timeout|200|301|302" | head -5
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "✅ ТЕСТИРОВАНИЕ ЗАВЕРШЕНО"
echo "═══════════════════════════════════════════════════════════════"

# Очистка
rm -f "$COOKIE_JAR"

