# 🚀 START - Всё что тебе нужно знать

## ✅ Твое приложение УЖЕ РАБОТАЕТ!

```
🌐 API: http://89.207.255.163:8989/api/docs
🩺 Health: http://89.207.255.163:8989/api/health
```

---

## ⚡ Деплой изменений (одна команда)

```bash
./deploy-local.sh
```

**Готово!** Через 7 минут новая версия на production! 🎉

---

## 🔑 Важные данные

### PostgreSQL пароль

```
visa_monitor_strong_password_2025
```

### SSH подключение

```bash
ssh -i gitlab_deploy_key root@89.207.255.163
```

---

## 📚 Документация

- **`QUICK_DEPLOY.md`** ⭐ - Начни отсюда!
- **`DEPLOY_MANUAL.md`** - Полное руководство
- **`DEPLOYMENT_COMPLETE.md`** - Что было сделано

---

## 🛠️ Быстрые команды

```bash
# Деплой
./deploy-local.sh

# Статус на сервере
ssh -i gitlab_deploy_key root@89.207.255.163 "cd /root/visamonitor && docker-compose ps"

# Логи
ssh -i gitlab_deploy_key root@89.207.255.163 "cd /root/visamonitor && docker-compose logs -f api"

# Перезапуск
ssh -i gitlab_deploy_key root@89.207.255.163 "cd /root/visamonitor && docker-compose restart"
```

---

**Всё работает! Документация готова! Скрипты настроены!** 🚀

