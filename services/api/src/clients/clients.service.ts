import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Client, ClientVisaGroup, MatchStatus } from "@visa-monitor/shared";
import { CreateClientDto } from "./dto/create-client.dto";
import { VisaService } from "../visa/visa.service";
import { TelegramNotifierService } from "../notifications/telegram-notifier.service";

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);

  private async safeTelegram(
    action: string,
    fn: () => Promise<void>
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(`Telegram notify failed (${action}): ${e.message}`);
    }
  }

  constructor(
    @InjectRepository(Client)
    private clientsRepository: Repository<Client>,
    @InjectRepository(ClientVisaGroup)
    private clientVisaGroupRepository: Repository<ClientVisaGroup>,
    private visaService: VisaService,
    private telegramNotifierService: TelegramNotifierService
  ) {}

  async create(createClientDto: CreateClientDto): Promise<Client> {
    const existingClient = await this.clientsRepository.findOne({
      where: { email: createClientDto.email },
    });
    if (existingClient) {
      throw new ConflictException("Бұл email бойынша клиент бар");
    }

    // Получаем группы с retry логикой
    let clientVisaGroups;
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `🔄 Попытка ${attempt}/${maxRetries} получения групп для клиента ${createClientDto.email}`
        );
        clientVisaGroups = await this.visaService.getVisaAccountGroups(
          createClientDto.email,
          createClientDto.password
        );
        this.logger.log(
          `✅ Группы успешно получены для клиента ${createClientDto.email}: ${clientVisaGroups.groups.length} групп`
        );
        break; // Успешно, выходим из цикла
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `⚠️  Ошибка получения групп (попытка ${attempt}/${maxRetries}): ${lastError.message}`
        );

        if (attempt < maxRetries) {
          const delayMs = 2000 * attempt; // 2s, 4s, 6s
          this.logger.log(`⏳ Повтор через ${delayMs}мс...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          this.logger.error(
            `❌ Все попытки получения групп исчерпаны для клиента ${createClientDto.email}`
          );
          this.logger.error(`Stack trace: ${lastError?.stack || "N/A"}`);

          // Отправляем ошибку в Telegram с полным stack trace
          try {
            const enhancedError = lastError || new Error("Неизвестная ошибка");
            if (!enhancedError.stack && lastError) {
              enhancedError.stack =
                lastError.stack ||
                `Error: ${enhancedError.message}\n    at getVisaAccountGroups (clients.service.ts:${Date.now()})`;
            }

            await this.telegramNotifierService.notifyParserError(
              enhancedError,
              {
                step: `Получение групп для клиента ${createClientDto.email}`,
                stack: enhancedError.stack,
                additionalInfo: {
                  operation: "getVisaAccountGroups",
                  clientEmail: createClientDto.email,
                  parserEmail: createClientDto.email, // Для отображения в сообщении
                  attempts: maxRetries,
                  errorName: enhancedError.name || "Unknown",
                  errorMessage: enhancedError.message,
                },
              }
            );
          } catch (notifyError) {
            this.logger.error(
              `❌ Ошибка отправки уведомления об ошибке получения групп: ${notifyError.message}`
            );
          }

          throw new Error(
            `Не удалось получить группы для клиента после ${maxRetries} попыток: ${lastError?.message || "Неизвестная ошибка"}`
          );
        }
      }
    }

    if (!clientVisaGroups) {
      throw new Error(
        `Не удалось получить группы для клиента: ${lastError?.message || "Неизвестная ошибка"}`
      );
    }

    // Автоматически присваиваем queueIndex для справедливой очереди
    const maxQueueIndex = await this.clientsRepository
      .createQueryBuilder("client")
      .select("MAX(client.queueIndex)", "max")
      .where("client.isResident = :isResident", {
        isResident: createClientDto.isResident,
      })
      .getRawOne();

    const nextQueueIndex = (maxQueueIndex?.max || 0) + 1;

    this.logger.log(
      `📋 Присваиваем queueIndex = ${nextQueueIndex} для ${createClientDto.isResident ? "resident" : "non-resident"} клиента`
    );

    const client = this.clientsRepository.create({
      email: createClientDto.email,
      password: createClientDto.password,
      isResident: createClientDto.isResident,
      companyEmail: createClientDto.companyEmail,
      queueIndex: nextQueueIndex,
      lastProcessedAt: null,
    });

    const savedClient = await this.clientsRepository.save(client);

    // При создании нового клиента просто создаем все группы из API как новые
    // Используем существующий метод getVisaAccountGroups из VisaService
    for (const group of clientVisaGroups.groups) {
      const visaGroup = this.clientVisaGroupRepository.create({
        clientId: savedClient.id,
        status: group.status,
        schedulePath: group.schedulePath,
        applicants: group.applicants ?? null,
        city: null,
        slotStartDate: null,
        slotEndDate: null,
        delayDays: null,
        matchStatus: null,
        candidateSlot: null,
        candidateSlotExpiresAt: null,
        lastNotifiedAt: null,
        isActive: true,
        applicantsCount: null,
      });
      await this.clientVisaGroupRepository.save(visaGroup);
      this.logger.log(
        `✅ Создана группа ${visaGroup.id} для клиента ${savedClient.id} (status: ${group.status}, schedulePath: ${group.schedulePath})`
      );
    }

    this.logger.log(
      `✅ Создано ${clientVisaGroups.groups.length} групп для нового клиента ${savedClient.id}`
    );

    return this.findOne(savedClient.id);
  }

  async findPaginated(
    page: number = 1,
    limit: number = 10,
    companyEmail?: string
  ): Promise<{
    clients: Client[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const queryBuilder = this.clientsRepository
      .createQueryBuilder("client")
      .leftJoinAndSelect("client.visaGroups", "visaGroups");

    if (companyEmail && companyEmail !== "super@admin.com") {
      queryBuilder.where("client.companyEmail = :companyEmail", {
        companyEmail,
      });
    }

    const total = await queryBuilder.getCount();

    const skip = (page - 1) * limit;
    const clients = await queryBuilder
      .orderBy("client.createdAt", "DESC")
      .skip(skip)
      .take(limit)
      .getMany();

    const totalPages = Math.ceil(total / limit);

    return {
      clients,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findAll(companyEmail?: string): Promise<Client[]> {
    const queryBuilder = this.clientsRepository
      .createQueryBuilder("client")
      .leftJoinAndSelect("client.visaGroups", "visaGroups");

    if (companyEmail && companyEmail !== "super@admin.com") {
      queryBuilder.where("client.companyEmail = :companyEmail", {
        companyEmail,
      });
    }

    return queryBuilder.orderBy("client.createdAt", "DESC").getMany();
  }

  async findOne(id: number, companyEmail?: string): Promise<Client> {
    const queryBuilder = this.clientsRepository
      .createQueryBuilder("client")
      .leftJoinAndSelect("client.visaGroups", "visaGroups")
      .where("client.id = :id", { id });

    if (companyEmail && companyEmail !== "super@admin.com") {
      queryBuilder.andWhere("client.companyEmail = :companyEmail", {
        companyEmail,
      });
    }

    return queryBuilder.getOne();
  }

  async update(
    id: number,
    updateClientDto: Partial<Client>,
    companyEmail?: string
  ): Promise<Client> {
    const client = await this.findOne(id, companyEmail);
    if (!client) {
      throw new ForbiddenException("Клиент табылмады немесе сізде рұқсат жоқ");
    }

    await this.clientsRepository.update(id, updateClientDto);
    return this.findOne(id, companyEmail);
  }

  async remove(id: number, companyEmail?: string): Promise<void> {
    const client = await this.findOne(id, companyEmail);
    if (!client) {
      throw new ForbiddenException("Клиент табылмады немесе сізде рұқсат жоқ");
    }

    await this.clientsRepository.delete(id);
  }

  async findByEmail(email: string): Promise<Client> {
    return this.clientsRepository.findOne({
      where: { email },
    });
  }

  /**
   * Создать клиента вручную БЕЗ проверки credentials через visa API
   * Используется когда visa API недоступен или заблокирован
   */
  async createManual(manualDto: {
    email: string;
    password: string;
    isResident: boolean;
    companyEmail?: string;
    groups: Array<{ status: string; schedulePath: string }>;
  }): Promise<Client> {
    const existingClient = await this.clientsRepository.findOne({
      where: { email: manualDto.email },
    });
    if (existingClient) {
      throw new ConflictException("Клиент с таким email уже существует");
    }

    // Автоматически присваиваем queueIndex
    const maxQueueIndex = await this.clientsRepository
      .createQueryBuilder("client")
      .select("MAX(client.queueIndex)", "max")
      .where("client.isResident = :isResident", {
        isResident: manualDto.isResident,
      })
      .getRawOne();

    const nextQueueIndex = (maxQueueIndex?.max || 0) + 1;

    this.logger.log(
      `📋 Ручное создание клиента с queueIndex = ${nextQueueIndex}`
    );

    const client = this.clientsRepository.create({
      email: manualDto.email,
      password: manualDto.password,
      isResident: manualDto.isResident,
      companyEmail: manualDto.companyEmail,
      queueIndex: nextQueueIndex,
      lastProcessedAt: null,
    });

    const savedClient = await this.clientsRepository.save(client);

    // Создаем группы вручную из переданных данных
    for (const groupData of manualDto.groups) {
      const visaGroup = this.clientVisaGroupRepository.create({
        clientId: savedClient.id,
        status: groupData.status as any,
        schedulePath: groupData.schedulePath,
        city: null,
        slotStartDate: null,
        slotEndDate: null,
        delayDays: null,
        matchStatus: null,
        candidateSlot: null,
        candidateSlotExpiresAt: null,
        lastNotifiedAt: null,
        isActive: true,
        applicantsCount: null,
      });
      await this.clientVisaGroupRepository.save(visaGroup);
      this.logger.log(
        `✅ Вручную создана группа ${visaGroup.id} для клиента ${savedClient.id}`
      );
    }

    this.logger.log(
      `✅ Вручную создан клиент ${savedClient.id} с ${manualDto.groups.length} группами`
    );

    return this.findOne(savedClient.id);
  }

  /**
   * Пересчитать queueIndex для всех клиентов (для управления очередью)
   */
  async reindexClients(type?: "resident" | "non-resident" | "all"): Promise<{
    residentCount: number;
    nonResidentCount: number;
  }> {
    let residentCount = 0;
    let nonResidentCount = 0;

    // Пересчитываем resident клиентов
    if (type === "resident" || type === "all" || !type) {
      const residentClients = await this.clientsRepository.find({
        where: { isResident: true },
        order: { id: "ASC" },
      });

      for (let i = 0; i < residentClients.length; i++) {
        await this.clientsRepository.update(residentClients[i].id, {
          queueIndex: i + 1,
        });
      }

      residentCount = residentClients.length;
      this.logger.log(
        `✅ Переиндексировано ${residentCount} resident клиентов`
      );
    }

    // Пересчитываем non-resident клиентов
    if (type === "non-resident" || type === "all" || !type) {
      const nonResidentClients = await this.clientsRepository.find({
        where: { isResident: false },
        order: { id: "ASC" },
      });

      for (let i = 0; i < nonResidentClients.length; i++) {
        await this.clientsRepository.update(nonResidentClients[i].id, {
          queueIndex: i + 1,
        });
      }

      nonResidentCount = nonResidentClients.length;
      this.logger.log(
        `✅ Переиндексировано ${nonResidentCount} non-resident клиентов`
      );
    }

    return { residentCount, nonResidentCount };
  }

  async setupVisaGroupMatching(
    clientId: number,
    visaGroupId: number,
    matchingParams: {
      city: string;
      slotStartDate: string;
      slotEndDate: string;
      delayDays: number;
      isAutoBookEnabled?: boolean;
      applicantsCount?: number;
    },
    companyEmail?: string
  ): Promise<ClientVisaGroup> {
    const client = await this.findOne(clientId, companyEmail);
    if (!client) {
      throw new ForbiddenException("Клиент табылмады немесе сізде рұқсат жоқ");
    }
    const visaGroup = await this.clientVisaGroupRepository.findOne({
      where: { id: visaGroupId, clientId },
    });

    if (!visaGroup) {
      throw new NotFoundException(
        `Client visa group с ID ${visaGroupId} не найдена для клиента ${clientId}`
      );
    }

    // Проверяем, можно ли изменять параметры в текущем статусе
    // Запрещаем изменения только если запись в процессе
    if (visaGroup.matchStatus === MatchStatus.BOOKING_IN_PROGRESS) {
      throw new ConflictException(
        `Невозможно изменить параметры: запись в процессе (статус: BOOKING_IN_PROGRESS). ` +
          `Дождитесь завершения процесса записи.`
      );
    }

    // Сохраняем предыдущий статус для логирования
    const previousStatus = visaGroup.matchStatus;
    const wasBooked = previousStatus === MatchStatus.BOOKED;
    const wasMatchPending = previousStatus === MatchStatus.MATCH_PENDING;

    const delayDays = matchingParams.delayDays ?? 0;

    visaGroup.city = matchingParams.city;
    visaGroup.slotStartDate = matchingParams.slotStartDate;
    visaGroup.slotEndDate = matchingParams.slotEndDate;
    visaGroup.delayDays = delayDays;
    visaGroup.isAutoBookEnabled = matchingParams.isAutoBookEnabled ?? false;
    visaGroup.applicantsCount = matchingParams.applicantsCount ?? null;
    visaGroup.matchStatus = MatchStatus.NEW;
    visaGroup.candidateSlot = null;
    visaGroup.candidateSlotExpiresAt = null;
    visaGroup.lastNotifiedAt = null;

    const saved = await this.clientVisaGroupRepository.save(visaGroup);

    // Логируем изменения статуса
    if (wasBooked) {
      this.logger.warn(
        `⚠️ Visa group ${visaGroup.id}: параметры изменены, статус сброшен с BOOKED на NEW. Предыдущая запись отменена.`
      );
    } else if (wasMatchPending) {
      this.logger.warn(
        `⚠️ Visa group ${visaGroup.id}: параметры изменены, найденный слот сброшен (был статус MATCH_PENDING)`
      );
    } else if (previousStatus) {
      this.logger.log(
        `✅ Visa group ${visaGroup.id}: параметры обновлены, статус сброшен с ${previousStatus} на NEW`
      );
    }

    return saved;
  }

  async getVisaGroupsByClient(
    clientId: number,
    companyEmail?: string
  ): Promise<ClientVisaGroup[]> {
    const queryBuilder = this.clientVisaGroupRepository
      .createQueryBuilder("visaGroup")
      .leftJoinAndSelect("visaGroup.client", "client")
      .where("visaGroup.clientId = :clientId", { clientId });

    if (companyEmail && companyEmail !== "super@admin.com") {
      queryBuilder.andWhere("client.companyEmail = :companyEmail", {
        companyEmail,
      });
    }

    return queryBuilder.orderBy("visaGroup.createdAt", "ASC").getMany();
  }

  async getVisaGroupById(id: number): Promise<ClientVisaGroup> {
    const visaGroup = await this.clientVisaGroupRepository.findOne({
      where: { id },
      relations: ["client"],
    });

    if (!visaGroup) {
      throw new NotFoundException(`Client visa group с ID ${id} не найдена`);
    }

    return visaGroup;
  }

  async bookVisaGroupAppointment(
    clientId: number,
    visaGroupId: number,
    bookingParams: {
      city: string;
      date: string;
      time?: string;
    },
    companyEmail?: string
  ): Promise<{ success: boolean; message: string }> {
    const clientCheck = await this.findOne(clientId, companyEmail);
    if (!clientCheck) {
      throw new ForbiddenException("Клиент табылмады немесе сізде рұқсат жоқ");
    }
    // Получаем клиента с его данными
    const client = await this.clientsRepository.findOne({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundException(`Клиент с ID ${clientId} не найден`);
    }

    // Получаем visa group
    const visaGroup = await this.clientVisaGroupRepository.findOne({
      where: { id: visaGroupId, clientId },
    });

    if (!visaGroup) {
      throw new NotFoundException(
        `Visa group с ID ${visaGroupId} не найдена для клиента ${clientId}`
      );
    }

    // Проверяем, что группа активна
    if (!visaGroup.isActive) {
      return {
        success: false,
        message: "Visa group неактивна",
      };
    }

    // Проверяем статус группы
    if (
      visaGroup.matchStatus === MatchStatus.BOOKED ||
      visaGroup.matchStatus === MatchStatus.BOOKING_IN_PROGRESS
    ) {
      return {
        success: false,
        message: `Запись уже выполнена или в процессе. Статус: ${visaGroup.matchStatus}`,
      };
    }

    const previousStatus = visaGroup.matchStatus || MatchStatus.NEW;

    // Обновляем статус на BOOKING_IN_PROGRESS атомарно, чтобы избежать гонок
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
      this.logger.warn(
        `⚠️ Booking lock race: clientId=${clientId}, visaGroupId=${visaGroupId}, status=${visaGroup.matchStatus}`
      );
      return {
        success: false,
        message: "Запись уже выполняется или уже выполнена (гонка запросов)",
      };
    }

    // Определяем название города для уведомлений
    // Может прийти как ID (134, 135), так и название (Astana, Almaty)
    const cityInput = bookingParams.city.trim();
    let cityName: string;

    if (cityInput === "134" || cityInput.toLowerCase() === "astana") {
      cityName = "Astana";
    } else if (cityInput === "135" || cityInput.toLowerCase() === "almaty") {
      cityName = "Almaty";
    } else {
      cityName = cityInput; // Используем как есть, если неизвестный формат
    }

    const bookingStartTime = Date.now();
    const isAutoBooking = visaGroup.isAutoBookEnabled;

    try {
      this.logger.log(
        `📝 Booking start: clientId=${clientId}, visaGroupId=${visaGroupId}, facility=${bookingParams.city}, date=${bookingParams.date}, time=${bookingParams.time || "auto"}`
      );
      // Отправляем уведомление о попытке записи
      await this.safeTelegram("notifyAboutBookingAttempt", () =>
        this.telegramNotifierService.notifyAboutBookingAttempt(
          clientId,
          client.email,
          visaGroupId,
          {
            city: cityName,
            date: bookingParams.date,
            time: bookingParams.time || "автовыбор",
          }
        )
      );

      // Вызываем метод записи из VisaService
      // time опционален - если не передан, автоматически выберется самое раннее доступное время
      const result = await this.visaService.bookAppointment({
        email: client.email,
        password: client.password,
        schedulePath: visaGroup.schedulePath,
        facilityId: bookingParams.city,
        date: bookingParams.date,
        time: bookingParams.time,
      });

      const bookingDuration = Date.now() - bookingStartTime;
      this.logger.log(
        `🧾 Booking result: clientId=${clientId}, visaGroupId=${visaGroupId}, success=${result.success}, durationMs=${bookingDuration}, message=${result.message}`
      );

      // Обновляем статус в зависимости от результата
      if (result.success) {
        const bookedTime = result.bookedTime || bookingParams.time || "00:00";

        await this.clientVisaGroupRepository.update(visaGroup.id, {
          matchStatus: MatchStatus.BOOKED,
          candidateSlot: {
            city: bookingParams.city,
            date: bookingParams.date,
            time: bookedTime,
          },
          lastNotifiedAt: new Date(),
        });

        // Отправляем уведомление об успешной записи
        await this.safeTelegram("notifyAboutSuccessfulBooking", () =>
          this.telegramNotifierService.notifyAboutSuccessfulBooking(
            clientId,
            client.email,
            visaGroupId,
            {
              city: cityName,
              date: bookingParams.date,
              time: bookedTime,
            },
            {
              bookingMethod: isAutoBooking ? "auto" : "manual",
              bookingDuration,
            }
          )
        );
      } else {
        // Возвращаем статус обратно если запись не удалась
        await this.clientVisaGroupRepository.update(visaGroup.id, {
          matchStatus: previousStatus,
        });

        // Отправляем уведомление об ошибке записи
        await this.safeTelegram("notifyAboutFailedBooking(result)", () =>
          this.telegramNotifierService.notifyAboutFailedBooking(
            clientId,
            client.email,
            visaGroupId,
            {
              city: cityName,
              date: bookingParams.date,
              time: bookingParams.time || "автовыбор",
            },
            result.message || "Неизвестная ошибка",
            {
              bookingMethod: isAutoBooking ? "auto" : "manual",
              errorStack: undefined,
            }
          )
        );
      }

      return result;
    } catch (error) {
      // В случае ошибки возвращаем статус обратно
      await this.clientVisaGroupRepository.update(visaGroup.id, {
        matchStatus: previousStatus,
      });

      // Отправляем уведомление об ошибке
      const err = error instanceof Error ? error : new Error(String(error));
      await this.safeTelegram("notifyAboutFailedBooking(exception)", () =>
        this.telegramNotifierService.notifyAboutFailedBooking(
          clientId,
          client.email,
          visaGroupId,
          {
            city: cityName,
            date: bookingParams.date,
            time: bookingParams.time || "автовыбор",
          },
          err.message || "Неизвестная ошибка",
          {
            bookingMethod: isAutoBooking ? "auto" : "manual",
            errorStack: err.stack,
          }
        )
      );

      throw error;
    }
  }
}
