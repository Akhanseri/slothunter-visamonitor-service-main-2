import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Client, ClientVisaGroup } from "@visa-monitor/shared";
import { VisaService } from "../visa/visa.service";
import { SessionStoreService } from "./session-store.service";

type ScheduleKey = {
  clientId: number;
  scheduleId: string;
};

@Injectable()
export class SessionWarmerService implements OnModuleInit {
  private readonly logger = new Logger(SessionWarmerService.name);

  private readonly intervalMs: number;
  private readonly ttlMs: number;
  private readonly minTtlMs: number;

  constructor(
    private readonly visaService: VisaService,
    private readonly store: SessionStoreService,
    @InjectRepository(Client)
    private readonly clientRepo: Repository<Client>,
    @InjectRepository(ClientVisaGroup)
    private readonly groupRepo: Repository<ClientVisaGroup>
  ) {
    this.intervalMs = this._readInt(
      "SESSION_WARMER_INTERVAL_MS",
      30 * 60 * 1000
    );
    this.ttlMs = this._readInt("SESSION_TTL_MS", 45 * 60 * 1000);
    this.minTtlMs = this._readInt("SESSION_MIN_TTL_MS", 5 * 60 * 1000);
  }

  async onModuleInit(): Promise<void> {
    if (this.intervalMs <= 0) {
      this.logger.warn(
        "Session warmer disabled (SESSION_WARMER_INTERVAL_MS<=0)"
      );
      return;
    }

    // First warm shortly after startup.
    setTimeout(() => void this._warmAll().catch(() => undefined), 2000);

    setInterval(
      () => void this._warmAll().catch(() => undefined),
      this.intervalMs
    );
    this.logger.log(
      `Session warmer started: interval=${this.intervalMs}ms ttl=${this.ttlMs}ms minTtl=${this.minTtlMs}ms`
    );
  }

  async ensureWarmSession(params: {
    client: Client;
    scheduleId: string;
    force?: boolean;
    throwOnError?: boolean;
  }): Promise<{ cookie: string; csrfToken: string } | null> {
    const { client, scheduleId } = params;
    if (!client.isActive) return null;

    if (!params.force) {
      const existing = await this.store.getValidSession(
        client.id,
        scheduleId,
        this.minTtlMs
      );
      if (existing) {
        return { cookie: existing.cookie, csrfToken: existing.csrfToken };
      }
    }

    // Try refresh using existing cookie first (cheap) is handled by getValidSession;
    // if no session or expired, do full login (expensive).
    try {
      const cookie = await this.visaService.authorizeAndGetCookie(
        client.email,
        client.password
      );
      const csrf = await this.visaService.getAppointmentCsrfToken(
        scheduleId,
        cookie
      );

      await this.store.upsertSession({
        clientId: client.id,
        scheduleId,
        cookie: csrf.cookie,
        csrfToken: csrf.csrfToken,
        ttlMs: this.ttlMs,
        lastError: null,
      });

      return { cookie: csrf.cookie, csrfToken: csrf.csrfToken };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.store.setError(client.id, scheduleId, msg);
      this.logger.warn(
        `Failed to warm session clientId=${client.id} scheduleId=${scheduleId}: ${msg}`
      );
      if (params.throwOnError) {
        throw new Error(msg);
      }
      return null;
    }
  }

  private async _warmAll(): Promise<void> {
    const parserType = String(process.env.PARSER_TYPE || "")
      .toLowerCase()
      .trim();
    const isResident =
      parserType === "resident"
        ? true
        : parserType === "non-resident"
          ? false
          : null;
    if (isResident === null) {
      this.logger.warn("Skip warming: PARSER_TYPE is not set correctly");
      return;
    }

    const keys = await this._collectScheduleKeys(isResident);
    if (keys.length === 0) return;

    this.logger.log(`Warming sessions: ${keys.length} schedule keys`);

    // Conservative concurrency to avoid rate limits.
    const concurrency = 2;
    for (let i = 0; i < keys.length; i += concurrency) {
      const batch = keys.slice(i, i + concurrency);
      await Promise.allSettled(
        batch.map(async (k) => {
          const client = await this.clientRepo.findOne({
            where: { id: k.clientId, isActive: true, isResident },
          });
          if (!client) return;
          await this.ensureWarmSession({ client, scheduleId: k.scheduleId });
        })
      );
    }
  }

  private async _collectScheduleKeys(
    isResident: boolean
  ): Promise<ScheduleKey[]> {
    const groups = await this.groupRepo
      .createQueryBuilder("g")
      .innerJoin("g.client", "c")
      .where("g.is_active = true")
      .andWhere('c."isActive" = true')
      .andWhere('c."isResident" = :isResident', { isResident })
      .andWhere("g.schedule_path IS NOT NULL")
      .andWhere("g.schedule_path <> ''")
      .select(["g.clientId", "g.schedulePath"])
      .getMany();

    const seen = new Set<string>();
    const keys: ScheduleKey[] = [];
    for (const g of groups) {
      const scheduleId = this._extractScheduleId(g.schedulePath);
      if (!scheduleId) continue;
      const k = `${g.clientId}:${scheduleId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      keys.push({ clientId: g.clientId, scheduleId });
    }
    return keys;
  }

  private _extractScheduleId(schedulePath: string): string | null {
    const m = schedulePath.match(/\/schedule\/(\d+)\//);
    return m?.[1] || null;
  }

  private _readInt(name: string, def: number): number {
    const raw = String(process.env[name] || "").trim();
    if (!raw) return def;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : def;
  }
}
