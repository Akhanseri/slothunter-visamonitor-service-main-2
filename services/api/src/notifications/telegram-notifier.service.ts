import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BaseTelegramNotifierService,
  TelegramNotifierConfig,
  TelegramRateLimitError,
} from "@visa-monitor/shared";

export { TelegramRateLimitError };

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
