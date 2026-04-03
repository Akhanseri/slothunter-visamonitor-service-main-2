import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ClientSession } from "@visa-monitor/shared";
import { CryptoService } from "./crypto.service";

export type DecryptedClientSession = {
  clientId: number;
  scheduleId: string;
  cookie: string;
  csrfToken: string;
  expiresAt: Date;
};

@Injectable()
export class SessionStoreService {
  private readonly logger = new Logger(SessionStoreService.name);

  constructor(
    private readonly crypto: CryptoService,
    @InjectRepository(ClientSession)
    private readonly sessionRepo: Repository<ClientSession>
  ) {}

  async getValidSession(
    clientId: number,
    scheduleId: string,
    minTtlMs: number
  ): Promise<DecryptedClientSession | null> {
    const now = Date.now();
    const row = await this.sessionRepo.findOne({
      where: { clientId, scheduleId },
    });
    if (!row) return null;
    if (row.expiresAt.getTime() < now + minTtlMs) return null;
    try {
      return {
        clientId: row.clientId,
        scheduleId: row.scheduleId,
        cookie: this.crypto.decrypt(row.cookieEnc),
        csrfToken: this.crypto.decrypt(row.csrfEnc),
        expiresAt: row.expiresAt,
      };
    } catch (e) {
      this.logger.warn(
        `Failed to decrypt session clientId=${clientId} scheduleId=${scheduleId}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
      return null;
    }
  }

  async upsertSession(params: {
    clientId: number;
    scheduleId: string;
    cookie: string;
    csrfToken: string;
    ttlMs: number;
    lastError?: string | null;
  }): Promise<void> {
    const expiresAt = new Date(Date.now() + params.ttlMs);
    const entity = this.sessionRepo.create({
      clientId: params.clientId,
      scheduleId: params.scheduleId,
      cookieEnc: this.crypto.encrypt(params.cookie),
      csrfEnc: this.crypto.encrypt(params.csrfToken),
      expiresAt,
      lastError: params.lastError ?? null,
    });

    await this.sessionRepo.upsert(entity, ["clientId", "scheduleId"]);
  }

  async setError(
    clientId: number,
    scheduleId: string,
    error: string
  ): Promise<void> {
    const updated = await this.sessionRepo
      .createQueryBuilder()
      .update(ClientSession)
      .set({ lastError: error })
      .where("client_id = :clientId", { clientId })
      .andWhere("schedule_id = :scheduleId", { scheduleId })
      .execute();

    if (updated.affected && updated.affected > 0) return;

    // Если записи ещё нет (первый прогрев и он сразу упал), создаём "пустую"
    // запись, чтобы lastError был сохранён и виден в диагностике.
    await this.sessionRepo
      .createQueryBuilder()
      .insert()
      .into(ClientSession)
      .values({
        clientId,
        scheduleId,
        cookieEnc: this.crypto.encrypt(""),
        csrfEnc: this.crypto.encrypt(""),
        expiresAt: new Date(0),
        lastError: error,
      })
      .orIgnore()
      .execute();

    // На случай гонки: если insert проигнорировался, повторяем update.
    await this.sessionRepo
      .createQueryBuilder()
      .update(ClientSession)
      .set({ lastError: error })
      .where("client_id = :clientId", { clientId })
      .andWhere("schedule_id = :scheduleId", { scheduleId })
      .execute();
  }
}
