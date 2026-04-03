export interface VisaGroupNotification {
  clientId: number;
  clientEmail: string;
  visaGroupId: number;
  candidateSlot: {
    date: string;
    time: string;
    city: string;
  };
}

export class TelegramRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number | null) {
    super("Telegram rate limit exceeded");
    this.name = "TelegramRateLimitError";
  }
}

export interface TelegramNotifierConfig {
  botToken: string | null;
  chatId: string | null;
  topicParser: number | null;
  topicErrors: number | null;
  topicSlots: number | null;
  topicBookings: number | null;
  logger?: {
    log: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

export abstract class BaseTelegramNotifierService {
  protected lastMessageTime = 0;
  protected readonly minMessageDelay = 1200;
  protected readonly maxRateLimitDelay = 300000;

  constructor(protected readonly config: TelegramNotifierConfig) {
    if (this.config.botToken && this.config.chatId) {
      this.config.logger?.log("✅ Telegram bot настроен");
    } else {
      this.config.logger?.warn("⚠️ Telegram уведомления отключены");
    }
  }

  protected async sendMessage(
    message: string,
    threadId?: number | null,
    maxRetries: number = 3
  ): Promise<void> {
    if (!this.config.botToken || !this.config.chatId) {
      this.config.logger?.warn(
        `⚠️ Telegram: пропуск отправки (botToken или chatId не установлены)`
      );
      return;
    }

    const timeSinceLastMessage = Date.now() - this.lastMessageTime;
    if (timeSinceLastMessage < this.minMessageDelay) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.minMessageDelay - timeSinceLastMessage)
      );
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const requestBody = {
          chat_id: this.config.chatId,
          text: message,
          parse_mode: "HTML",
          message_thread_id: threadId || undefined,
          disable_web_page_preview: true,
        };

        this.config.logger?.log(
          `📤 Telegram: отправка сообщения (попытка ${attempt}/${maxRetries}), chat_id=${this.config.chatId}, thread_id=${threadId || "нет"}`
        );

        const response = await fetch(
          `https://api.telegram.org/bot${this.config.botToken}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          }
        );

        const data = (await response.json()) as {
          ok: boolean;
          error_code?: number;
          description?: string;
          parameters?: { retry_after?: number };
        };

        if (!data.ok) {
          const errorMsg = `Telegram API error: ${data.error_code} - ${data.description || "Unknown error"}`;
          this.config.logger?.error(`❌ ${errorMsg}`);
          
          if (data.error_code === 429) {
            const retryAfter = Math.min(
              (data.parameters?.retry_after || 1) * 1000,
              this.maxRateLimitDelay
            );
            if (attempt < maxRetries) {
              this.config.logger?.warn(
                `⚠️ Telegram rate limit, повтор через ${retryAfter}мс`
              );
              await new Promise((resolve) => setTimeout(resolve, retryAfter));
              continue;
            }
            throw new TelegramRateLimitError(retryAfter);
          }
          throw new Error(errorMsg);
        }

        this.lastMessageTime = Date.now();
        this.config.logger?.log(
          `✅ Telegram: сообщение успешно отправлено (chat_id=${this.config.chatId}, thread_id=${threadId || "нет"})`
        );
        return;
      } catch (error: any) {
        if (error instanceof TelegramRateLimitError) {
          this.config.logger?.error(
            `❌ Telegram rate limit после ${maxRetries} попыток: ${error.retryAfterMs}мс`
          );
          throw error;
        }
        if (attempt === maxRetries) {
          this.config.logger?.error(
            `❌ Telegram: ошибка отправки после ${maxRetries} попыток: ${error.message}`
          );
          throw error;
        }
        this.config.logger?.warn(
          `⚠️ Telegram: ошибка отправки (попытка ${attempt}/${maxRetries}), повтор через ${1000 * attempt}мс: ${error.message}`
        );
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  protected escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async notifyParserError(
    error: Error,
    context?: {
      step?: string;
      residentEmail?: string;
      noResidentEmail?: string;
      stack?: string;
      additionalInfo?: Record<string, any>;
    }
  ): Promise<void> {
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

    const email =
      context?.residentEmail ||
      context?.noResidentEmail ||
      context?.additionalInfo?.email ||
      context?.additionalInfo?.parserEmail ||
      "N/A";

    let message =
      `❌ <b>ОШИБКА ПАРСЕРА</b>\n\n` +
      `📅 ${dateStr} 🕐 ${timeStr}\n` +
      `📧 Email: <code>${email}</code>\n\n` +
      `🔴 <b>Ошибка:</b>\n<code>${this.escapeHtml(error.message)}</code>\n`;

    if (context?.step) {
      message += `\n📍 Этап: <code>${this.escapeHtml(context.step)}</code>\n`;
    }

    const stack = error.stack || context?.stack;
    if (stack) {
      message += `\n<pre>${this.escapeHtml(stack.substring(0, 2000))}</pre>`;
    }

    await this.sendMessage(message, this.config.topicErrors);
  }
}
