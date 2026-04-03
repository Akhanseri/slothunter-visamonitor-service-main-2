import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, IsNull, Not, Equal } from "typeorm";
import { VisaService } from "../visa/visa.service";
import {
  TelegramNotifierService,
  TelegramRateLimitError,
  VisaGroupNotification,
} from "../notifications/telegram-notifier.service";
import { SlotMatcherService, Slot } from "../visa/slot-matcher.service";
import {
  Client,
  ClientVisaGroup,
  MatchStatus,
  VisaLog,
  Location,
  VisaGroupStatus,
} from "@visa-monitor/shared";
import { ConfigService } from "@nestjs/config";
import { ClientQueueManager } from "./client-queue.manager";
import { SessionWarmerService } from "../sessions/session-warmer.service";

type ParserSession = {
  cookie: string;
  scheduleId: string;
  locationId: string;
  locationName: string;
};

@Injectable()
export class VisaSchedulerProcessor implements OnModuleInit {
  private readonly logger = new Logger(VisaSchedulerProcessor.name);

  // Батчинг: отправляем уведомления и записываем логи раз в N итераций
  // ~30 итераций = ~1 минута (2 локации * ~1-2 сек на запрос = ~2-4 сек на итерацию)
  private readonly ITERATIONS_PER_BATCH = 30;
  private readonly parserType: "resident" | "non-resident";
  private consecutiveAuthFailures = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly visaService: VisaService,
    private readonly telegramNotifierService: TelegramNotifierService,
    private readonly slotMatcherService: SlotMatcherService,
    private readonly clientQueueManager: ClientQueueManager,
    private readonly sessionWarmerService: SessionWarmerService,
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
    @InjectRepository(ClientVisaGroup)
    private readonly clientVisaGroupRepository: Repository<ClientVisaGroup>,
    @InjectRepository(VisaLog)
    private readonly visaLogRepository: Repository<VisaLog>
  ) {
    const parserTypeEnv = this.configService
      .get<string>("PARSER_TYPE")
      ?.toLowerCase()
      .trim();

    if (parserTypeEnv === "resident" || parserTypeEnv === "non-resident") {
      this.parserType = parserTypeEnv;
    } else {
      throw new Error(
        `PARSER_TYPE должен быть "resident" или "non-resident", получено: ${parserTypeEnv}`
      );
    }

    this.logger.log(`📋 Парсер запущен для типа: ${this.parserType}`);
  }

  async onModuleInit() {
    if (String(process.env.PRELOADER_ONLY || "").trim() === "1") {
      this.logger.log(
        "🧊 PRELOADER_ONLY=1: парсер отключен, работает только прогрев сессий"
      );
      return;
    }
    this.logger.log("🚀 Запуск парсера...");
    // НЕ блокируем инициализацию Nest (нужно, чтобы app.listen() завершился и /health работал)
    void this.runParser();
  }

  private async _safeTelegram(
    action: string,
    fn: () => Promise<unknown>
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(`Telegram notify failed (${action}): ${e.message}`);
    }
  }

  private async runParser(): Promise<void> {
    while (true) {
      try {
        this.logger.log(
          `🔄 [PARSER] Начало нового цикла парсера для типа: ${this.parserType}`
        );
        const client = await this._loadSlotSourceClient();
        if (!client) {
          this.logger.warn(
            `⚠️ [PARSER] Не найден активный клиент для типа: ${this.parserType}, ожидание 60 секунд...`
          );
          await this._delay(60000);
          continue;
        }

        this.logger.log(
          `✅ [PARSER] Найден клиент: ${client.email} (ID: ${client.id}, queueIndex: ${client.queueIndex})`
        );

        const scheduleId =
          this._getClientScheduleIdForSlots(client, {
            preferSingleApplicant: true,
          }) || this._getClientScheduleIdForSlots(client);
        if (!scheduleId) {
          this.logger.warn(
            `⚠️ [PARSER] Клиент ${client.email} не имеет группы с schedulePath, пропускаем`
          );
          continue;
        }

        const warmed = await this.sessionWarmerService.ensureWarmSession({
          client,
          scheduleId,
        });
        if (!warmed) {
          this.consecutiveAuthFailures++;
          const baseDelay = 120_000; // 2 минуты
          const delayMs = Math.min(
            600_000, // максимум 10 минут
            baseDelay *
              Math.pow(2, Math.max(0, this.consecutiveAuthFailures - 1))
          );
          this.logger.error(
            `❌ Не удалось прогреть/получить сессию для клиента: ${client.email}. Ошибок подряд: ${this.consecutiveAuthFailures}. Доп. задержка ${(
              delayMs / 1000
            ).toFixed(0)}с`
          );
          await this._delay(delayMs);
          continue;
        }

        this.consecutiveAuthFailures = 0;
        const session: ParserSession = {
          cookie: warmed.cookie,
          scheduleId,
          locationId: "",
          locationName: "",
        };

        const locations = this.visaService.getLocations();
        this.logger.log(`📍 Локаций для парсинга: ${locations.length}`);

        await this._safeTelegram("notifyParserStart", () =>
          this.telegramNotifierService.notifyParserStart({
            residentEmail:
              this.parserType === "resident" ? client.email : undefined,
            noResidentEmail:
              this.parserType === "non-resident" ? client.email : undefined,
          })
        );

        // Накопление всех слотов с временами для отправки в batchEnd
        const allSlotsWithTimes = new Map<
          string,
          {
            date: string;
            times: string[];
            city: string;
            scheduleId: string;
            locationId: string;
          }
        >();

        this.logger.log(
          `🔄 Начинаем бесконечный цикл итераций (батчинг статистики: каждые ${this.ITERATIONS_PER_BATCH} итераций)`
        );

        let iteration = 0;
        while (true) {
          iteration++;
          let slots: Slot[] = [];

          const iterationStart = Date.now();
          this.logger.log(`[${iteration}] Итерация ${iteration}`);

          let shouldRestartCycle = false;
          for (const location of locations) {
            this.logger.log(`  📍 Локация: ${location.name} (${location.id})`);

            try {
              // Небольшая задержка между запросами к разным локациям (1-2 секунды)
              // чтобы не перегружать сервер, но сохранить частоту парсинга
              if (locations.indexOf(location) > 0) {
                const delayMs = 1000 + Math.random() * 1000; // 1-2 секунды
                await this._delay(delayMs);
              }

              const result = await this.visaService.fetchSlotsFast(
                session.scheduleId,
                location.id,
                session.cookie
              );

              if (result.isSessionExpired) {
                this.logger.warn(`⚠️ Сессия истекла, переавторизация...`);
                const refreshed =
                  await this.sessionWarmerService.ensureWarmSession({
                    client,
                    scheduleId: session.scheduleId,
                    force: true,
                  });
                if (refreshed) {
                  session.cookie = refreshed.cookie;
                  this.logger.log(`✅ Переавторизация успешна`);
                } else {
                  this.logger.error(`❌ Ошибка переавторизации`);
                  shouldRestartCycle = true;
                  break;
                }
                continue;
              }

              if (result.success && result.days.length > 0) {
                const newSlots = this._convertSlotsFromResult(
                  result,
                  location.name,
                  session.scheduleId,
                  location.id
                );
                slots.push(...newSlots);

                this.logger.log(`  ✅ Найдено слотов: ${slots.length}`);

                // Обрабатываем слоты и отправляем срочные уведомления сразу
                await this._processSlotsForActiveClients(slots, session, {
                  iterationNumber: iteration,
                });
              } else {
                this.logger.log(`  ℹ️ Слотов не найдено`);
              }
            } catch (error) {
              const errorObj =
                error instanceof Error ? error : new Error(String(error));
              this.logger.error(
                `  ❌ Ошибка при запросе слотов для ${location.name}: ${errorObj.message}`
              );

              await this._safeTelegram("notifyParserError(fetchSlots)", () =>
                this.telegramNotifierService.notifyParserError(errorObj, {
                  step: `Запрос слотов для ${location.name}`,
                  residentEmail:
                    this.parserType === "resident" ? client.email : undefined,
                  noResidentEmail:
                    this.parserType === "non-resident"
                      ? client.email
                      : undefined,
                  stack: errorObj.stack,
                })
              );
            }
          }

          if (shouldRestartCycle) {
            throw new Error(
              `Ошибка переавторизации для клиента: ${client.email}`
            );
          }

          const iterationDuration = Date.now() - iterationStart;
          this.logger.log(
            `[${iteration}] Итерация завершена за ${(iterationDuration / 1000).toFixed(1)}с. Всего слотов: ${slots.length}`
          );

          // Накопление слотов для batchEnd
          const uniqueSlots =
            this.slotMatcherService.removeDuplicateSlots(slots);
          for (const slot of uniqueSlots) {
            if (slot.scheduleId && slot.locationId) {
              const key = `${slot.city}-${slot.date}`;
              if (!allSlotsWithTimes.has(key)) {
                allSlotsWithTimes.set(key, {
                  date: slot.date,
                  times: [],
                  city: slot.city,
                  scheduleId: slot.scheduleId,
                  locationId: slot.locationId,
                });
              }
            }
          }

          // Батчим только несрочные данные: отправка информации о слотах с временами
          const isBatchEnd = iteration % this.ITERATIONS_PER_BATCH === 0;

          if (isBatchEnd) {
            const batchStart = Date.now();
            const batchNumber = Math.ceil(
              iteration / this.ITERATIONS_PER_BATCH
            );

            this.logger.log(
              `📦 Батч ${batchNumber}: получение временных слотов и отправка...`
            );

            // ОПТИМИЗАЦИЯ: Мы больше не получаем времена массово для отчета в батче,
            // чтобы минимизировать количество запросов к сайту (по просьбе пользователя).
            // await this._fetchTimesForAllSlots(
            //   allSlotsWithTimes,
            //   session,
            //   client.email
            // );

            // Отправляем только информацию о слотах в topicSlots
            await this._sendSlotsInfoToTelegram(
              Array.from(allSlotsWithTimes.values()),
              client.email,
              {
                currentIteration: iteration,
                batchNumber,
              }
            );

            // Очищаем накопленные слоты после отправки
            allSlotsWithTimes.clear();

            const batchDuration = Date.now() - batchStart;
            this.logger.log(
              `✅ Батч ${batchNumber} завершен (за ${(batchDuration / 1000).toFixed(1)}с)`
            );
          }
        }
      } catch (error) {
        const errorObj =
          error instanceof Error ? error : new Error(String(error));
        this.logger.error(`❌ Критическая ошибка парсера: ${errorObj.message}`);
        this.logger.error(errorObj.stack);

        await this.telegramNotifierService.notifyParserError(errorObj, {
          step: "Критическая ошибка парсера",
          stack: errorObj.stack,
        });

        this.logger.log(`⏳ Ожидание 60 секунд перед повторной попыткой...`);
        await this._delay(60000);
      }
    }
  }

  private async _loadClient(): Promise<Client | null> {
    try {
      // Используем ClientQueueManager для Round-Robin очереди
      const client = await this.clientQueueManager.getNextClient(
        this.parserType
      );

      if (!client) {
        return null;
      }

      const hasActiveGroups = client.visaGroups?.some(
        (group) => group.isActive
      );

      if (!hasActiveGroups) {
        this.logger.warn(
          `⚠️ Клиент ${client.email} (queueIndex: ${client.queueIndex}) не имеет активных групп, пропускаем`
        );
        // Получаем следующего клиента из очереди
        return this._loadClient();
      }

      return client;
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Ошибка загрузки клиента: ${errorObj.message}`);
      return null;
    }
  }

  private async _loadSlotSourceClient(): Promise<Client | null> {
    try {
      const isResident = this.parserType === "resident";

      // Ищем "источник слотов": аккаунт с одним заявителем (applicantsCount=1)
      // и только теми статусами, при которых сайт отдает доступный календарь дат
      // (register = ещё не записан, attend = есть запись → оба могут виδεть слоты).
      const source = await this.clientRepository
        .createQueryBuilder("c")
        .leftJoinAndSelect("c.visaGroups", "g")
        .where("c.isActive = true")
        .andWhere("c.isResident = :isResident", { isResident })
        .andWhere("g.isActive = true")
        .andWhere("g.schedulePath IS NOT NULL")
        .andWhere("g.schedulePath <> ''")
        .andWhere(
          "(COALESCE(jsonb_array_length(g.applicants), 0) = 1 OR g.applicants_count = 1)"
        )
        .andWhere("g.status IN (:...statuses)", {
          statuses: ["register", "attend"],
        })
        .orderBy("c.lastProcessedAt", "ASC", "NULLS FIRST")
        .addOrderBy("c.queueIndex", "ASC")
        .getOne();

      if (source) {
        this.logger.log(
          `✅ [SLOT-SOURCE] Найден источник слотов: ${source.email} (ID: ${source.id})`
        );
        return source;
      }

      this.logger.warn(
        `⚠️ [SLOT-SOURCE] Нет аккаунтов с applicantsCount=1 и статусом register/attend. Пропускаем итерацию.`
      );
      return null;
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Ошибка загрузки slot-source клиента: ${errorObj.message}`
      );
      return null;
    }
  }

  private _getClientScheduleIdForSlots(
    client: Client,
    opts?: { preferSingleApplicant?: boolean }
  ): string | null {
    const groups = (client.visaGroups || []).filter(
      (g) => g.isActive && !!g.schedulePath
    );
    if (groups.length === 0) return null;

    const preferSingleApplicant = !!opts?.preferSingleApplicant;

    const filtered = preferSingleApplicant
      ? groups.filter(
          (g) =>
            g.applicantsCount === 1 || (g.applicants || []).length === 1
        )
      : groups;

    if (preferSingleApplicant) {
      this.logger.log(`🔍 [GROUP-SELECTOR] Для ${client.email} найдено ${groups.length} активных групп. Отфильтровано "одиночек" (count=1): ${filtered.length}`);
    }

    const pool = filtered.length > 0 ? filtered : groups;

    const preferred =
      pool.find((g) => g.status === VisaGroupStatus.Attend) || pool[0];
    const m = preferred.schedulePath.match(/\/schedule\/(\d+)\//);
    
    const scheduleId = m?.[1] || null;
    this.logger.log(`✅ [GROUP-SELECTOR] Выбрана группа ID: ${preferred.id} (путь: ${preferred.schedulePath}). Извлеченный scheduleId: ${scheduleId}`);
    
    return scheduleId;
  }

  private async _authorize(client: Client): Promise<ParserSession | null> {
    try {
      this.logger.log(`🔐 Авторизация для ${client.email}...`);

      const session = await this.visaService.authorizeAndGetSession(
        client.email,
        client.password
      );

      this.logger.log(`✅ Авторизация успешна`);

      return {
        cookie: session.cookie,
        scheduleId: session.scheduleId,
        locationId: session.locationId,
        locationName: session.locationName,
      };
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`❌ Ошибка авторизации: ${errorObj.message}`);

      await this.telegramNotifierService.notifyParserError(errorObj, {
        step: "Авторизация",
        residentEmail:
          this.parserType === "resident" ? client.email : undefined,
        noResidentEmail:
          this.parserType === "non-resident" ? client.email : undefined,
        stack: errorObj.stack,
      });

      return null;
    }
  }

  private async _processSlotsForActiveClients(
    slots: Slot[],
    session: ParserSession,
    context?: {
      iterationNumber?: number;
    }
  ): Promise<void> {
    try {
      this.logger.log(
        `🔍 [MATCHING] Начало обработки слотов для всех активных клиентов: получено ${slots.length} слотов`
      );

      const uniqueSlots = this.slotMatcherService.sortSlotsByDateTime(
        this.slotMatcherService.removeDuplicateSlots(slots)
      );

      this.logger.log(
        `🔍 [MATCHING] После дедупликации: ${uniqueSlots.length} уникальных слотов`
      );

      if (uniqueSlots.length === 0) {
        this.logger.warn(`⚠️ [MATCHING] Нет уникальных слотов для обработки`);
        return;
      }

      const activeVisaGroups = await this.clientVisaGroupRepository.find({
        where: {
          isActive: true,
          city: Not(IsNull()),
          slotStartDate: Not(IsNull()),
          slotEndDate: Not(IsNull()),
          client: {
            isActive: true,
            isResident: this.parserType === "resident",
          },
        },
        relations: ["client"],
      });

      this.logger.log(
        `🔍 [MATCHING] Найдено активных групп с параметрами: ${activeVisaGroups.length}`
      );

      // Группируем слоты по дате и городу для оптимизации
      const slotsByDateAndCity = new Map<
        string,
        { slot: Slot; groups: ClientVisaGroup[] }
      >();

      // Сначала находим все подходящие группы для каждого слота
      for (const slot of uniqueSlots) {
        if (!slot.scheduleId || !slot.locationId) {
          continue;
        }

        const key = `${slot.date}-${slot.city.toLowerCase()}`;

        if (!slotsByDateAndCity.has(key)) {
          slotsByDateAndCity.set(key, {
            slot,
            groups: [],
          });
        }

        const slotData = slotsByDateAndCity.get(key)!;

        // Находим все группы, которые подходят под этот слот
        for (const visaGroup of activeVisaGroups) {
          if (
            visaGroup.matchStatus !== MatchStatus.NEW &&
            visaGroup.matchStatus !== MatchStatus.REMATCH_REQUIRED &&
            visaGroup.matchStatus !== MatchStatus.MATCH_PENDING
          ) {
            continue;
          }

          // КРИТИЧНО: Если у группы уже есть MATCH_PENDING и lastNotifiedAt,
          // пропускаем её для других дат, чтобы не обрабатывать повторно
          if (
            visaGroup.matchStatus === MatchStatus.MATCH_PENDING &&
            visaGroup.lastNotifiedAt &&
            visaGroup.candidateSlot
          ) {
            // Проверяем, является ли это тот же самый слот
            const isSameSlot =
              visaGroup.candidateSlot.city.toLowerCase() ===
                slot.city.toLowerCase() &&
              visaGroup.candidateSlot.date === slot.date;

            // Если это не тот же слот - пропускаем (уже есть уведомление для другой даты)
            if (!isSameSlot) {
              continue;
            }
          }

          if (
            !visaGroup.city ||
            visaGroup.city.toLowerCase() !== slot.city.toLowerCase()
          ) {
            continue;
          }

          const clientWindow = this.slotMatcherService.buildClientWindow(
            visaGroup.slotStartDate!,
            visaGroup.slotEndDate!,
            visaGroup.delayDays ?? 0
          );

          if (!clientWindow) {
            continue;
          }

          const slotDate = this.slotMatcherService.parseSlotDate(slot.date);
          const slotDateOnly = new Date(slotDate);
          slotDateOnly.setHours(0, 0, 0, 0);

          const startDateOnly = new Date(clientWindow.startDate);
          startDateOnly.setHours(0, 0, 0, 0);
          const endDateOnly = new Date(clientWindow.endDate);
          endDateOnly.setHours(0, 0, 0, 0);

          if (slotDateOnly >= startDateOnly && slotDateOnly <= endDateOnly) {
            slotData.groups.push(visaGroup);
          }
        }
      }

      this.logger.log(
        `🔍 [MATCHING] Найдено ${slotsByDateAndCity.size} уникальных дат с подходящими группами`
      );

      // Обрабатываем каждую уникальную дату
      for (const [key, { slot, groups }] of slotsByDateAndCity.entries()) {
        if (groups.length === 0) {
          continue;
        }

        this.logger.log(
          `🔍 [MATCHING] Обработка даты ${slot.date} ${slot.city}: найдено ${groups.length} подходящих групп`
        );

        // ВАЖНО: Время для слота здесь больше не запрашивается (оптимизация кол-ва запросов).
        // Для ручной записи время не нужно (отправляем просто дату), 
        // а для авто-записи время будет запрошено непосредственно перед самой записью.

        // Разделяем группы на автозапись и обычные
        const autoBookGroups: ClientVisaGroup[] = [];
        const manualGroups: ClientVisaGroup[] = [];

        for (const visaGroup of groups) {
          if (visaGroup.isAutoBookEnabled) {
            autoBookGroups.push(visaGroup);
          } else {
            manualGroups.push(visaGroup);
          }
        }

        this.logger.log(
          `🔍 [MATCHING] Дата ${slot.date} ${slot.city}: автозапись=${autoBookGroups.length}, ручная=${manualGroups.length}`
        );

        // Обрабатываем автозапись
        if (autoBookGroups.length > 0) {
          await this._processAutoBookingForDate(slot, autoBookGroups, session);
        }

        // Обрабатываем ручную запись: отправляем уведомления
        if (manualGroups.length > 0) {
          await this._processManualMatchingForDate(
            slot,
            ["любое (уточните на сайте)"],
            manualGroups,
            session,
            context?.iterationNumber
          );
        }
      }
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(`Ошибка обработки слотов: ${errorObj.message}`);
    }
  }

  private async _processAutoBookingForDate(
    slot: Slot,
    groups: ClientVisaGroup[],
    session: ParserSession
  ): Promise<void> {
    this.logger.log(
      `🚀 [AUTO-BOOK] Дата ${slot.date} ${slot.city}: обработка ${groups.length} групп с автозаписью`
    );

    let baseTimes: string[] = [];
    try {
      const timesResult = await this.visaService.fetchTimesForDate(
        slot.scheduleId!,
        slot.locationId!,
        slot.date,
        session.cookie
      );
      if (timesResult.success && timesResult.times.length > 0) {
        baseTimes = timesResult.times;
        this.logger.log(`✅ [AUTO-BOOK] Дата ${slot.date}: найдено ${baseTimes.length} слотов времени`);
      } else {
        this.logger.warn(`⚠️ [AUTO-BOOK] Дата ${slot.date}: время не найдено, автозапись отменена`);
        return;
      }
    } catch (e) {
      this.logger.error(`❌ [AUTO-BOOK] Ошибка запроса времени для ${slot.date}: ${e}`);
      return;
    }

    // Для групп с 2+ заявителями времена могут отличаться.
    // Поэтому:
    // - времена-источник (baseTimes) получены через "однозаявительный" scheduleId
    // - для multi-групп получаем их времена и берем пересечение, чтобы не стрелять в "невидимые" слоты
    const visibleTimesByGroup = new Map<number, string[]>();
    const multiGroups = groups.filter((g) => (g.applicants || []).length > 1);

    for (const g of multiGroups) {
      const groupTimes = await this._getVisibleTimesForVisaGroup(
        g,
        slot,
        baseTimes
      );
      if (groupTimes.length > 0) {
        visibleTimesByGroup.set(g.id, groupTimes);
      }
    }

    // Пытаемся записывать: для каждой группы пробуем несколько времен до успеха.
    for (const visaGroup of groups) {
      const candidateTimes =
        visibleTimesByGroup.get(visaGroup.id) ?? baseTimes.slice();

      // Минимизируем количество попыток: обычно у multi-групп "не хватает" 1-2 времен.
      const maxAttempts = Math.min(candidateTimes.length, 6);
      const toTry = candidateTimes.slice(0, maxAttempts);

      this.logger.log(
        `🚀 [AUTO-BOOK] Группа ${visaGroup.id} (${visaGroup.client.email}): попытка записи на ${slot.date}, кандидатов=${toTry.length}`
      );

      await this._tryAutoBookingWithFallbackTimes(visaGroup, slot, toTry);
    }
  }

  private async _getVisibleTimesForVisaGroup(
    visaGroup: ClientVisaGroup,
    slot: Slot,
    sourceTimes: string[]
  ): Promise<string[]> {
    const scheduleId = this._extractScheduleIdFromPath(visaGroup.schedulePath);
    if (!scheduleId) return [];
    if (!slot.locationId) return [];

    const warmed = await this.sessionWarmerService.ensureWarmSession({
      client: visaGroup.client,
      scheduleId,
    });
    if (!warmed) return [];

    try {
      const timesResult = await this.visaService.fetchTimesForDate(
        scheduleId,
        slot.locationId,
        slot.date,
        warmed.cookie
      );
      if (!timesResult.success || timesResult.times.length === 0) return [];

      const allowed = new Set(timesResult.times);
      const intersection = sourceTimes.filter((t) => allowed.has(t));
      return intersection;
    } catch {
      return [];
    }
  }

  private async _tryAutoBookingWithFallbackTimes(
    visaGroup: ClientVisaGroup,
    slot: Slot,
    candidateTimes: string[]
  ): Promise<void> {
    if (candidateTimes.length === 0) return;

    // Одна "видимая" попытка в Telegram — дальше только внутренняя ретрай-логика.
    const firstSlot: Slot = { ...slot, time: candidateTimes[0] };
    await this._tryAutoBookingInternal(visaGroup, firstSlot, candidateTimes);
  }

  private async _tryAutoBookingInternal(
    visaGroup: ClientVisaGroup,
    firstSlot: Slot,
    candidateTimes: string[]
  ): Promise<void> {
    try {
      if (!visaGroup.isActive) return;
      if (
        visaGroup.matchStatus === MatchStatus.BOOKED ||
        visaGroup.matchStatus === MatchStatus.BOOKING_IN_PROGRESS
      ) {
        return;
      }

      const previousStatus = visaGroup.matchStatus || MatchStatus.NEW;

      const scheduleId = this._extractScheduleIdFromPath(
        visaGroup.schedulePath
      );
      if (!scheduleId) {
        throw new Error("Не удалось извлечь scheduleId из schedulePath");
      }

      const lockResult = await this.clientVisaGroupRepository
        .createQueryBuilder()
        .update(ClientVisaGroup)
        .set({ matchStatus: MatchStatus.BOOKING_IN_PROGRESS })
        .where("id = :id", { id: visaGroup.id })
        .andWhere(
          "(match_status IS NULL OR match_status NOT IN (:...blockedStatuses))",
          {
            blockedStatuses: [
              MatchStatus.BOOKED,
              MatchStatus.BOOKING_IN_PROGRESS,
            ],
          }
        )
        .execute();

      if (!lockResult.affected) {
        return;
      }

      const cityName = this._getCityName(firstSlot.city);
      await this._safeTelegram("notifyAboutBookingAttempt(auto-internal)", () =>
        this.telegramNotifierService.notifyAboutBookingAttempt(
          visaGroup.client.id,
          visaGroup.client.email,
          visaGroup.id,
          {
            city: cityName,
            date: firstSlot.date,
            time: firstSlot.time,
          }
        )
      );

      let warmed = await this.sessionWarmerService.ensureWarmSession({
        client: visaGroup.client,
        scheduleId,
        force: true,
        throwOnError: true,
      });
      if (!warmed) {
        throw new Error("Не удалось получить warmed session для записи");
      }

      const start = Date.now();
      let lastErrorMessage = "Неизвестная ошибка";

      for (const time of candidateTimes) {
        const attemptSlot: Slot = { ...firstSlot, time };

        let result = await this.visaService.bookAppointmentWithSession({
          scheduleId,
          facilityId: attemptSlot.city,
          date: attemptSlot.date,
          time: attemptSlot.time,
          cookie: warmed.cookie,
          csrfToken: warmed.csrfToken,
        });

        // Если сессия протухла — обновляем и повторяем один раз для этого же времени.
        if (
          !result.success &&
          result.message.toLowerCase().includes("session")
        ) {
          const refreshed = await this.sessionWarmerService.ensureWarmSession({
            client: visaGroup.client,
            scheduleId,
            force: true,
          });
          if (refreshed) {
            warmed = refreshed;
            result = await this.visaService.bookAppointmentWithSession({
              scheduleId,
              facilityId: attemptSlot.city,
              date: attemptSlot.date,
              time: attemptSlot.time,
              cookie: warmed.cookie,
              csrfToken: warmed.csrfToken,
            });
          }
        }

        if (result.success) {
          const bookingDuration = Date.now() - start;
          const bookedTime = result.bookedTime || attemptSlot.time;

          await this.clientVisaGroupRepository.update(visaGroup.id, {
            matchStatus: MatchStatus.BOOKED,
            candidateSlot: {
              city: attemptSlot.city,
              date: attemptSlot.date,
              time: bookedTime,
            },
            lastNotifiedAt: new Date(),
          });

          await this._safeTelegram(
            "notifyAboutSuccessfulBooking(auto-internal)",
            () =>
              this.telegramNotifierService.notifyAboutSuccessfulBooking(
                visaGroup.client.id,
                visaGroup.client.email,
                visaGroup.id,
                {
                  city: cityName,
                  date: attemptSlot.date,
                  time: bookedTime,
                },
                {
                  bookingMethod: "auto",
                  bookingDuration,
                }
              )
          );
          return;
        }

        lastErrorMessage = result.message || lastErrorMessage;
      }

      await this.clientVisaGroupRepository.update(visaGroup.id, {
        matchStatus: previousStatus,
      });

      await this._safeTelegram("notifyAboutFailedBooking(auto-internal)", () =>
        this.telegramNotifierService.notifyAboutFailedBooking(
          visaGroup.client.id,
          visaGroup.client.email,
          visaGroup.id,
          {
            city: cityName,
            date: firstSlot.date,
            time: firstSlot.time,
          },
          lastErrorMessage,
          {
            bookingMethod: "auto",
            errorStack: undefined,
          }
        )
      );
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));

      await this.clientVisaGroupRepository.update(visaGroup.id, {
        matchStatus: visaGroup.matchStatus || MatchStatus.NEW,
      });

      const cityName = this._getCityName(firstSlot.city);

      await this._safeTelegram(
        "notifyAboutFailedBooking(auto-internal-exception)",
        () =>
          this.telegramNotifierService.notifyAboutFailedBooking(
            visaGroup.client.id,
            visaGroup.client.email,
            visaGroup.id,
            {
              city: cityName,
              date: firstSlot.date,
              time: firstSlot.time,
            },
            errorObj.message || "Неизвестная ошибка",
            {
              bookingMethod: "auto",
              errorStack: errorObj.stack,
            }
          )
      );

      await this._safeTelegram("notifyParserError(auto-internal)", () =>
        this.telegramNotifierService.notifyParserError(errorObj, {
          step: "Автозапись клиента",
          residentEmail: visaGroup.client.isResident
            ? visaGroup.client.email
            : undefined,
          noResidentEmail: !visaGroup.client.isResident
            ? visaGroup.client.email
            : undefined,
          stack: errorObj.stack,
        })
      );
    }
  }

  private async _processManualMatchingForDate(
    slot: Slot,
    times: string[],
    groups: ClientVisaGroup[],
    session: ParserSession,
    iterationNumber?: number
  ): Promise<void> {
    this.logger.log(
      `📝 [MANUAL-MATCH] Дата ${slot.date} ${slot.city}: обработка ${groups.length} групп для ручной записи`
    );

    // Используем первое доступное время для уведомления
    const firstTime = times.length > 0 ? times[0] : undefined;

    for (const visaGroup of groups) {
      const matchedSlot: Slot = {
        ...slot,
        time: firstTime || "", // Гарантируем строку, чтобы избежать undefined !== null в БД
      };

      // Проверяем нужно ли обновлять candidate slot
      const shouldReplace = this._shouldReplaceCandidateSlot(
        visaGroup,
        matchedSlot
      );

      // Обновляем БД и отправляем уведомление только если слот новый/лучше
      if (shouldReplace || !visaGroup.candidateSlot) {
        this.logger.log(
          `📝 [MANUAL-MATCH] Группа ${visaGroup.id}: обновление статуса на MATCH_PENDING и отправка уведомления...`
        );

        const candidateSlotExpiresAt = new Date();
        candidateSlotExpiresAt.setMinutes(
          candidateSlotExpiresAt.getMinutes() + 30
        );

        const newCandidateSlot = {
          date: matchedSlot.date,
          time: matchedSlot.time,
          city: matchedSlot.city,
        };

        const updateData: any = {
          matchStatus: MatchStatus.MATCH_PENDING,
          candidateSlotExpiresAt,
          lastNotifiedAt: new Date(),
          candidateSlot: newCandidateSlot,
        };

        // Обновляем БД
        await this.clientVisaGroupRepository.update(visaGroup.id, updateData);

        // КРИТИЧНО: Обновляем объект в памяти, чтобы следующие даты в этой же итерации
        // не считали, что candidateSlot всё еще пустой.
        visaGroup.matchStatus = MatchStatus.MATCH_PENDING;
        visaGroup.candidateSlot = newCandidateSlot;
        visaGroup.lastNotifiedAt = updateData.lastNotifiedAt;

        this.logger.log(
          `✅ [MANUAL-MATCH] Группа ${visaGroup.id}: статус обновлен в БД, отправка уведомления...`
        );

        // Отправляем уведомление
        await this._sendMatchNotification(
          visaGroup,
          matchedSlot,
          visaGroup.client,
          iterationNumber
        );
      } else {
        this.logger.debug(
          `📝 [MANUAL-MATCH] Группа ${visaGroup.id}: слот ${slot.date} уже обработан или хуже текущего, пропуск уведомления.`
        );
      }
    }
  }

  private async _sendMatchNotification(
    visaGroup: ClientVisaGroup,
    slot: Slot,
    client: Client,
    iterationNumber?: number
  ): Promise<void> {
    try {
      const notification: VisaGroupNotification = {
        clientId: client.id,
        clientEmail: client.email,
        visaGroupId: visaGroup.id,
        candidateSlot: {
          date: slot.date,
          time: slot.time || "",
          city: slot.city,
        },
      };

      this.logger.log(
        `📤 [MATCHING] Отправка срочного уведомления в топик BOOKINGS (3): клиент ${client.email}, группа ${visaGroup.id}, слот ${slot.date} ${slot.time} ${slot.city}`
      );

      // СРОЧНО: Отправляем уведомление о совпадении сразу в топик BOOKINGS (3)
      const sent =
        await this.telegramNotifierService.notifyManagersAboutMatchesForVisaGroups(
          [notification],
          {
            slots: [
              {
                date: slot.date,
                time: slot.time,
                city: slot.city,
              },
            ],
            isResident: this.parserType === "resident",
            parserEmail: client.email,
            requestCount: 0,
            estimatedTotalRequests: 0,
            locationsCount: 0,
            iterationDuration: 0,
            iterationNumber,
          }
        );

      if (sent) {
        this.logger.log(
          `✅ [MATCHING] Срочное уведомление отправлено в топик BOOKINGS: клиент ${client.email}, группа ${visaGroup.id}, слот ${slot.date} ${slot.time} ${slot.city}`
        );
      } else {
        this.logger.warn(
          `⚠️ [MATCHING] Не удалось отправить уведомление: клиент ${client.email}, группа ${visaGroup.id}`
        );
      }
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Ошибка отправки срочного уведомления: ${errorObj.message}`
      );
    }
  }

  private _shouldReplaceCandidateSlot(
    visaGroup: ClientVisaGroup,
    slot: Slot
  ): boolean {
    if (!visaGroup.candidateSlot) {
      return true;
    }

    const slotTime = slot.time;
    const currentCandidate = visaGroup.candidateSlot;
    const currentTime = currentCandidate.time;

    const isSameSlot =
      currentCandidate.city.toLowerCase() === slot.city.toLowerCase() &&
      currentCandidate.date === slot.date &&
      currentTime === slotTime;

    if (isSameSlot) {
      if (visaGroup.matchStatus === MatchStatus.MATCH_PENDING) {
        this.logger.log(
          `ℹ️ [MATCHING] Группа ${visaGroup.id}: пропуск (тот же слот уже в статусе MATCH_PENDING)`
        );
        return false;
      }
      return true;
    }

    const existingDate = this.slotMatcherService.parseSlotDate(
      currentCandidate.date
    );
    const newDate = this.slotMatcherService.parseSlotDate(slot.date);

    if (newDate.getTime() < existingDate.getTime()) {
      return true;
    }

    if (newDate.getTime() === existingDate.getTime()) {
      return slotTime < currentTime;
    }

    return false;
  }

  private async _tryAutoBooking(
    visaGroup: ClientVisaGroup,
    slot: Slot
  ): Promise<void> {
    try {
      if (!visaGroup.isActive) {
        return;
      }

      if (
        visaGroup.matchStatus === MatchStatus.BOOKED ||
        visaGroup.matchStatus === MatchStatus.BOOKING_IN_PROGRESS
      ) {
        return;
      }

      const previousStatus = visaGroup.matchStatus || MatchStatus.NEW;

      const lockResult = await this.clientVisaGroupRepository
        .createQueryBuilder()
        .update(ClientVisaGroup)
        .set({ matchStatus: MatchStatus.BOOKING_IN_PROGRESS })
        .where("id = :id", { id: visaGroup.id })
        .andWhere(
          "(match_status IS NULL OR match_status NOT IN (:...blockedStatuses))",
          {
            blockedStatuses: [
              MatchStatus.BOOKED,
              MatchStatus.BOOKING_IN_PROGRESS,
            ],
          }
        )
        .execute();

      if (!lockResult.affected) {
        return;
      }

      const cityName = this._getCityName(slot.city);

      this.logger.log(
        `🚀 [AUTO-BOOK] Группа ${visaGroup.id}: попытка записи на ${slot.date} в ${slot.time} (${cityName})`
      );

      await this._safeTelegram("notifyAboutBookingAttempt(auto)", () =>
        this.telegramNotifierService.notifyAboutBookingAttempt(
          visaGroup.client.id,
          visaGroup.client.email,
          visaGroup.id,
          {
            city: cityName,
            date: slot.date,
            time: slot.time,
          }
        )
      );

      const scheduleId = this._extractScheduleIdFromPath(
        visaGroup.schedulePath
      );
      if (!scheduleId) {
        throw new Error("Не удалось извлечь scheduleId из schedulePath");
      }

      const warmed = await this.sessionWarmerService.ensureWarmSession({
        client: visaGroup.client,
        scheduleId,
      });
      if (!warmed) {
        throw new Error("Не удалось получить warmed session для записи");
      }

      const start = Date.now();
      this.logger.log(`🏗 [AUTO-BOOK] Группа ${visaGroup.id}: отправка запроса бронирования...`);
      let result = await this.visaService.bookAppointmentWithSession({
        scheduleId,
        facilityId: slot.city,
        date: slot.date,
        time: slot.time,
        cookie: warmed.cookie,
        csrfToken: warmed.csrfToken,
      });

      // Один быстрый retry: обновляем сессию/CSRF и повторяем
      if (!result.success) {
        const refreshed = await this.sessionWarmerService.ensureWarmSession({
          client: visaGroup.client,
          scheduleId,
          force: true,
        });
        if (refreshed) {
          result = await this.visaService.bookAppointmentWithSession({
            scheduleId,
            facilityId: slot.city,
            date: slot.date,
            time: slot.time,
            cookie: refreshed.cookie,
            csrfToken: refreshed.csrfToken,
          });
        }
      }
      const bookingDuration = Date.now() - start;

      if (result.success) {
        const bookedTime = slot.time;
        this.logger.log(`✅ [AUTO-BOOK] Группа ${visaGroup.id}: ЗАПИСЬ УСПЕШНА на ${slot.date} в ${bookedTime}`);

        await this.clientVisaGroupRepository.update(visaGroup.id, {
          matchStatus: MatchStatus.BOOKED,
          candidateSlot: {
            city: slot.city,
            date: slot.date,
            time: bookedTime,
          },
          lastNotifiedAt: new Date(),
        });

        await this._safeTelegram("notifyAboutSuccessfulBooking(auto)", () =>
          this.telegramNotifierService.notifyAboutSuccessfulBooking(
            visaGroup.client.id,
            visaGroup.client.email,
            visaGroup.id,
            {
              city: cityName,
              date: slot.date,
              time: bookedTime,
            },
            {
              bookingMethod: "auto",
              bookingDuration,
            }
          )
        );
      } else {
        this.logger.warn(`❌ [AUTO-BOOK] Группа ${visaGroup.id}: запись не удалась. Ответ: ${result.message}`);
        await this.clientVisaGroupRepository.update(visaGroup.id, {
          matchStatus: previousStatus,
        });

        await this._safeTelegram("notifyAboutFailedBooking(auto)", () =>
          this.telegramNotifierService.notifyAboutFailedBooking(
            visaGroup.client.id,
            visaGroup.client.email,
            visaGroup.id,
            {
              city: cityName,
              date: slot.date,
              time: slot.time,
            },
            result.message || "Неизвестная ошибка",
            {
              bookingMethod: "auto",
              errorStack: undefined,
            }
          )
        );
      }
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));

      await this.clientVisaGroupRepository.update(visaGroup.id, {
        matchStatus: visaGroup.matchStatus || MatchStatus.NEW,
      });

      const cityName = this._getCityName(slot.city);

      await this._safeTelegram("notifyAboutFailedBooking(auto-exception)", () =>
        this.telegramNotifierService.notifyAboutFailedBooking(
          visaGroup.client.id,
          visaGroup.client.email,
          visaGroup.id,
          {
            city: cityName,
            date: slot.date,
            time: slot.time,
          },
          errorObj.message || "Неизвестная ошибка",
          {
            bookingMethod: "auto",
            errorStack: errorObj.stack,
          }
        )
      );

      await this._safeTelegram("notifyParserError(auto)", () =>
        this.telegramNotifierService.notifyParserError(errorObj, {
          step: "Автозапись клиента",
          residentEmail: visaGroup.client.isResident
            ? visaGroup.client.email
            : undefined,
          noResidentEmail: !visaGroup.client.isResident
            ? visaGroup.client.email
            : undefined,
          stack: errorObj.stack,
        })
      );
    }
  }

  private _getCityName(cityIdOrName: string): string {
    const locations = this.visaService.getLocations();
    const location = locations.find(
      (loc) =>
        loc.id === cityIdOrName.trim() ||
        loc.name.toLowerCase() === cityIdOrName.trim().toLowerCase()
    );
    return location?.name || cityIdOrName;
  }

  private _extractScheduleIdFromPath(schedulePath: string): string | null {
    const m = schedulePath.match(/\/schedule\/(\d+)\//);
    return m?.[1] || null;
  }

  private _convertSlotsFromResult(
    result: {
      days: Array<{ date: string; business_day: boolean }>;
    },
    locationName: string,
    scheduleId: string,
    locationId: string
  ): Slot[] {
    return result.days
      .filter((day) => day.business_day && day.date)
      .map((day) => ({
        date: day.date,
        time: "00:00",
        city: locationName,
        scheduleId,
        locationId,
      }));
  }

  /**
   * Получение временных слотов для всех накопленных дат
   * Оптимизировано: параллельные запросы с ограничением параллелизма
   * Получает времена только для слотов текущего года
   */
  private async _fetchTimesForAllSlots(
    slotsMap: Map<
      string,
      {
        date: string;
        times: string[];
        city: string;
        scheduleId: string;
        locationId: string;
      }
    >,
    session: ParserSession,
    clientEmail: string
  ): Promise<void> {
    if (slotsMap.size === 0) {
      return;
    }

    const CONCURRENT_REQUESTS = 10; // Количество параллельных запросов
    const currentYear = new Date().getFullYear();

    // Фильтруем слоты: только текущий год
    const slotsArray = Array.from(slotsMap.entries()).filter(
      ([key, slotInfo]) => {
        try {
          const slotDate = new Date(slotInfo.date);
          const slotYear = slotDate.getFullYear();
          return slotYear === currentYear;
        } catch {
          return false;
        }
      }
    );

    if (slotsArray.length === 0) {
      this.logger.log(
        `ℹ️ [BATCH] Нет слотов в текущем году (${currentYear}) для получения времен`
      );
      return;
    }

    const totalSlots = slotsArray.length;
    this.logger.log(
      `🕐 [BATCH] Получение временных слотов для ${totalSlots} уникальных дат (${currentYear} год, параллелизм: ${CONCURRENT_REQUESTS})...`
    );

    let processed = 0;
    const startTime = Date.now();

    // Обрабатываем слоты батчами с ограничением параллелизма
    for (let i = 0; i < slotsArray.length; i += CONCURRENT_REQUESTS) {
      const batch = slotsArray.slice(i, i + CONCURRENT_REQUESTS);
      const batchNumber = Math.floor(i / CONCURRENT_REQUESTS) + 1;
      const totalBatches = Math.ceil(slotsArray.length / CONCURRENT_REQUESTS);

      // Выполняем все запросы в батче параллельно
      const promises = batch.map(async ([key, slotInfo]) => {
        try {
          const timesResult = await this.visaService.fetchTimesForDate(
            slotInfo.scheduleId,
            slotInfo.locationId,
            slotInfo.date,
            session.cookie
          );

          if (timesResult.success && timesResult.times.length > 0) {
            slotInfo.times = timesResult.times;
            this.logger.log(
              `✅ [BATCH] ${slotInfo.city} ${slotInfo.date}: найдено ${timesResult.times.length} временных слотов`
            );
          } else {
            this.logger.warn(
              `⚠️ [BATCH] ${slotInfo.city} ${slotInfo.date}: временные слоты не найдены`
            );
          }
        } catch (error) {
          const errorObj =
            error instanceof Error ? error : new Error(String(error));
          this.logger.warn(
            `⚠️ [BATCH] Ошибка получения времен для ${slotInfo.city} ${slotInfo.date}: ${errorObj.message}`
          );
        }
      });

      // Ждем завершения всех запросов в батче
      await Promise.allSettled(promises);

      processed += batch.length;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const avgTimePerSlot = (Date.now() - startTime) / processed / 1000;
      const estimatedRemaining = (
        (totalSlots - processed) *
        avgTimePerSlot
      ).toFixed(1);

      this.logger.log(
        `📊 [BATCH] Прогресс: ${processed}/${totalSlots} (${((processed / totalSlots) * 100).toFixed(1)}%), батч ${batchNumber}/${totalBatches}, прошло ${elapsed}с, осталось ~${estimatedRemaining}с`
      );

      // Небольшая задержка между батчами (чтобы не перегружать сервер)
      if (i + CONCURRENT_REQUESTS < slotsArray.length) {
        await this._delay(50 + Math.random() * 50); // 50-100ms между батчами
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.log(
      `✅ [BATCH] Получение временных слотов завершено: ${processed}/${totalSlots} дат обработано за ${totalTime}с`
    );
  }

  /**
   * Отправка информации о слотах (даты + времена) в Telegram topicSlots
   * Отправляет сообщение даже если слотов нет
   */
  private async _sendSlotsInfoToTelegram(
    slotsWithTimes: Array<{ date: string; times: string[]; city: string }>,
    clientEmail: string,
    iterationInfo: {
      currentIteration: number;
      batchNumber: number;
      totalIterations?: number;
      totalBatches?: number;
    }
  ): Promise<void> {
    const isResident = this.parserType === "resident";
    await this._safeTelegram("notifyAboutSlotsOnly", () =>
      this.telegramNotifierService.notifyAboutSlotsOnly(
        slotsWithTimes,
        clientEmail,
        isResident,
        iterationInfo
      )
    );
  }

  private async _delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
