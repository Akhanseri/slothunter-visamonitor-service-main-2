import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BaseTelegramNotifierService,
  TelegramNotifierConfig,
  VisaGroupNotification,
  TelegramRateLimitError,
} from "@visa-monitor/shared";

export { VisaGroupNotification, TelegramRateLimitError };

@Injectable()
export class TelegramNotifierService extends BaseTelegramNotifierService {
  private readonly logger = new Logger(TelegramNotifierService.name);

  constructor(private readonly configService: ConfigService) {
    const parseTopicId = (value: string | undefined): number | null => {
      if (!value) return null;
      const parsed = parseInt(value.trim(), 10);
      return isNaN(parsed) || parsed <= 0 ? null : parsed;
    };

    const logger = new Logger(TelegramNotifierService.name);
    const config: TelegramNotifierConfig = {
      botToken: configService.get<string>("TELEGRAM_BOT_TOKEN") || null,
      chatId: configService.get<string>("TELEGRAM_CHAT_ID") || null,
      topicParser: parseTopicId(
        configService.get<string>("TELEGRAM_TOPIC_PARSER")
      ),
      topicErrors: parseTopicId(
        configService.get<string>("TELEGRAM_TOPIC_ERRORS")
      ),
      topicSlots: parseTopicId(
        configService.get<string>("TELEGRAM_TOPIC_SLOTS")
      ),
      topicBookings: parseTopicId(
        configService.get<string>("TELEGRAM_TOPIC_BOOKINGS")
      ),
      logger: {
        log: (message: string) => logger.log(message),
        warn: (message: string) => logger.warn(message),
        error: (message: string) => logger.error(message),
      },
    };

    super(config);
  }

