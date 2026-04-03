import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, MoreThanOrEqual } from "typeorm";
import { Client } from "@visa-monitor/shared";

/**
 * Менеджер очередей клиентов для справедливого Round-Robin распределения
 *
 * Логика работы:
 * - Хранит currentQueueIndex отдельно для resident и non-resident
 * - Получает следующего клиента по queueIndex >= currentIndex
 * - Когда достигает конца - сбрасывает на начало (wrap-around)
 * - Обновляет lastProcessedAt для статистики
 */
@Injectable()
export class ClientQueueManager {
  private readonly logger = new Logger(ClientQueueManager.name);

  private currentQueueIndex = {
    resident: 0,
    "non-resident": 0,
  };

  constructor(
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>
  ) {}

  /**
   * Получить следующего клиента из очереди (Round-Robin)
   */
  async getNextClient(
    parserType: "resident" | "non-resident"
  ): Promise<Client | null> {
    const isResident = parserType === "resident";
    const currentIndex = this.currentQueueIndex[parserType];

    this.logger.log(
      `🔍 [QUEUE] Поиск клиента для ${parserType}, currentQueueIndex = ${currentIndex}`
    );

    // Сначала проверяем, сколько всего активных клиентов
    const totalActiveClients = await this.clientRepository.count({
      where: {
        isResident,
        isActive: true,
      },
    });

    this.logger.log(
      `📊 [QUEUE] Всего активных клиентов для ${parserType}: ${totalActiveClients}`
    );

    // Ищем клиента с queueIndex >= currentIndex
    let client = await this.clientRepository.findOne({
      where: {
        isResident,
        isActive: true,
        queueIndex: MoreThanOrEqual(currentIndex),
      },
      order: { queueIndex: "ASC" },
      relations: ["visaGroups"],
    });

    if (!client) {
      // Достигли конца очереди или нет клиентов с таким индексом
      // Сбрасываем на начало и пробуем снова
      this.logger.log(
        `🔄 [QUEUE] Достигнут конец очереди для ${parserType}, сброс currentIndex на 0`
      );

      this.currentQueueIndex[parserType] = 0;

      client = await this.clientRepository.findOne({
        where: {
          isResident,
          isActive: true,
        },
        order: { queueIndex: "ASC" },
        relations: ["visaGroups"],
      });

      if (!client) {
        this.logger.warn(
          `⚠️ [QUEUE] Нет активных клиентов для ${parserType} в очереди`
        );
        return null;
      }
    }

    // Переходим к следующему индексу для следующего вызова
    this.currentQueueIndex[parserType] = (client.queueIndex || 0) + 1;

    // Обновляем lastProcessedAt для статистики
    await this.clientRepository.update(client.id, {
      lastProcessedAt: new Date(),
    });

    this.logger.log(
      `✅ [QUEUE] Выбран клиент: ${client.email} (queueIndex: ${client.queueIndex}, групп: ${client.visaGroups?.length || 0})`
    );
    this.logger.log(
      `📊 [QUEUE] Следующий currentQueueIndex для ${parserType} = ${this.currentQueueIndex[parserType]}`
    );

    return client;
  }

  /**
   * Получить текущий индекс очереди (для мониторинга)
   */
  getCurrentQueueIndex(parserType: "resident" | "non-resident"): number {
    return this.currentQueueIndex[parserType];
  }

  /**
   * Сбросить очередь на начало (для ручного управления)
   */
  resetQueue(parserType: "resident" | "non-resident"): void {
    this.currentQueueIndex[parserType] = 0;
    this.logger.log(`🔄 Очередь для ${parserType} сброшена на 0`);
  }

  /**
   * Получить статистику очереди
   */
  async getQueueStats(parserType: "resident" | "non-resident"): Promise<{
    totalClients: number;
    activeClients: number;
    currentIndex: number;
    oldestProcessed: Date | null;
    newestProcessed: Date | null;
  }> {
    const isResident = parserType === "resident";

    const [totalClients, activeClients, oldestProcessed, newestProcessed] =
      await Promise.all([
        this.clientRepository.count({
          where: { isResident },
        }),
        this.clientRepository.count({
          where: { isResident, isActive: true },
        }),
        this.clientRepository
          .createQueryBuilder("client")
          .select("MIN(client.lastProcessedAt)", "oldest")
          .where('client."isResident" = :isResident', { isResident })
          .andWhere('client."isActive" = true')
          .getRawOne(),
        this.clientRepository
          .createQueryBuilder("client")
          .select("MAX(client.lastProcessedAt)", "newest")
          .where('client."isResident" = :isResident', { isResident })
          .andWhere('client."isActive" = true')
          .getRawOne(),
      ]);

    return {
      totalClients,
      activeClients,
      currentIndex: this.currentQueueIndex[parserType],
      oldestProcessed: oldestProcessed?.oldest || null,
      newestProcessed: newestProcessed?.newest || null,
    };
  }
}
