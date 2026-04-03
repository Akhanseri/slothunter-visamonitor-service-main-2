#!/bin/bash

# Детальное тестирование подключения к Visa API
# Проверяет все возможные варианты заголовков и cookies

set -e

BASE_URL="https://ais.usvisa-info.com"
COOKIE_JAR=$(mktemp)

echo "═══════════════════════════════════════════════════════════════"
echo "🔍 ДЕТАЛЬНОЕ ТЕСТИРОВАНИЕ VISA API"
echo "═══════════════════════════════════════════════════════════════"
echo ""

cleanup() {
    rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

echo "1️⃣ Запрос к главной странице /ru-kz/niv (как браузер)..."
curl -v -s --connect-timeout 10 --max-time 15 \
  -c "$COOKIE_JAR" \
  -L \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8" \
  -H "Accept-Language: ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7" \
  -H "Accept-Encoding: gzip, deflate, br" \
  -H "DNT: 1" \
  -H "Connection: keep-alive" \
  -H "Upgrade-Insecure-Requests: 1" \
  -H "Sec-Fetch-Dest: document" \
  -H "Sec-Fetch-Mode: navigate" \
  -H "Sec-Fetch-Site: none" \
  -H "Sec-Fetch-User: ?1" \
  -H "Cache-Control: max-age=0" \
  "${BASE_URL}/ru-kz/niv" 2>&1 | grep -E "HTTP|Set-Cookie|Location|Connection|refused|timeout|200|301|302|authenticity_token" | head -30
echo ""

echo "2️⃣ Проверка cookies после первого запроса..."
if [ -f "$COOKIE_JAR" ] && [ -s "$COOKIE_JAR" ]; then
  echo "✅ Cookies получены:"
  cat "$COOKIE_JAR" | grep -v "^#" | grep -v "^$"
else
  echo "❌ Cookies не получены"
fi
echo ""

echo "3️⃣ Запрос к странице входа с cookies..."
curl -v -s --connect-timeout 10 --max-time 15 \
  -b "$COOKIE_JAR" \
  -c "$COOKIE_JAR" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8" \
  -H "Accept-Language: ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7" \
  -H "Accept-Encoding: gzip, deflate, br" \
  -H "Referer: ${BASE_URL}/ru-kz/niv" \
  -H "DNT: 1" \
  -H "Connection: keep-alive" \
  -H "Upgrade-Insecure-Requests: 1" \
  -H "Sec-Fetch-Dest: document" \
  -H "Sec-Fetch-Mode: navigate" \
  -H "Sec-Fetch-Site: same-origin" \
  -H "Sec-Fetch-User: ?1" \
  -H "Cache-Control: max-age=0" \
  "${BASE_URL}/ru-kz/niv/users/sign_in" 2>&1 | grep -E "HTTP|Set-Cookie|Location|Connection|refused|timeout|200|301|302|authenticity_token" | head -30
echo ""

echo "4️⃣ Проверка через telnet (прямое подключение к порту 443)..."
timeout 5 bash -c "echo 'GET / HTTP/1.1\r\nHost: ais.usvisa-info.com\r\n\r\n' | openssl s_client -connect ais.usvisa-info.com:443 -servername ais.usvisa-info.com -quiet 2>&1 | head -10" || echo "❌ Не удалось подключиться"
echo ""

echo "5️⃣ Проверка через traceroute..."
traceroute -n -m 5 ais.usvisa-info.com 2>&1 | head -10 || echo "traceroute недоступен"
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo "✅ ТЕСТИРОВАНИЕ ЗАВЕРШЕНО"
echo "═══════════════════════════════════════════════════════════════"

