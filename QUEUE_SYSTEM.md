# 🔄 Система очередей клиентов - Round-Robin

## 📋 Что реализовано

Добавлена профессиональная система очередей для справедливого распределения парсинга между клиентами.

### Ключевые особенности:

✅ **Автоматическое присвоение queueIndex** при создании клиента  
✅ **Round-Robin алгоритм** - каждый клиент обрабатывается по очереди  
✅ **Отдельные очереди** для resident и non-resident клиентов  
✅ **Автоматический wrap-around** - после последнего клиента возврат к первому  
✅ **Статистика обработки** - lastProcessedAt для мониторинга  
✅ **Управление приоритетами** - можно менять queueIndex вручную  
✅ **Reindex endpoint** - пересчет индексов при необходимости  

---

## 🏗️ Архитектура

### Новые поля в Client entity:

```typescript
{
  queueIndex: number;        // Позиция в очереди (1, 2, 3...)
  lastProcessedAt: Date;     // Когда клиент обрабатывался последний раз
}
```

### Логика работы:

```
Resident клиенты:     Non-Resident клиенты:
queueIndex: 1         queueIndex: 1
queueIndex: 2         queueIndex: 2
queueIndex: 3         queueIndex: 3
     ↓                     ↓
currentIndex (in memory)  currentIndex (in memory)
```

---

## 🔄 Как работает Round-Robin

### При создании клиента:

```typescript
// Автоматически в ClientsService.create()
1. Находим MAX(queueIndex) для resident/non-resident
2. Присваиваем новому клиенту: max + 1
3. Сохраняем в БД

Пример:
  Есть resident клиенты: queueIndex = 1, 2, 3
  Создаем нового → queueIndex = 4
```

### При парсинге:

```typescript
// ClientQueueManager.getNextClient()
1. currentIndex для resident = 2 (например)
2. SELECT * WHERE isResident=true AND queueIndex >= 2 ORDER BY queueIndex LIMIT 1
3. Находим клиента с queueIndex = 2
4. Обрабатываем его
5. currentIndex = 3 (для следующего раза)
6. Обновляем lastProcessedAt = NOW()

Когда достигаем конца:
7. Нет клиентов с queueIndex >= 4
8. Сбрасываем currentIndex = 0
9. Начинаем сначала (клиент с queueIndex = 1)
```

---

## 📊 Пример работы очереди

### Scenario: 3 resident клиента

```
Клиенты в БД:
  ID=1, email=user1@mail.com, queueIndex=1
  ID=2, email=user2@mail.com, queueIndex=2
  ID=3, email=user3@mail.com, queueIndex=3

Parser запускается:
  Цикл 1: currentIndex=0 → Выбирает user1 (queueIndex=1) → currentIndex=2
  Цикл 2: currentIndex=2 → Выбирает user2 (queueIndex=2) → currentIndex=3
  Цикл 3: currentIndex=3 → Выбирает user3 (queueIndex=3) → currentIndex=4
  Цикл 4: currentIndex=4 → Нет клиентов → Сброс → currentIndex=0
  Цикл 5: currentIndex=0 → Выбирает user1 (queueIndex=1) → currentIndex=2
  ... (продолжается по кругу)
```

**Результат:** Каждый клиент получает равное время парсинга! ✅

---

## 🎯 API Endpoints

### Создание клиента (queueIndex присваивается автоматически)

```http
POST /api/clients
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "isResident": true
}

Response:
{
  "id": 1,
  "email": "user@example.com",
  "queueIndex": 1,          ← Автоматически присвоен!
  "lastProcessedAt": null,
  "isResident": true,
  "isActive": true
}
```

### Пересчет индексов очереди

```http
POST /api/clients/reindex?type=all

Response:
{
  "residentCount": 5,
  "nonResidentCount": 3
}
```

**Параметры type:**
- `resident` - только резиденты
- `non-resident` - только нерезиденты  
- `all` - все (по умолчанию)

**Когда использовать:**
- После удаления клиентов (чтобы убрать пробелы в индексах)
- Для reset приоритетов
- При ручном изменении queueIndex

---

## 🛠️ Управление приоритетами

### Изменить позицию клиента в очереди:

```http
PATCH /api/clients/:id
Content-Type: application/json

{
  "queueIndex": 1  ← Переместить в начало очереди
}
```

**Примеры:**
- `queueIndex: 1` - первым в очереди (VIP)
- `queueIndex: 999` - последним в очереди (низкий приоритет)

---

## 📊 Мониторинг очереди

### ClientQueueManager.getQueueStats()

```typescript
{
  totalClients: 10,           // Всего клиентов
  activeClients: 8,           // Активных
  currentIndex: 5,            // Текущая позиция
  oldestProcessed: "2025-11-18T20:00:00Z",  // Самый давно обработанный
  newestProcessed: "2025-11-18T22:00:00Z"   // Последний обработанный
}
```

**Можно использовать для:**
- Проверки что все клиенты обрабатываются
- Вычисления среднего времени между обработками
- Мониторинга "застрявших" клиентов

---

## 🔧 Внутренняя реализация

### ClientQueueManager (services/parser/src/scheduler/)