  async notifyParserStart(context?: {
    residentEmail?: string;
    noResidentEmail?: string;
  }): Promise<void> {
    if (!this.config.botToken || !this.config.chatId) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Almaty",
    });
    const dateStr = now.toLocaleDateString("ru-RU", {
      timeZone: "Asia/Almaty",
    });

    let accountsInfo = "";
    if (context?.residentEmail || context?.noResidentEmail) {
      accountsInfo = "\n━━━━━━━━━━━━━━━━━━━━\n\n<b>📧 АККАУНТЫ</b>\n\n";
      if (context.residentEmail) {
        accountsInfo += `👤 Резидент: <code>${context.residentEmail}</code>\n`;
      }
      if (context.noResidentEmail) {
        accountsInfo += `🌍 Не-резидент: <code>${context.noResidentEmail}</code>\n`;
      }
    }

    const message =
      `🚀 <b>ПАРСИНГ ЗАПУЩЕН</b>\n\n` +
      `📅 ${dateStr} 🕐 ${timeStr}${accountsInfo}\n\n` +
      `🔄 Начинаем проверку слотов...`;

    await this.sendMessage(message, this.config.topicParser);
  }

  async notifyParserComplete(stats: {
    residentEmail?: string;
    noResidentEmail?: string;
    duration: number;
  }): Promise<void> {
    if (!this.config.botToken || !this.config.chatId) return;

    const timeStr = new Date().toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Almaty",
    });

    const message =
      `✅ <b>ПАРСИНГ ЗАВЕРШЁН</b>\n\n` +
      `🕐 ${timeStr}\n` +
      `⏱ ${(stats.duration / 1000).toFixed(1)}с`;

    await this.sendMessage(message, this.config.topicParser);
  }

  async notifyManagersAboutMatchesForVisaGroups(
    notifications: VisaGroupNotification[],
    context?: {
      slots?: Array<{ date: string; time: string; city: string }>;
      isResident?: boolean;
      parserEmail?: string;
      requestCount?: number;
      estimatedTotalRequests?: number;
      locationsCount?: number;
      iterationDuration?: number;
      iterationNumber?: number;
      totalIterations?: number;
    }
  ): Promise<boolean> {
    if (!this.config.botToken || !this.config.chatId) {
      return false;
    }

    const slots = context?.slots || [];
    const isResident = context?.isResident ?? false;
    const parserEmail = context?.parserEmail || "unknown";
    const typeLabel = isResident ? "РЕЗИДЕНТЫ" : "НЕ-РЕЗИДЕНТЫ";
    const typeEmoji = isResident ? "👤" : "🌍";

    const now = new Date();
    const timeStr = now.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Almaty",
    });
    const dateStr = now.toLocaleDateString("ru-RU", {
      timeZone: "Asia/Almaty",
    });

    const hasSlots = slots.length > 0;
    const hasMatches = notifications.length > 0;
    const iterationNumber = context?.iterationNumber;
    const totalIterations = context?.totalIterations;
    const iterationDuration = context?.iterationDuration;

    let iterationInfo = "";
    if (typeof iterationNumber === "number" && iterationNumber > 0) {
      const iterationLabel =
        typeof totalIterations === "number" && totalIterations > 0
          ? `${iterationNumber}/${totalIterations}`
          : `${iterationNumber}`;
      iterationInfo = `\n🔄 Итерация: <b>${iterationLabel}</b>`;
      if (typeof iterationDuration === "number" && iterationDuration > 0) {
        const durationSec = (iterationDuration / 1000).toFixed(1);
        iterationInfo += ` ⏱ <b>${durationSec}с</b>`;
      }
    }

    let message =
      `${hasMatches ? "🎯" : hasSlots ? "📊" : "❌"} <b>${hasMatches ? "НАЙДЕНЫ СЛОТЫ" : hasSlots ? "РЕЗУЛЬТАТЫ ПАРСИНГА" : "СЛОТОВ НЕ НАЙДЕНО"} (${typeLabel})</b>\n\n` +
      `📧 Парсер: <code>${parserEmail}</code>\n` +
      `${typeEmoji} Тип: <b>${typeLabel}</b>${iterationInfo}\n` +
      `📅 ${dateStr} 🕐 ${timeStr}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `<b>📊 СТАТИСТИКА</b>\n\n` +
      `Слотов: <b>${slots.length}</b>\n` +
      `Совпадений: <b>${notifications.length}</b>\n`;

    if (!hasSlots && !hasMatches) {
      const locationsCount = context?.locationsCount || 2;
      const iterations = this._calculateIterations(
        context?.requestCount || 0,
        locationsCount
      );
      message +=
        `\n━━━━━━━━━━━━━━━━━━━━\n\n` +
        `❌ <b>СЛОТОВ НЕ НАЙДЕНО</b>\n\n` +
        `После проверки всех локаций доступные слоты не обнаружены.\n\n` +
        `📊 <b>Детали проверки:</b>\n` +
        `   • Запросов выполнено: ${context?.requestCount || 0}\n` +
        `   • Итераций: ${iterations}\n` +
        `   • Локаций проверено: ${locationsCount}\n\n` +
        `⏳ Следующая проверка будет выполнена при следующем запуске парсера.`;
    }

    if (notifications.length > 0) {
      message += `\n━━━━━━━━━━━━━━━━━━━━\n\n<b>👥 КЛИЕНТЫ ДЛЯ ЗАПИСИ</b>\n\n`;
      notifications.forEach((n, index) => {
        const cityEmoji =
          n.candidateSlot.city.toLowerCase() === "almaty" ? "🏔" : "🏛";
        message +=
          `<b>${index + 1}. ${n.clientEmail}</b>\n` +
          `   ID: ${n.clientId} | Группа: ${n.visaGroupId}\n` +
          `   ${cityEmoji} ${n.candidateSlot.city} | 📅 ${n.candidateSlot.date}\n\n`;
      });
    }

    if (slots.length > 0) {
      const slotsByCity = new Map<
        string,
        Array<{ date: string; time: string }>
      >();
      slots.forEach((s) => {
        if (!slotsByCity.has(s.city)) {
          slotsByCity.set(s.city, []);
        }
        slotsByCity.get(s.city)!.push({ date: s.date, time: s.time });
      });

      message += `\n━━━━━━━━━━━━━━━━━━━━\n\n<b>${typeEmoji} ВСЕ НАЙДЕННЫЕ СЛОТЫ</b>\n\n`;

      slotsByCity.forEach((citySlots, city) => {
        const cityEmoji = city.toLowerCase() === "almaty" ? "🏔" : "🏛";
        message += `${cityEmoji} <b>${city}:</b> ${citySlots.length} слотов\n\n`;

        citySlots.forEach((slot) => {
          message += `   📅 ${slot.date}\n`;
        });

        message += `\n`;
      });
    }

    try {
      // Если есть совпадения (matches) - отправляем в топик BOOKINGS (3)
      // Если только слоты без совпадений - отправляем в топик SLOTS
      const topicId = hasMatches
        ? this.config.topicBookings
        : this.config.topicSlots;

      this.logger.log(
        `📤 Отправка уведомления: hasMatches=${hasMatches}, topicId=${topicId}, notifications=${notifications.length}, slots=${slots.length}`
      );

      if (topicId === null || topicId === undefined) {
        this.logger.warn(
          `⚠️ Пропуск отправки: topicId не установлен (hasMatches=${hasMatches}, topicBookings=${this.config.topicBookings}, topicSlots=${this.config.topicSlots})`
        );
        return false;
      }

      await this.sendMessage(message, topicId);
      this.logger.log(`✅ Уведомление успешно отправлено в топик ${topicId}`);
      return true;
    } catch (error: any) {
      this.logger.error(`❌ Ошибка отправки уведомления: ${error.message}`);
      return false;
    }
  }

  /**
   * Отправка информации только о слотах (даты + времена) в topicSlots
   * Без информации о пользователях, записях и статистике
   */
  async notifyAboutSlotsOnly(
    slotsWithTimes: Array<{ date: string; times: string[]; city: string }>,
    parserEmail: string,
    isResident: boolean,
    iterationInfo?: {
      currentIteration: number;
      totalIterations?: number;
      batchNumber: number;
      totalBatches?: number;
    }
  ): Promise<boolean> {
    if (!this.config.botToken || !this.config.chatId) {
      return false;
    }

    const typeLabel = isResident ? "РЕЗИДЕНТЫ" : "НЕ-РЕЗИДЕНТЫ";
    const typeEmoji = isResident ? "👤" : "🌍";

    const now = new Date();
    const timeStr = now.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Almaty",
    });
    const dateStr = now.toLocaleDateString("ru-RU", {
      timeZone: "Asia/Almaty",
    });

    let iterationInfoText = "";
    if (iterationInfo) {
      const iterationLabel =
        typeof iterationInfo.totalIterations === "number" &&
        iterationInfo.totalIterations > 0
          ? `${iterationInfo.currentIteration}/${iterationInfo.totalIterations}`
          : `${iterationInfo.currentIteration}`;
      const batchLabel =
        typeof iterationInfo.totalBatches === "number" &&
        iterationInfo.totalBatches > 0
          ? `${iterationInfo.batchNumber}/${iterationInfo.totalBatches}`
          : `${iterationInfo.batchNumber}`;
      iterationInfoText =
        `\n🔄 Итерация: <b>${iterationLabel}</b>` + ` | Батч: <b>${batchLabel}</b>`;
    }

    let message =
      `📊 <b>${slotsWithTimes.length > 0 ? "ДОСТУПНЫЕ СЛОТЫ" : "СЛОТОВ НЕ НАЙДЕНО"} (${typeLabel})</b>\n\n` +
      `📧 Парсер: <code>${parserEmail}</code>\n` +
      `${typeEmoji} Тип: <b>${typeLabel}</b>${iterationInfoText}\n` +
      `📅 ${dateStr} 🕐 ${timeStr}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (slotsWithTimes.length === 0) {
      message +=
        `❌ <b>СЛОТОВ НЕ НАЙДЕНО</b>\n\n` +
        `После проверки всех локаций доступные слоты не обнаружены.\n\n` +
        `⏳ Следующая проверка будет выполнена при следующем batchEnd.`;
    } else {
      // Группируем по городам
      const slotsByCity = new Map<
        string,
        Array<{ date: string; times: string[] }>
      >();

      for (const slot of slotsWithTimes) {
        if (!slotsByCity.has(slot.city)) {
          slotsByCity.set(slot.city, []);
        }
        slotsByCity.get(slot.city)!.push({
          date: slot.date,
          times: slot.times,
        });
      }

      slotsByCity.forEach((citySlots, city) => {
        const cityEmoji = city.toLowerCase() === "almaty" ? "🏔" : "🏛";
        message += `${cityEmoji} <b>${city}</b>\n\n`;

        citySlots.forEach((slot) => {
          if (slot.times.length > 0) {
            message += `📅 <b>${slot.date}</b>\n`;
            message += `   🕐 ${slot.times.join(", ")}\n\n`;
          } else {
            message += `📅 <b>${slot.date}</b> (времена не получены)\n\n`;
          }
        });

        message += `\n`;
      });
    }

    const topicId = this.config.topicSlots;
    if (!topicId) {
      this.logger.warn(`⚠️ Пропуск отправки: topicSlots не установлен`);
      return false;
    }

    try {
      await this.sendMessage(message, topicId);
      this.logger.log(
        `✅ Информация о слотах отправлена в topicSlots (${topicId})`
      );
      return true;
    } catch (error: any) {
      this.logger.error(
        `❌ Ошибка отправки информации о слотах: ${error.message}`
      );
      return false;
    }
  }

  private _calculateIterations(
    requestCount: number,
    locationsCount: number
  ): number {
    if (locationsCount === 0) return 0;
    return Math.ceil(requestCount / locationsCount);
  }

  async notifyAboutBookingAttempt(
    clientId: number,
    clientEmail: string,
    visaGroupId: number,
    slot: { city: string; date: string; time: string }
  ): Promise<void> {
    if (!this.config.botToken || !this.config.chatId) return;

    const cityEmoji = slot.city.toLowerCase() === "almaty" ? "🏔" : "🏛";
    const message =
      `🔄 <b>ПОПЫТКА ЗАПИСИ</b>\n\n` +
      `Клиент: ${clientEmail} (ID: ${clientId})\n` +
      `Группа: ${visaGroupId}\n` +
      `${cityEmoji} ${slot.city} | 📅 ${slot.date} 🕐 ${slot.time}\n\n` +
      `⏳ Отправляется запрос...`;

    await this.sendMessage(message, this.config.topicBookings);
  }

  async notifyAboutSuccessfulBooking(
    clientId: number,
    clientEmail: string,
    visaGroupId: number,
    slot: { city: string; date: string; time: string },
    additionalInfo?: {
      bookingMethod?: "auto" | "manual";
      bookingDuration?: number;
    }
  ): Promise<void> {
    if (!this.config.botToken || !this.config.chatId) return;

    const cityEmoji = slot.city.toLowerCase() === "almaty" ? "🏔" : "🏛";
    const method =
      additionalInfo?.bookingMethod === "auto" ? "автоматически" : "вручную";
    const duration = additionalInfo?.bookingDuration
      ? `\n⏱ ${(additionalInfo.bookingDuration / 1000).toFixed(1)}с`
      : "";

    const message =
      `✅ <b>ЗАПИСЬ УСПЕШНА!</b>\n\n` +
      `Клиент: <code>${clientEmail}</code>\n` +
      `ID: ${clientId} | Группа: ${visaGroupId}\n` +
      `${cityEmoji} ${slot.city} | 📅 ${slot.date} 🕐 ${slot.time}\n` +
      `🤖 Метод: ${method}${duration}\n\n` +
      `✅ Статус: ПОДТВЕРЖДЕНО ПРОВЕРКОЙ ПОСЛЕ ЗАПИСИ`;

    await this.sendMessage(message, this.config.topicBookings);
  }

  async notifyAboutFailedBooking(
    clientId: number,
    clientEmail: string,
    visaGroupId: number,
    slot: { city: string; date: string; time: string },
    errorMessage: string,
    additionalInfo?: {
      errorStack?: string;
      bookingMethod?: "auto" | "manual";
    }
  ): Promise<void> {
    if (!this.config.botToken || !this.config.chatId) return;

    const cityEmoji = slot.city.toLowerCase() === "almaty" ? "🏔" : "🏛";
    const method =
      additionalInfo?.bookingMethod === "auto" ? "автоматически" : "вручную";

    let message =
      `❌ <b>ОШИБКА ЗАПИСИ</b>\n\n` +
      `Клиент: <code>${clientEmail}</code>\n` +
      `ID: ${clientId} | Группа: ${visaGroupId}\n` +
      `${cityEmoji} ${slot.city} | 📅 ${slot.date} 🕐 ${slot.time}\n` +
      `🤖 Метод: ${method}\n\n` +
      `🔴 <b>Ошибка:</b>\n<code>${this.escapeHtml(errorMessage)}</code>`;

    if (additionalInfo?.errorStack) {
      message += `\n\n<pre>${this.escapeHtml(additionalInfo.errorStack.substring(0, 1000))}</pre>`;
    }

    await this.sendMessage(message, this.config.topicBookings);
  }
}