```typescript
class ClientQueueManager {
  // Хранит текущий индекс отдельно для каждого типа
  private currentQueueIndex = {
    resident: 0,
    "non-resident": 0
  };

  async getNextClient(type): Client {
    // 1. Ищем клиента с queueIndex >= currentIndex
    // 2. Если не найден - сброс на 0
    // 3. Обновляем currentIndex = client.queueIndex + 1
    // 4. Обновляем lastProcessedAt
    return client;
  }
}
```

---

## 💡 Лучшие практики

### 1. Добавление новых клиентов

✅ **Правильно:**
```typescript
// queueIndex присваивается автоматически
POST /api/clients { email, password, isResident }
```

❌ **Не нужно:**
```typescript
// НЕ указывай queueIndex вручную при создании
{ queueIndex: 5 }  // автоматически присвоится
```

### 2. Удаление клиентов

После удаления могут появиться пробелы:
```
До удаления:  1, 2, 3, 4, 5
После:        1, 2, _, 4, 5  (удалили queueIndex=3)
```

**Решение:** Запусти reindex
```http
POST /api/clients/reindex?type=resident
```

Станет: `1, 2, 3, 4`

### 3. VIP клиенты

```http
PATCH /api/clients/123
{ "queueIndex": 1 }  ← Перемещаем в начало
```

Parser обработает его раньше других!

---

## 🧪 Тестирование

### Создай несколько клиентов:

```bash
# Resident клиент 1
curl -X POST http://89.207.255.163:8989/api/clients \
  -H "Content-Type: application/json" \
  -d '{"email":"resident1@test.com","password":"pass","isResident":true}'

# Resident клиент 2  
curl -X POST http://89.207.255.163:8989/api/clients \
  -H "Content-Type: application/json" \
  -d '{"email":"resident2@test.com","password":"pass","isResident":true}'

# Non-Resident клиент 1
curl -X POST http://89.207.255.163:8989/api/clients \
  -H "Content-Type: application/json" \
  -d '{"email":"nonres1@test.com","password":"pass","isResident":false}'
```

### Проверь автоматическое присвоение queueIndex:

```bash
curl http://89.207.255.163:8989/api/clients | jq '.clients[] | {email, queueIndex, isResident}'
```

Должно быть:
```json
{
  "email": "resident1@test.com",
  "queueIndex": 1,
  "isResident": true
}
{
  "email": "resident2@test.com",
  "queueIndex": 2,
  "isResident": true
}
{
  "email": "nonres1@test.com",
  "queueIndex": 1,
  "isResident": false
}
```

### Проверь логи parser:

```bash
ssh root@89.207.255.163 "cd /root/visamonitor && docker-compose logs -f parser-resident"
```

Должен чередовать клиентов:
```
✅ Выбран клиент: resident1@test.com (queueIndex: 1)
... 300 iterations ...
✅ Выбран клиент: resident2@test.com (queueIndex: 2)
... 300 iterations ...
🔄 Достигнут конец очереди, сброс currentIndex на 0
✅ Выбран клиент: resident1@test.com (queueIndex: 1)
```

---

## 🎯 Преимущества системы

✅ **Справедливость**: Каждый клиент получает равное время  
✅ **Предсказуемость**: Можно вычислить когда клиент будет обработан  
✅ **Гибкость**: Можно менять приоритеты через queueIndex  
✅ **Масштабируемость**: Работает с любым количеством клиентов  
✅ **Простота**: Никаких внешних зависимостей (Redis не нужен)  
✅ **Мониторинг**: lastProcessedAt для статистики  

---

## 📈 Формулы

### Время между обработками клиента:

```
T = (количество_клиентов - 1) × время_одного_цикла

Пример:
  5 resident клиентов
  1 цикл = 300 итераций × 3 сек = 15 минут
  
  Клиент обрабатывается каждые: 4 × 15 = 60 минут
```

### Порядок обработки:

```
currentIndex = 0:
  Client(queueIndex=1) → Client(queueIndex=2) → ... → wrap to 0
```

---

## 🔍 Troubleshooting

### Проблема: Клиент не обрабатывается

**Причины:**
1. `isActive = false` - клиент неактивен
2. Нет активных групп виз
3. queueIndex = null (не присвоен)

**Решение:**
```http
# Проверь клиента
GET /api/clients/:id

# Переиндексируй
POST /api/clients/reindex

# Активируй клиента
PATCH /api/clients/:id { "isActive": true }
```

### Проблема: Один клиент обрабатывается чаще других

**Причина:** Некорректные queueIndex (дубликаты или пробелы)

**Решение:**
```http
POST /api/clients/reindex?type=all
```

---

## ✅ Итого

Система очередей полностью реализована и готова к использованию!

**Файлы:**
- `packages/shared/src/entities/client.entity.ts` - добавлены поля
- `packages/shared/src/migrations/1732000000000-AddQueueIndexToClients.ts` - миграция
- `services/api/src/clients/clients.service.ts` - auto-assign queueIndex
- `services/parser/src/scheduler/client-queue.manager.ts` - менеджер очереди
- `services/parser/src/scheduler/visa-scheduler.processor.ts` - использует очередь

**Endpoints:**
- `POST /api/clients` - автоматически присваивает queueIndex
- `PATCH /api/clients/:id` - изменить queueIndex для приоритета
- `POST /api/clients/reindex` - пересчитать все индексы

**Следующий шаг:** Деплой!
```bash
./deploy-local.sh
```

