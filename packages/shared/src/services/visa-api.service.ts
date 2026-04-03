import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import * as http from "http";
import * as https from "https";
import {
  VisaCheckResult,
  LocationAvailability,
  Location,
  AvailableDay,
} from "../interfaces/visa-check.interface";
import { VisaGroupStatus } from "../enums/visa-group.enum";

export interface VisaApiLogger {
  log(message: string, ...optionalParams: any[]): void;
  warn(message: string, ...optionalParams: any[]): void;
  error(message: string, ...optionalParams: any[]): void;
  debug?(message: string, ...optionalParams: any[]): void;
}

type FetchLikeResponse = {
  status: number;
  ok: boolean;
  headers: AxiosHeadersAdapter;
};

class AxiosHeadersAdapter implements Iterable<[string, string]> {
  constructor(
    private readonly headers: Record<string, string | string[] | undefined>
  ) {}

  get(name: string): string | null {
    const value = this.headers[name.toLowerCase()];
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }
    return value ?? null;
  }

  has(name: string): boolean {
    return this.headers[name.toLowerCase()] !== undefined;
  }

  entries(): Array<[string, string]> {
    const result: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(this.headers)) {
      if (Array.isArray(value)) {
        value.forEach((v) => {
          result.push([key, v]);
        });
      } else if (value !== undefined) {
        result.push([key, value]);
      }
    }
    return result;
  }

  [Symbol.iterator](): Iterator<[string, string]> {
    return this.entries()[Symbol.iterator]();
  }

  getSetCookie(): string[] {
    const value = this.headers["set-cookie"];
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }
}

export interface VisaApiConfig {
  debug?: boolean;
  baseURL?: string;
  proxyUrl?: string;
}

export type GetVisaAccountGroupsResult = {
  groupId: string;
  cookie: string;
  groups: {
    status: VisaGroupStatus;
    schedulePath: string;
    applicants?: Array<{ ivrNumber: string; name: string }>;
  }[];
};

export abstract class BaseVisaApiService {
  protected readonly logger: VisaApiLogger;
  protected readonly DEBUG: boolean;

  protected readonly baseURL: string;

  protected readonly proxyUrl: string | undefined;
  private readonly proxySanitizedUri?: string;

  // HTTP/HTTPS агенты с keep-alive и connection pooling
  private readonly httpAgent: http.Agent;
  private readonly httpsAgent: https.Agent;

  private readonly NETWORK_ERROR_CODES = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
  ]);

  // Увеличено количество попыток для более надежной работы
  private readonly MAX_FETCH_RETRIES = 5;
  private readonly FETCH_RETRY_BASE_DELAY_MS = 1000; // Увеличена базовая задержка
  private readonly FETCH_RETRY_503_BASE_DELAY_MS = 10000; // Увеличена задержка для 503 ошибок (10 секунд)
  private readonly FETCH_RETRY_STREAM_ABORTED_DELAY_MS = 5000; // Специальная задержка для stream aborted (5 секунд)

  // User-Agent как в рабочем visa-runner.js (Chrome 139)
  private readonly DEFAULT_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

  // Минимальные заголовки как в visa-runner.js (без Sec-Fetch-* и других подозрительных)
  private readonly DEFAULT_HEADERS = {
    "User-Agent": this.DEFAULT_USER_AGENT,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "max-age=0",
    "Upgrade-Insecure-Requests": "1",
  };

  // Маппинг городов на facility IDs
  private readonly LOCATIONS: Location[] = [
    {
      id: "134",
      name: "Astana",
    },
    {
      id: "135",
      name: "Almaty",
    },
  ];

  constructor(logger: VisaApiLogger, config?: VisaApiConfig) {
    this.logger = logger;
    this.DEBUG = config?.debug ?? false;
    this.baseURL = config?.baseURL ?? "https://ais.usvisa-info.com";
    this.proxyUrl = config?.proxyUrl;

    // Создаем HTTP/HTTPS агенты с keep-alive и connection pooling
    // Это позволяет переиспользовать соединения и избежать "stream has been aborted"
    this.httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000, // 30 секунд
      maxSockets: 50, // Максимум одновременных соединений
      maxFreeSockets: 10, // Максимум свободных соединений в пуле
      timeout: 60000, // Таймаут соединения 60 секунд
    });

    this.httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: 60000,
    });

    // Настраиваем HTTPS-прокси, если он указан
    if (this.proxyUrl) {
      const { sanitizedUri, maskedUri } = this._prepareProxyUrl(this.proxyUrl);
      this.proxySanitizedUri = sanitizedUri;
      this.logger.log(
        `🔐 Используется прокси для обхода блокировки IP: ${maskedUri}`
      );
      // Прокси-агент будет создаваться для каждого запроса, чтобы обеспечить ротацию IP
      // (если прокси ротирующий). Keep-alive отключен, чтобы каждое соединение было новым.
    }
  }

  // ============================================
  // Публичные методы (по логике использования)
  // ============================================

  /**
   * Получить список всех доступных локаций
   */
  getLocations(): Location[] {
    return [...this.LOCATIONS];
  }

  /**
   * Авторизация и получение session данных для парсинга
   * Возвращает cookie, scheduleId, locationId для дальнейших запросов
   */
  async authorizeAndGetSession(
    email: string,
    password: string
  ): Promise<{
    cookie: string;
    scheduleId: string;
    locationId: string;
    locationName: string;
    groupId: string;
  }> {
    let cookie = "";
    let csrfToken: string | null = null;
    let groupId: string | null = null;
    let scheduleId: string | null = null;
    let locationId: string | null = null;
    let locationName: string | null = null;

    // 1) signin page
    {
      const {
        res,
        text,
        cookie: c,
      } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/users/sign_in`,
        { method: "GET" },
        cookie
      );
      cookie = c;
      csrfToken = this._extractCsrfTokenFromHtml(text) || csrfToken;
      if (!res.ok && res.status !== 302) {
        throw new Error(`signin page failed: ${res.status}`);
      }
      // Задержка между запросами для снижения нагрузки на сервер и имитации человеческого поведения
      await this._sleep(1000 + Math.random() * 1000); // 1000-2000ms с jitter
    }

    // 2) signin POST
    {
      const body = this._toFormUrlEncoded({
        "user[email]": email,
        "user[password]": password,
        policy_confirmed: "1",
        commit: "Войти",
      });

      const { res, cookie: c } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/users/sign_in`,
        {
          method: "POST",
          headers: {
            Accept:
              "*/*;q=0.5, text/javascript, application/javascript, application/ecmascript, application/x-ecmascript",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Origin: this.baseURL,
            Referer: `${this.baseURL}/ru-kz/niv/users/sign_in`,
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRF-Token": csrfToken,
          },
          body,
        },
        cookie
      );
      cookie = c;

      if (!res.ok && res.status !== 302) {
        throw new Error(`signin POST failed: ${res.status}`);
      }
      // Задержка между запросами
      await this._sleep(500 + Math.random() * 500);
    }

    // 3) account
    {
      const {
        res,
        text,
        cookie: c,
      } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/account`,
        {
          method: "GET",
          headers: { Referer: `${this.baseURL}/ru-kz/niv/users/sign_in` },
        },
        cookie
      );
      cookie = c;

      const href = this._getHrefWithRegex(text);
      groupId = this._extractIdFromUrl(href);
      if (!groupId) {
        const groupsMatch = text.match(/\/ru-kz\/niv\/groups\/(\d+)/);
        if (groupsMatch) {
          groupId = groupsMatch[1];
        }
      }

      if (!groupId) {
        throw new Error("groupId табылмады (account)");
      }
      // Задержка между запросами
      await this._sleep(500 + Math.random() * 500);
    }

    // 4) groups
    {
      const {
        res,
        text,
        cookie: c,
      } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/groups/${groupId}`,
        {
          method: "GET",
          headers: { Referer: `${this.baseURL}/ru-kz/niv/account` },
        },
        cookie
      );
      cookie = c;

      if (!res.ok && res.status !== 302) {
        throw new Error(`groups page failed: ${res.status}`);
      }

      const m = text.match(
        /href="(\/ru-kz\/niv\/schedule\/\d+\/continue_actions)"/
      );
      const schedulePath = m && m[1];
      scheduleId = this._extractIdFromUrl(schedulePath);
      if (!scheduleId) {
        throw new Error("scheduleId табылмады (groups)");
      }
      // Задержка между запросами
      await this._sleep(500 + Math.random() * 500);
    }

    // 5) continue_actions
    {
      const { res, cookie: c } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/continue_actions`,
        {
          method: "GET",
          headers: { Referer: `${this.baseURL}/ru-kz/niv/groups/${groupId}` },
        },
        cookie
      );
      cookie = c;
      if (!res.ok && res.status !== 302) {
        throw new Error(`continue_actions failed: ${res.status}`);
      }
      // Задержка между запросами
      await this._sleep(500 + Math.random() * 500);
    }

    // 6) appointment
    {
      const { res, cookie: c } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment`,
        {
          method: "GET",
          headers: {
            Referer: `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/continue_actions`,
          },
        },
        cookie
      );
      cookie = c;
      if (!res.ok && res.status !== 302) {
        throw new Error(`appointment failed: ${res.status}`);
      }
      // Задержка между запросами
      await this._sleep(500 + Math.random() * 500);
    }

    // 7) appointment_confirmed - получаем locationId
    {
      const url = `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment?confirmed_limit_message=1&commit=Continue`;
      const {
        res,
        text,
        cookie: c,
      } = await this._fetchWithCookies(
        url,
        {
          method: "GET",
          headers: {
            Referer: `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment`,
          },
        },
        cookie
      );
      cookie = c;

      if (!res.ok && res.status !== 302) {
        throw new Error(`appointment_confirmed failed: ${res.status}`);
      }

      // Парсим локации
      const locations: Array<{ id: string; name: string }> = [];
      const optionRegex =
        /<option[^>]*value=["'](\d+)["'][^>]*>([^<]+)<\/option>/gi;
      let match;
      const seen = new Set<string>();
      while ((match = optionRegex.exec(text))) {
        const id = match[1];
        const name = match[2].trim();
        if (id && name && !seen.has(id)) {
          seen.add(id);
          locations.push({ id, name });
        }
      }

      if (!locations.length) {
        throw new Error("Локации не найдены");
      }

      // Берем первую локацию
      locationId = locations[0].id;
      locationName = locations[0].name;
    }

    if (!scheduleId || !locationId || !locationName || !groupId) {
      throw new Error("Не удалось получить все необходимые данные для сессии");
    }

    return {
      cookie,
      scheduleId,
      locationId,
      locationName,
      groupId,
    };
  }

  /**
   * Лёгкая авторизация: возвращает cookie авторизованной сессии.
   *
   * В отличие от authorizeAndGetSession(), НЕ зависит от парсинга локаций
   * (appointment_confirmed), что критично для прогрева сессии под запись.
   */
  async authorizeAndGetCookie(
    email: string,
    password: string
  ): Promise<string> {
    let cookie = "";
    let csrfToken: string | null = null;

    // 0) Получаем начальные cookies (может помочь против 403/редиректов).
    try {
      const { cookie: mainCookie } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv`,
        { method: "GET" },
        cookie
      );
      cookie = mainCookie;
    } catch {
      // Best-effort.
    }

    // 1) signin page
    {
      const {
        res,
        text,
        cookie: c,
      } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/users/sign_in`,
        {
          method: "GET",
          headers: { Referer: `${this.baseURL}/ru-kz/niv` },
        },
        cookie
      );
      cookie = c;
      csrfToken = this._extractCsrfTokenFromHtml(text) || csrfToken;
      if (!res.ok && res.status !== 302) {
        throw new Error(`signin page failed: ${res.status}`);
      }
      await this._sleep(500 + Math.random() * 500);
    }

    // 2) signin POST
    {
      const body = this._toFormUrlEncoded({
        "user[email]": email,
        "user[password]": password,
        policy_confirmed: "1",
        commit: "Войти",
      });

      const {
        res,
        text,
        cookie: c,
      } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/users/sign_in`,
        {
          method: "POST",
          headers: {
            Accept:
              "*/*;q=0.5, text/javascript, application/javascript, application/ecmascript, application/x-ecmascript",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Origin: this.baseURL,
            Referer: `${this.baseURL}/ru-kz/niv/users/sign_in`,
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRF-Token": csrfToken,
          },
          body,
        },
        cookie
      );
      cookie = c;

      if (!res.ok && res.status !== 302) {
        throw new Error(`signin POST failed: ${res.status}, body: ${text}`);
      }
      await this._sleep(500 + Math.random() * 500);
    }

    // 3) account (быстрая проверка, что сессия действительно авторизована)
    {
      const {
        res,
        text,
        cookie: c,
      } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/account`,
        {
          method: "GET",
          headers: { Referer: `${this.baseURL}/ru-kz/niv/users/sign_in` },
        },
        cookie
      );
      cookie = c;

      if (res.status === 302 || res.status === 301) {
        const location = res.headers.get("location") || "";
        if (location.includes("sign_in") || location.includes("login")) {
          throw new Error("signin failed (redirect to login)");
        }
      }
      if (text.includes("sign_in") || text.includes("login")) {
        throw new Error("signin failed (account contains login)");
      }
    }

    return cookie;
  }

  /**
   * Авторизация и получение групп аккаунта
   * Высокоуровневый метод, который включает авторизацию и парсинг групп
   */
  async getVisaAccountGroups(
    email: string,
    password: string
  ): Promise<GetVisaAccountGroupsResult> {
    let cookie = "";
    let csrfToken: string | null = null;
    let groupId: string | null = null;

    // 0) Сначала получаем начальные cookies с главной страницы
    try {
      const { res: mainRes, cookie: mainCookie } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv`,
        { method: "GET" },
        cookie
      );
      cookie = mainCookie;
      if (this.DEBUG && this.logger.debug) {
        this.logger.debug(
          `Main page response: ${mainRes.status}, cookies: ${
            cookie ? "received" : "none"
          }`
        );
      }
    } catch (error) {
      // Игнорируем ошибку главной страницы, продолжаем
      if (this.DEBUG && this.logger.debug) {
        this.logger.debug(
          `Main page fetch failed, continuing: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    // 1) signin page
    {
      const {
        res,
        text,
        cookie: c,
      } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/users/sign_in`,
        {
          method: "GET",
          headers: {
            Referer: `${this.baseURL}/ru-kz/niv`,
          },
        },
        cookie
      );
      cookie = c;
      csrfToken = this._extractCsrfTokenFromHtml(text) || csrfToken;
      if (!res.ok && res.status !== 302) {
        throw new Error(`signin page failed: ${res.status}`);
      }
      // Задержка между запросами
      await this._sleep(500 + Math.random() * 500);
    }

    // 2) signin POST
    {
      const body = this._toFormUrlEncoded({
        "user[email]": email,
        "user[password]": password,
        policy_confirmed: "1",
        commit: "Войти",
      });

      if (this.DEBUG && this.logger.debug) {
        this.logger.debug(
          `Signin POST body: ${body.replace(/(password=)[^&]*/i, "$1***")}`
        );
        this.logger.debug(`CSRF Token: ${csrfToken}`);
      }

      const {
        res,
        text,
        cookie: c,
      } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/users/sign_in`,
        {
          method: "POST",
          headers: {
            Accept:
              "*/*;q=0.5, text/javascript, application/javascript, application/ecmascript, application/x-ecmascript",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Origin: this.baseURL,
            Referer: `${this.baseURL}/ru-kz/niv/users/sign_in`,
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRF-Token": csrfToken,
          },
          body,
        },
        cookie
      );
      cookie = c;

      if (this.DEBUG && this.logger.debug) {
        this.logger.debug(`Signin POST response status: ${res.status}`);
        this.logger.debug(
          `Signin POST response preview: ${text.substring(0, 1000)}`
        );
      }

      if (!res.ok && res.status !== 302) {
        throw new Error(`signin POST failed: ${res.status}, body: ${text}`);
      }
      // Задержка между запросами
      await this._sleep(500 + Math.random() * 500);
    }

    // 3) account
    {
      const {
        res,
        text,
        cookie: c,
      } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/account`,
        {
          method: "GET",
          headers: { Referer: `${this.baseURL}/ru-kz/niv/users/sign_in` },
        },
        cookie
      );
      cookie = c;

      if (this.DEBUG && this.logger.debug) {
        this.logger.debug(`Account page response status: ${res.status}`);
        this.logger.debug(
          `Account page content preview: ${text.substring(0, 2000)}`
        );
      }

      // Проверяем редирект
      if (res.status === 302 || res.status === 301) {
        const location = res.headers.get("location") || "";
        if (location.includes("/groups/")) {
          const groupsMatch = location.match(/\/groups\/(\d+)/);
          if (groupsMatch) {
            groupId = groupsMatch[1];
            this.logger.log(`✅ groupId найден из редиректа: ${groupId}`);
          }
        }
      }

      // Если groupId еще не найден, парсим из HTML
      if (!groupId) {
        // Метод 1: через href в ссылке
        const href = this._getHrefWithRegex(text);
        if (this.DEBUG && this.logger.debug) {
          this.logger.debug(`Found href: ${href}`);
        }
        groupId = this._extractIdFromUrl(href || "");

        // Метод 2: через regex в тексте
        if (!groupId) {
          const groupsMatch = text.match(/\/ru-kz\/niv\/groups\/(\d+)/);
          if (groupsMatch) {
            groupId = groupsMatch[1];
            if (this.DEBUG && this.logger.debug) {
              this.logger.debug(`Found groupId via regex: ${groupId}`);
            }
          }
        }

        // Метод 3: ищем все ссылки на groups
        if (!groupId) {
          const allGroupsMatches = text.matchAll(
            /\/ru-kz\/niv\/groups\/(\d+)/g
          );
          for (const match of allGroupsMatches) {
            if (match[1]) {
              groupId = match[1];
              this.logger.log(
                `✅ groupId найден через множественный поиск: ${groupId}`
              );
              break;
            }
          }
        }

        // Метод 4: ищем в data-атрибутах или других местах
        if (!groupId) {
          const dataGroupMatch = text.match(/data-group-id=["'](\d+)["']/i);
          if (dataGroupMatch) {
            groupId = dataGroupMatch[1];
            this.logger.log(`✅ groupId найден через data-атрибут: ${groupId}`);
          }
        }
      }

      if (!groupId) {
        // Логируем больше информации для отладки
        this.logger.error(`❌ groupId не найден. Статус ответа: ${res.status}`);
        this.logger.error(`URL: ${this.baseURL}/ru-kz/niv/account`);
        this.logger.error(`Content length: ${text.length}`);
        this.logger.error(
          `Content preview (first 3000 chars): ${text.substring(0, 3000)}`
        );

        // Проверяем, не редирект ли это на страницу логина
        if (
          text.includes("sign_in") ||
          text.includes("login") ||
          res.status === 401 ||
          res.status === 403
        ) {
          throw new Error(
            "Авторизация не удалась - редирект на страницу входа"
          );
        }

        throw new Error("groupId табылмады (account)");
      }
      // Задержка между запросами
      await this._sleep(500 + Math.random() * 500);
    }

    // 4) groups
    {
      const {
        res,
        text,
        cookie: c,
      } = await this._fetchWithCookies(
        `${this.baseURL}/ru-kz/niv/groups/${groupId}`,
        {
          method: "GET",
          headers: { Referer: `${this.baseURL}/ru-kz/niv/account` },
        },
        cookie
      );
      cookie = c;
      if (!res.ok && res.status !== 302) {
        throw new Error(`groups page failed: ${res.status}`);
      }

      const groups: GetVisaAccountGroupsResult["groups"] = [];

      // Находим все статусы (учитываем одинарные и двойные кавычки)
      const statusRegex =
        /<h4\s+class=['"]status['"]>[\s\S]*?<small>Текущий статус<\/small>\s*<br[^>]*>\s*([^<]+)/gi;
      const statusMatches: string[] = [];
      let statusMatch;

      while ((statusMatch = statusRegex.exec(text)) !== null) {
        statusMatches.push(statusMatch[1].trim());
      }

      const scheduleRegex =
        /href=["'](\/ru-kz\/niv\/schedule\/\d+\/continue_actions)["']/gi;
      const scheduleMatches: Array<{ path: string; index: number }> = [];
      let scheduleMatch: RegExpExecArray | null;

      while ((scheduleMatch = scheduleRegex.exec(text)) !== null) {
        scheduleMatches.push({
          path: scheduleMatch[1],
          index: scheduleMatch.index ?? 0,
        });
      }

      if (this.DEBUG && this.logger.debug) {
        this.logger.debug(
          `Найдено статусов: ${statusMatches.length}, schedulePath: ${scheduleMatches.length}`
        );
      }

      // Сопоставляем статусы и пути (предполагаем, что они идут в одном порядке)
      const itemsCount = Math.min(statusMatches.length, scheduleMatches.length);

      for (let i = 0; i < itemsCount; i++) {
        const statusText = statusMatches[i];
        const schedulePath = scheduleMatches[i].path;

        let status: VisaGroupStatus;

        if (statusText.includes("Зарегистрировать запись")) {
          status = VisaGroupStatus.Register;
        } else if (statusText.includes("Оплатить консульский сбор")) {
          status = VisaGroupStatus.PayFee;
        } else if (statusText.includes("Прийти по записи")) {
          status = VisaGroupStatus.Attend;
        } else {
          if (this.DEBUG) {
            this.logger.warn(
              `⚠️ Группа #${
                i + 1
              }: неизвестный статус "${statusText}", пропускаем`
            );
          }
          continue;
        }

        groups.push({
          status,
          schedulePath,
          applicants: this._extractApplicantsFromGroupSlice(
            text,
            scheduleMatches,
            i
          ),
        });
      }

      if (groups.length === 0) {
        this.logger.error("Группы не найдены. HTML content:", text);
        throw new Error("Группы не найдены на странице");
      }
      return { groupId, cookie, groups };
    }
  }

  private _extractApplicantsFromGroupSlice(
    fullHtml: string,
    schedules: Array<{ path: string; index: number }>,
    groupIndex: number
  ): Array<{ ivrNumber: string; name: string }> {
    const start = schedules[groupIndex]?.index ?? 0;
    const end =
      groupIndex + 1 < schedules.length
        ? schedules[groupIndex + 1].index
        : fullHtml.length;
    const slice = fullHtml.slice(start, Math.max(start, end));

    const applicants: Array<{ ivrNumber: string; name: string }> = [];
    const seen = new Set<string>();

    // Основной кейс: в одном <tr> есть и IVR number, и имя заявителя в <td>
    const rowRe =
      /<tr[^>]*>[\s\S]*?(?:Номер записи на интерактивном автоответчике:|Номер записи на интерактивном автоответчике\s*:)\s*(\d+)[\s\S]*?<td[^>]*>\s*([^<]+?)\s*<\/td>[\s\S]*?<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(slice)) !== null) {
      const ivr = (m[1] || "").trim();
      const name = this._decodeHtmlEntities((m[2] || "").trim());
      if (!ivr || !name) continue;
      const key = `${ivr}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      applicants.push({ ivrNumber: ivr, name });
    }

    // Fallback: если структура разнесена, пытаемся матчить по порядку
    if (applicants.length === 0) {
      const ivrRe =
        /(?:Номер записи на интерактивном автоответчике:|Номер записи на интерактивном автоответчике\s*:)\s*(\d+)/gi;
      const nameRe = /<td[^>]*>\s*([A-ZА-ЯЁ][^<]{2,100})\s*<\/td>/g;

      const ivrs: string[] = [];
      let mi: RegExpExecArray | null;
      while ((mi = ivrRe.exec(slice)) !== null) {
        const v = (mi[1] || "").trim();
        if (v) ivrs.push(v);
      }

      const names: string[] = [];
      let mn: RegExpExecArray | null;
      while ((mn = nameRe.exec(slice)) !== null) {
        const n = this._decodeHtmlEntities((mn[1] || "").trim());
        // фильтруем шум: слишком короткое/содержит служебные слова
        if (!n || n.length < 3) continue;
        if (n.includes("Текущий статус")) continue;
        names.push(n);
      }

      const count = Math.min(ivrs.length, names.length);
      for (let i = 0; i < count; i++) {
        const key = `${ivrs[i]}:${names[i]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        applicants.push({ ivrNumber: ivrs[i], name: names[i] });
      }
    }

    return applicants;
  }

  private _decodeHtmlEntities(input: string): string {
    return input
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  /**
   * Быстрое получение слотов для одной локации
   * Возвращает days для указанной локации
   */
  async fetchSlotsFast(
    scheduleId: string,
    locationId: string,
    cookie: string
  ): Promise<{
    success: boolean;
    days: Array<{ date: string; business_day: boolean }>;
    error: string | null;
    statusCode: number | null;
    isSessionExpired: boolean;
    cookie: string;
  }> {
    const results = {
      success: false,
      days: [] as Array<{ date: string; business_day: boolean }>,
      error: null as string | null,
      statusCode: null as number | null,
      isSessionExpired: false,
      cookie,
    };

    try {
      const daysUrl = `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment/days/${locationId}.json?appointments[expedite]=false`;
      const {
        res: daysRes,
        text: daysText,
        cookie: updatedCookie,
      } = await this._fetchWithCookies(
        daysUrl,
        {
          method: "GET",
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            Referer: `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment`,
            "X-Requested-With": "XMLHttpRequest",
          },
        },
        cookie
      );

      results.statusCode = daysRes.status;
      results.cookie = updatedCookie;

      if (daysRes.status === 302) {
        const location = daysRes.headers.get("location") || "";
        if (location.includes("sign_in") || location.includes("login")) {
          results.isSessionExpired = true;
          results.error = "Сессия истекла (редирект на login)";
          return results;
        }
      }

      if (daysRes.status === 401 || daysRes.status === 403) {
        results.isSessionExpired = true;
        results.error = `Сессия истекла (статус: ${daysRes.status})`;
        return results;
      }

      if (!daysRes.ok && daysRes.status !== 200) {
        results.error = `Days request failed: ${daysRes.status}`;
        return results;
      }

      let days: Array<{ date: string; business_day: boolean }> = [];
      try {
        const parsed = JSON.parse(daysText);
        days = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        if (daysText.includes("sign_in") || daysText.includes("login")) {
          results.isSessionExpired = true;
          results.error = "Сессия истекла (HTML содержит login)";
          return results;
        }
        results.error = `Days JSON parse error: ${(e as Error).message}`;
        return results;
      }

      results.days = days;
      results.success = true;
      return results;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : "UnknownError";

      let fullStack = errorStack;
      if (!fullStack) {
        fullStack = `Error: ${errorMessage}\n    at fetchSlotsFast (visa.service.ts:${Date.now()})\n    at ${errorName}`;
      }

      const isNetworkError =
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ENOTFOUND") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("ECONNRESET") ||
        errorName === "TypeError";

      if (isNetworkError) {
        results.error = `fetch failed: ${errorMessage}`;
      } else {
        results.error = errorMessage;
      }

      (results as any).errorStack = fullStack;
      (results as any).originalError = error;
      (results as any).errorName = errorName;
      return results;
    }
  }

  /**
   * Получение временных слотов (times) для конкретной даты
   * Возвращает массив доступных времен для указанной даты
   */
  async fetchTimesForDate(
    scheduleId: string,
    locationId: string,
    date: string,
    cookie: string
  ): Promise<{
    success: boolean;
    times: string[];
    error: string | null;
    statusCode: number | null;
    isSessionExpired: boolean;
    cookie: string;
  }> {
    const results = {
      success: false,
      times: [] as string[],
      error: null as string | null,
      statusCode: null as number | null,
      isSessionExpired: false,
      cookie,
    };

    try {
      const timesUrl = `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment/times/${locationId}.json?date=${date}&appointments[expedite]=false`;
      const {
        res: timesRes,
        text: timesText,
        cookie: updatedCookie,
      } = await this._fetchWithCookies(
        timesUrl,
        {
          method: "GET",
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            Referer: `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment`,
            "X-Requested-With": "XMLHttpRequest",
          },
        },
        cookie
      );

      results.statusCode = timesRes.status;
      results.cookie = updatedCookie;

      if (timesRes.status === 302) {
        const location = timesRes.headers.get("location") || "";
        if (location.includes("sign_in") || location.includes("login")) {
          results.isSessionExpired = true;
          results.error = "Сессия истекла (редирект на login)";
          return results;
        }
      }

      if (timesRes.status === 401 || timesRes.status === 403) {
        results.isSessionExpired = true;
        results.error = `Сессия истекла (статус: ${timesRes.status})`;
        return results;
      }

      if (!timesRes.ok && timesRes.status !== 200) {
        results.error = `Times request failed: ${timesRes.status}`;
        return results;
      }

      let times: string[] = [];
      try {
        const parsed = JSON.parse(timesText);
        // API возвращает объект с полем available_times
        if (
          parsed &&
          parsed.available_times &&
          Array.isArray(parsed.available_times)
        ) {
          times = parsed.available_times;
        } else if (Array.isArray(parsed)) {
          // Fallback: если API вернул массив напрямую
          times = parsed;
        } else if (parsed && typeof parsed === "object") {
          // Пробуем найти массив времен в объекте (для совместимости)
          const timesArray = Object.values(parsed).find(
            (val) => Array.isArray(val) && val.length > 0
          );
          if (timesArray && Array.isArray(timesArray)) {
            times = timesArray;
          }
        }
      } catch (e) {
        if (timesText.includes("sign_in") || timesText.includes("login")) {
          results.isSessionExpired = true;
          results.error = "Сессия истекла (HTML содержит login)";
          return results;
        }
        results.error = `Times JSON parse error: ${(e as Error).message}`;
        return results;
      }

      results.times = times;
      results.success = true;
      return results;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : "UnknownError";

      let fullStack = errorStack;
      if (!fullStack) {
        fullStack = `Error: ${errorMessage}\n    at fetchTimesForDate (visa.service.ts:${Date.now()})\n    at ${errorName}`;
      }

      const isNetworkError =
        errorMessage.includes("fetch failed") ||
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("ENOTFOUND") ||
        errorMessage.includes("ETIMEDOUT") ||
        errorMessage.includes("ECONNRESET") ||
        errorName === "TypeError";

      if (isNetworkError) {
        results.error = `fetch failed: ${errorMessage}`;
      } else {
        results.error = errorMessage;
      }

      (results as any).errorStack = fullStack;
      (results as any).originalError = error;
      (results as any).errorName = errorName;
      return results;
    }
  }

  /**
   * Бронирование слота на указанную дату и время
   * Если время не указано, автоматически выбирается самое раннее доступное
   */
  async bookAppointment(params: {
    email: string;
    password: string;
    schedulePath: string;
    facilityId: string;
    date: string;
    time?: string;
  }): Promise<{ success: boolean; message: string; bookedTime?: string }> {
    // Преобразуем название города в facilityId (если пришло название)
    const facilityId = this._getFacilityIdByCity(params.facilityId);

    this.logger.log(
      `🎯 Начинаем запись на слот: facilityId=${facilityId}, дата=${
        params.date
      }, время=${params.time || "автовыбор"}`
    );

    try {
      const result = await this.getVisaAccountGroups(
        params.email,
        params.password
      );
      const { groupId } = result;
      let cookie = result.cookie;
      let csrfToken: string | null = null;

      const scheduleId = this._extractIdFromUrl(params.schedulePath);
      if (!scheduleId) {
        throw new Error("Не удалось извлечь scheduleId из schedulePath");
      }

      this.logger.log(`📋 scheduleId: ${scheduleId}, groupId: ${groupId}`);

      // Если время не указано, используем "00:00" для автовыбора
      const timeToBook = params.time || "00:00";

      // 1) continue_actions (только если еще не прошли этот шаг при получении timeslots)
      if (params.time) {
        this.logger.log("➡️ Переход к continue_actions...");
        const { res, cookie: c } = await this._fetchWithCookies(
          `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/continue_actions`,
          {
            method: "GET",
            headers: {
              Referer: `${this.baseURL}/ru-kz/niv/groups/${groupId}`,
            },
          },
          cookie
        );
        cookie = c;
        if (!res.ok && res.status !== 302) {
          throw new Error(`continue_actions failed: ${res.status}`);
        }
        this.logger.log("✅ Continue actions завершен");
      }

      // 2) appointment GET - получаем CSRF токен (только если еще не прошли этот шаг)
      if (params.time) {
        this.logger.log("📅 Переход к appointment и получение CSRF токена...");
        const {
          res,
          text,
          cookie: c,
        } = await this._fetchWithCookies(
          `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment`,
          {
            method: "GET",
            headers: {
              Referer: `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/continue_actions`,
            },
          },
          cookie
        );
        cookie = c;
        if (!res.ok && res.status !== 302) {
          throw new Error(`appointment GET failed: ${res.status}`);
        }

        csrfToken = this._extractCsrfTokenFromHtml(text);
        if (!csrfToken) {
          this.logger.error(
            "Не удалось найти CSRF токен. HTML превью:",
            text.substring(0, 1000)
          );
          throw new Error("Не удалось извлечь CSRF токен со страницы");
        }
        this.logger.log(
          `✅ CSRF токен получен: ${csrfToken.substring(0, 20)}...`
        );
      } else {
        // При автовыборе времени CSRF токен уже был получен в getTimeslotsOnly
        this.logger.log("📅 Получение CSRF токена для финальной записи...");
        const {
          res,
          text,
          cookie: c,
        } = await this._fetchWithCookies(
          `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment`,
          {
            method: "GET",
            headers: {
              Referer: `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment`,
            },
          },
          cookie
        );
        cookie = c;
        if (!res.ok && res.status !== 302) {
          throw new Error(`appointment GET failed: ${res.status}`);
        }

        csrfToken = this._extractCsrfTokenFromHtml(text);
        if (!csrfToken) {
          this.logger.error(
            "Не удалось найти CSRF токен. HTML превью:",
            text.substring(0, 1000)
          );
          throw new Error("Не удалось извлечь CSRF токен со страницы");
        }
        this.logger.log(
          `✅ CSRF токен получен: ${csrfToken.substring(0, 20)}...`
        );
      }

      // 3) BOOK APPOINTMENT POST
      {
        this.logger.log(
          `📝 Отправка запроса на запись: facilityId=${facilityId}, date=${params.date}, time=${timeToBook}`
        );

        const body = this._toFormUrlEncoded({
          authenticity_token: csrfToken,
          confirmed_limit_message: "1",
          use_consulate_appointment_capacity: "true",
          "appointments[consulate_appointment][facility_id]": facilityId,
          "appointments[consulate_appointment][date]": params.date,
          "appointments[consulate_appointment][time]": timeToBook,
          commit: "Записаться",
        });

        const requestUrl = `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment`;
        const requestHeaders = {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: this.baseURL,
          Referer: `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment`,
          "Cache-Control": "max-age=0",
        };

        const {
          res,
          text,
          cookie: c,
        } = await this._fetchWithCookies(
          requestUrl,
          {
            method: "POST",
            headers: requestHeaders,
            body,
          },
          cookie
        );
        cookie = c;

        this.logger.log(`📊 Статус ответа: ${res.status}`);

        // AIS может вернуть 200 даже при фактическом провале.
        // Поэтому "успех" подтверждаем пост-проверкой: страница appointment + статус группы.
        const looksLikeHttpSuccess = res.status === 302 || res.ok;
        if (!looksLikeHttpSuccess) {
          this.logger.error(
            `❌ Ошибка записи. Статус: ${res.status}, HTML превью:`,
            text.substring(0, 1000)
          );
          return { success: false, message: `Ошибка записи: статус ${res.status}` };
        }

        // Небольшая пауза: иногда AIS обновляет данные не мгновенно.
        await this._sleep(600 + Math.random() * 400);

        const verify = await this._verifyBookingAfterAttempt({
          scheduleId,
          cookie,
          expectedDate: params.date,
          expectedTime: params.time ? timeToBook : undefined,
        });

        if (verify.confirmed) {
          const actual = verify.actualDate
            ? ` (факт: ${verify.actualDate}${verify.actualTime ? ` ${verify.actualTime}` : ""})`
            : "";
          this.logger.log(
            `✅ Запись подтверждена пост-проверкой${verify.groupStatus ? ` (status=${verify.groupStatus})` : ""}${actual}`
          );
          return {
            success: true,
            message: `Успешно записаны на ${params.date} в ${timeToBook} (подтверждено)`,
            bookedTime: timeToBook,
          };
        }

        const actualHint =
          verify.actualDate || verify.actualTime
            ? ` Фактическая запись: ${verify.actualDate || "?"} ${verify.actualTime || "?"}.`
            : "";
        const statusHint = verify.groupStatus
          ? ` Статус группы: ${verify.groupStatus}.`
          : "";

        this.logger.warn(
          `⚠️ AIS вернул ${res.status}, но запись НЕ подтверждена пост-проверкой.${statusHint}${actualHint}`
        );
        return {
          success: false,
          message:
            `AIS вернул ${res.status}, но запись не подтверждена после проверки.` +
            statusHint +
            actualHint,
        };
      }
    } catch (error) {
      this.logger.error(
        `❌ Ошибка записи на слот: ${error.message}`,
        error.stack
      );
      return {
        success: false,
        message: `Ошибка: ${error.message}`,
      };
    }
  }

  /**
   * Получить CSRF токен со страницы appointment для уже авторизованной сессии.
   * Возвращает обновленный cookie (если Set-Cookie прилетел) и csrfToken.
   */
  async getAppointmentCsrfToken(
    scheduleId: string,
    cookie: string
  ): Promise<{ cookie: string; csrfToken: string }> {
    const {
      res,
      text,
      cookie: c,
    } = await this._fetchWithCookies(
      `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment`,
      {
        method: "GET",
        headers: {
          Referer: `${this.baseURL}/ru-kz/niv/schedule/${scheduleId}/appointment`,
        },
      },
      cookie
    );

    if (res.status === 302 || res.status === 301) {
      const location = res.headers.get("location") || "";
      if (location.includes("sign_in") || location.includes("login")) {
        throw new Error("Session expired (redirect to login)");
      }
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Session expired (status: ${res.status})`);
    }

    if (!res.ok && res.status !== 302) {
      throw new Error(`appointment GET failed: ${res.status}`);
    }

    const csrfToken = this._extractCsrfTokenFromHtml(text);
    if (!csrfToken) {
      if (text.includes("sign_in") || text.includes("login")) {
        throw new Error("Session expired (HTML contains login)");
      }
      throw new Error("Failed to extract CSRF token from appointment page");
    }

    return { cookie: c, csrfToken };
  }

  /**
   * Быстрая запись на слот по уже подготовленной сессии (cookie + csrf).
   * В отличие от bookAppointment(), НЕ делает логин/парсинг групп.
   */
  async bookAppointmentWithSession(params: {
    scheduleId: string;
    facilityId: string;
    date: string;
    time: string;
    cookie: string;
    csrfToken: string;
  }): Promise<{ success: boolean; message: string; bookedTime?: string }> {
    const facilityId = this._getFacilityIdByCity(params.facilityId);
    const timeToBook = params.time || "00:00";

    const body = this._toFormUrlEncoded({
      authenticity_token: params.csrfToken,
      confirmed_limit_message: "1",
      use_consulate_appointment_capacity: "true",
      "appointments[consulate_appointment][facility_id]": facilityId,
      "appointments[consulate_appointment][date]": params.date,
      "appointments[consulate_appointment][time]": timeToBook,
      commit: "Записаться",
    });

    const requestUrl = `${this.baseURL}/ru-kz/niv/schedule/${params.scheduleId}/appointment`;
    const requestHeaders = {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: this.baseURL,
      Referer: `${this.baseURL}/ru-kz/niv/schedule/${params.scheduleId}/appointment`,
      "Cache-Control": "max-age=0",
    };

    const { res, text, cookie: updatedCookie } = await this._fetchWithCookies(
      requestUrl,
      {
        method: "POST",
        headers: requestHeaders,
        body,
      },
      params.cookie
    );

    if (res.status === 302) {
      const location = res.headers.get("location") || "";
      if (location.includes("sign_in") || location.includes("login")) {
        return { success: false, message: "Session expired (redirect to login)" };
      }
      // 302 != гарантированный успех — подтверждаем пост-проверкой ниже.
    }

    if (res.status === 401 || res.status === 403) {
      return { success: false, message: `Session expired (status: ${res.status})` };
    }

    if (!(res.status === 302 || res.ok)) {
      const preview = text?.substring(0, 500) || "";
      return { success: false, message: `Ошибка записи: статус ${res.status}. ${preview}` };
    }

    await this._sleep(600 + Math.random() * 400);

    const verify = await this._verifyBookingAfterAttempt({
      scheduleId: params.scheduleId,
      cookie: updatedCookie,
      expectedDate: params.date,
      expectedTime: timeToBook,
    });

    if (verify.confirmed) {
      return {
        success: true,
        message: `Успешно записаны на ${params.date} в ${timeToBook} (подтверждено)`,
        bookedTime: timeToBook,
      };
    }

    const actualHint =
      verify.actualDate || verify.actualTime
        ? ` Фактическая запись: ${verify.actualDate || "?"} ${verify.actualTime || "?"}.`
        : "";
    const statusHint = verify.groupStatus ? ` Статус группы: ${verify.groupStatus}.` : "";
    return {
      success: false,
      message:
        `AIS вернул ${res.status}, но запись не подтверждена после проверки.` +
        statusHint +
        actualHint,
    };
  }

  // ============================================
  // Приватные вспомогательные методы
  // ============================================

  private _parseSetCookieHeader(setCookieHeader: string): string[] {
    if (!setCookieHeader) return [];
    const parts = setCookieHeader.split(/,(?=\s*[^;=\s]+=?)/g);
    return parts.map((p) => p.trim());
  }

  private _mergeCookies(
    existingCookieHeader: string,
    setCookieHeader: string
  ): string {
    const cookieMap: Record<string, string> = {};

    if (existingCookieHeader) {
      existingCookieHeader.split(";").forEach((c) => {
        const trimmed = c.trim();
        if (!trimmed) return;
        const equalIndex = trimmed.indexOf("=");
        if (equalIndex > 0) {
          const k = trimmed.substring(0, equalIndex).trim();
          const v = trimmed.substring(equalIndex + 1).trim();
          if (k && v) {
            cookieMap[k] = v;
          }
        }
      });
    }

    if (setCookieHeader) {
      const setCookies = this._parseSetCookieHeader(setCookieHeader);
      for (const sc of setCookies) {
        const pair = sc.split(";")[0].trim();
        if (!pair) continue;
        const equalIndex = pair.indexOf("=");
        if (equalIndex > 0) {
          const k = pair.substring(0, equalIndex).trim();
          const v = pair.substring(equalIndex + 1).trim();
          if (k && v) {
            cookieMap[k] = v;
          }
        }
      }
    }

    return Object.entries(cookieMap)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  private async _sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private _extractCsrfTokenFromHtml(html: string): string | null {
    const m = html.match(
      /<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i
    );
    return m ? m[1] : null;
  }

  private _extractIdFromUrl(url: string): string | null {
    const match = url && url.match(/\/(\d+)(?:\/|$)/);
    return match ? match[1] : null;
  }

  private _getHrefWithRegex(htmlString: string): string | null {
    const match = htmlString.match(/<a\s+href="([^"]+)"/i);
    return match ? match[1] : null;
  }

  private _prepareProxyUrl(rawProxyUrl: string): {
    sanitizedUri: string;
    maskedUri: string;
  } {
    try {
      const parsed = new URL(rawProxyUrl);
      const originalUsername = parsed.username
        ? decodeURIComponent(parsed.username)
        : "";
      const originalPassword = parsed.password
        ? decodeURIComponent(parsed.password)
        : "";

      if (originalUsername) {
        parsed.username = originalUsername;
      }
      if (originalPassword) {
        parsed.password = originalPassword;
      }

      const maskedUri =
        originalUsername || originalPassword
          ? `${parsed.protocol}//${originalUsername || "proxy"}:${
              originalPassword ? "****" : ""
            }@${parsed.host}`
          : `${parsed.protocol}//${parsed.host}`;

      return {
        sanitizedUri: parsed.toString(),
        maskedUri,
      };
    } catch (error) {
      return {
        sanitizedUri: rawProxyUrl,
        maskedUri: rawProxyUrl.replace(/:[^:@]+@/, ":****@"),
      };
    }
  }

  private _normalizeAxiosHeaders(
    headers: AxiosResponse["headers"]
  ): Record<string, string | string[]> {
    const normalized: Record<string, string | string[]> = {};

    if (!headers) {
      return normalized;
    }

    const assignHeader = (name: string, value: any) => {
      if (value === undefined || value === null) {
        return;
      }
      normalized[name.toLowerCase()] = value;
    };

    const headersAny = headers as any;

    if (headersAny && typeof headersAny.forEach === "function") {
      headersAny.forEach((value: any, name: string) => {
        assignHeader(name, value);
      });
    } else {
      Object.entries(headersAny || {}).forEach(([name, value]) => {
        assignHeader(name, value);
      });
    }

    return normalized;
  }

  private async _fetchWithCookies(
    url: string,
    options: any,
    cookieHeader: string
  ): Promise<{ res: FetchLikeResponse; text: string; cookie: string }> {
    const headers = { ...this.DEFAULT_HEADERS, ...(options?.headers || {}) };
    if (cookieHeader) headers["Cookie"] = cookieHeader;

    if (this.DEBUG && this.logger.debug) {
      const safeHeaders = { ...headers };
      if (safeHeaders["Cookie"]) safeHeaders["Cookie"] = "[COOKIE REDACTED]";
      let bodyPreview = options?.body;
      if (typeof bodyPreview === "string") {
        bodyPreview = bodyPreview
          .replace(/(password=)[^&]*/i, "$1***")
          .slice(0, 400);
      }
    }

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.MAX_FETCH_RETRIES) {
      attempt++;
      try {
        // Для прокси создаем новый агент для каждого запроса (без keep-alive),
        // чтобы обеспечить ротацию IP, если прокси ротирующий
        let httpsAgent = this.httpsAgent;
        if (this.proxySanitizedUri) {
          // Создаем новый прокси-агент без keep-alive для каждого запроса
          // Это заставляет прокси использовать новое соединение и, возможно, новый IP
          httpsAgent = new HttpsProxyAgent<string>(this.proxySanitizedUri, {
            keepAlive: false, // Отключаем keep-alive для ротации IP
            timeout: 60000,
          } as any);
        }

        const axiosConfig: AxiosRequestConfig = {
          url,
          method: (options?.method || "GET") as AxiosRequestConfig["method"],
          headers,
          data: options?.body,
          maxRedirects: 0,
          validateStatus: () => true,
          timeout: 60000, // Увеличено до 60 секунд для более надежной работы
          responseType: "text",
          proxy: false,
          httpAgent: this.httpAgent,
          httpsAgent: httpsAgent,
        };

        const response: AxiosResponse<string> = await axios.request(
          axiosConfig
        );

        const headersWrapper = new AxiosHeadersAdapter(
          this._normalizeAxiosHeaders(response.headers)
        );

        const setCookieHeader =
          headersWrapper.getSetCookie().length > 0
            ? headersWrapper.getSetCookie().join(", ")
            : "";

        const mergedCookie = this._mergeCookies(
          cookieHeader || "",
          setCookieHeader
        );

        if (this.DEBUG && this.logger.debug) {
          const headersObj: Record<string, string> = {};
          for (const [k, v] of headersWrapper) headersObj[k] = v;
          this.logger.debug(
            `📡 fetchWithCookies: ${url} -> ${
              response.status
            }, cookies updated: ${!!setCookieHeader}`
          );
        }

        // Обрабатываем 503/502/504 ошибки с retry
        if (
          response.status === 503 ||
          response.status === 502 ||
          response.status === 504
        ) {
          const isLastAttempt = attempt >= this.MAX_FETCH_RETRIES;
          if (!isLastAttempt) {
            // Экспоненциальная задержка с jitter (случайным отклонением) для менее предсказуемого паттерна
            const baseDelay =
              this.FETCH_RETRY_503_BASE_DELAY_MS * Math.pow(2, attempt - 1);
            const jitter = Math.random() * 0.3 * baseDelay; // ±30% случайного отклонения
            const delayMs = Math.floor(baseDelay + jitter);
            this.logger.warn(
              `⚠️ Получен статус ${response.status} для ${url}, повтор через ${delayMs}мс (попытка ${attempt}/${this.MAX_FETCH_RETRIES})`
            );
            await this._sleep(delayMs);
            continue; // Повторяем запрос
          } else {
            // Последняя попытка - выбрасываем ошибку, чтобы она не доходила до проверки res.ok
            this.logger.error(
              `❌ Все попытки исчерпаны: статус ${response.status} для ${url} после ${this.MAX_FETCH_RETRIES} попыток`
            );
            throw new Error(
              `Service unavailable: ${response.status} for ${url} after ${this.MAX_FETCH_RETRIES} retries`
            );
          }
        }

        return {
          res: {
            status: response.status,
            ok: response.status >= 200 && response.status < 300,
            headers: headersWrapper,
          },
          text:
            typeof response.data === "string"
              ? response.data
              : JSON.stringify(response.data),
          cookie: mergedCookie,
        };
      } catch (error) {
        lastError = this._enhanceFetchError(url, error);
        if (
          attempt >= this.MAX_FETCH_RETRIES ||
          !this._shouldRetryFetchError(error)
        ) {
          throw lastError;
        }

        // Определяем задержку в зависимости от типа ошибки
        let delayMs: number;
        const errorMessage = (
          error instanceof Error ? error.message : String(error)
        ).toLowerCase();

        if (
          errorMessage.includes("stream has been aborted") ||
          errorMessage.includes("aborted")
        ) {
          // Для "stream aborted" используем специальную задержку с jitter
          const baseDelay =
            this.FETCH_RETRY_STREAM_ABORTED_DELAY_MS * Math.pow(2, attempt - 1);
          const jitter = Math.random() * 0.3 * baseDelay; // ±30% случайного отклонения
          delayMs = Math.floor(baseDelay + jitter);
        } else {
          // Для других сетевых ошибок - экспоненциальная задержка с jitter
          const baseDelay =
            this.FETCH_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          const jitter = Math.random() * 0.3 * baseDelay; // ±30% случайного отклонения
          delayMs = Math.floor(baseDelay + jitter);
        }

        this.logger.warn(
          `⚠️ Сетевая ошибка для ${url} (попытка ${attempt}/${this.MAX_FETCH_RETRIES}), повтор через ${delayMs}мс: ${errorMessage}`
        );
        await this._sleep(delayMs);
      }
    }

    throw lastError ?? new Error(`Fetch failed for ${url}`);
  }

  private _enhanceFetchError(url: string, error: unknown): Error {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const errorMessage = errorObj.message || String(error);
    const errorCode =
      (errorObj as any).code ||
      (errorObj as any).errno ||
      (errorObj as any)?.cause?.code ||
      null;

    const errorWithContext = new Error(
      `Fetch failed for ${url}: ${errorMessage}`
    );
    errorWithContext.stack = errorObj.stack;
    (errorWithContext as any).cause = errorObj;
    (errorWithContext as any).code = errorCode;
    errorWithContext.name = errorObj.name || "FetchError";

    if (errorCode === "ECONNREFUSED") {
      errorWithContext.message = `Connection refused: ${url}`;
    } else if (errorCode === "ENOTFOUND" || errorCode === "EAI_AGAIN") {
      errorWithContext.message = `DNS lookup failed: ${url}`;
    } else if (
      errorCode === "ETIMEDOUT" ||
      errorCode === "ECONNRESET" ||
      errorCode === "UND_ERR_CONNECT_TIMEOUT"
    ) {
      errorWithContext.message = `Connection timeout/reset: ${url}`;
    }

    return errorWithContext;
  }

  private _shouldRetryFetchError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const code =
      (error as any).code ||
      (error as any).errno ||
      (error as any)?.cause?.code ||
      null;

    if (code && this.NETWORK_ERROR_CODES.has(String(code))) {
      return true;
    }

    const message = (error.message || "").toLowerCase();
    return (
      message.includes("fetch failed") ||
      message.includes("network") ||
      message.includes("socket hang up") ||
      message.includes("protocol error") ||
      message.includes("stream has been aborted") ||
      message.includes("aborted") ||
      message.includes("econnreset") ||
      message.includes("econnrefused") ||
      message.includes("timeout") ||
      message.includes("econnreset") ||
      message.includes("socket") ||
      message.includes("connection") ||
      (error as any).name === "AxiosError" // Все ошибки axios считаем retryable
    );
  }

  private _toFormUrlEncoded(data: Record<string, string>): string {
    return Object.entries(data)
      .map(
        ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? "")}`
      )
      .join("&");
  }

  /**
   * Находит facility ID по названию города (case-insensitive)
   * Если передан числовой ID, проверяет его валидность и возвращает как есть
   */
  private _getFacilityIdByCity(cityNameOrId: string): string {
    const trimmed = cityNameOrId.trim();

    const locationById = this.LOCATIONS.find((loc) => loc.id === trimmed);
    if (locationById) {
      return trimmed;
    }

    const normalizedCity = trimmed.toLowerCase();
    const locationByName = this.LOCATIONS.find(
      (loc) => loc.name.toLowerCase() === normalizedCity
    );

    if (!locationByName) {
      const availableCities = this.LOCATIONS.map(
        (loc) => `${loc.name} (ID: ${loc.id})`
      ).join(", ");
      throw new Error(
        `Город или ID "${cityNameOrId}" не найден. Доступные варианты: ${availableCities}`
      );
    }

    return locationByName.id;
  }

  private _extractAppointmentFromHtml(
    html: string
  ): { date: string | null; time: string | null } {
    const safeHtml = html || "";

    // Пробуем найти значения input (часто присутствуют на форме appointment).
    const inputDate =
      safeHtml.match(
        /name=["']appointments\[consulate_appointment\]\[date\]["'][^>]*value=["'](\d{4}-\d{2}-\d{2})["']/i
      )?.[1] || null;
    const inputTime =
      safeHtml.match(
        /name=["']appointments\[consulate_appointment\]\[time\]["'][^>]*value=["'](\d{2}:\d{2})["']/i
      )?.[1] || null;

    // Если форма скрыта/нет input — пробуем вытащить из текста рядом с ключевыми фразами.
    const keywords = [
      "Ваша запись",
      "назначена",
      "подтвержден",
      "подтверждена",
      "Appointment",
      "scheduled",
    ];

    let bestSlice = safeHtml;
    for (const kw of keywords) {
      const idx = safeHtml.toLowerCase().indexOf(kw.toLowerCase());
      if (idx >= 0) {
        bestSlice = safeHtml.slice(Math.max(0, idx - 500), idx + 2500);
        break;
      }
    }

    const sliceDate = bestSlice.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] || null;
    const sliceTime = bestSlice.match(/\b(\d{2}:\d{2})\b/)?.[1] || null;

    return {
      date: inputDate || sliceDate,
      time: inputTime || sliceTime,
    };
  }

  private async _getAppointmentPage(params: {
    scheduleId: string;
    cookie: string;
  }): Promise<{ cookie: string; html: string }> {
    const { res, text, cookie: c } = await this._fetchWithCookies(
      `${this.baseURL}/ru-kz/niv/schedule/${params.scheduleId}/appointment`,
      {
        method: "GET",
        headers: {
          Referer: `${this.baseURL}/ru-kz/niv/schedule/${params.scheduleId}/appointment`,
        },
      },
      params.cookie
    );

    if (res.status === 302 || res.status === 301) {
      const location = res.headers.get("location") || "";
      if (location.includes("sign_in") || location.includes("login")) {
        throw new Error("Session expired while verifying booking (redirect to login)");
      }
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Session expired while verifying booking (status: ${res.status})`);
    }
    if (!res.ok && res.status !== 302) {
      throw new Error(`Failed to load appointment page for verify: ${res.status}`);
    }
    return { cookie: c, html: text };
  }

  private async _getAccountGroupId(cookie: string): Promise<{ cookie: string; groupId: string }> {
    const { res, text, cookie: c } = await this._fetchWithCookies(
      `${this.baseURL}/ru-kz/niv/account`,
      {
        method: "GET",
        headers: { Referer: `${this.baseURL}/ru-kz/niv` },
      },
      cookie
    );

    // groupId может прийти редиректом
    if (res.status === 302 || res.status === 301) {
      const location = res.headers.get("location") || "";
      if (location.includes("/groups/")) {
        const groupsMatch = location.match(/\/groups\/(\d+)/);
        if (groupsMatch?.[1]) {
          return { cookie: c, groupId: groupsMatch[1] };
        }
      }
      if (location.includes("sign_in") || location.includes("login")) {
        throw new Error("Session expired while verifying booking (account redirect to login)");
      }
    }

    if (!res.ok && res.status !== 302) {
      throw new Error(`account page failed: ${res.status}`);
    }

    const href = this._getHrefWithRegex(text);
    let groupId = this._extractIdFromUrl(href || "");
    if (!groupId) {
      const m = text.match(/\/ru-kz\/niv\/groups\/(\d+)/);
      groupId = m?.[1] || null;
    }
    if (!groupId) {
      throw new Error("groupId не найден (account verify)");
    }
    return { cookie: c, groupId };
  }

  private _parseGroupsFromHtml(text: string): Array<{
    status: VisaGroupStatus;
    schedulePath: string;
  }> {
    const statusRegex =
      /<h4\s+class=['"]status['"]>[\s\S]*?<small>Текущий статус<\/small>\s*<br[^>]*>\s*([^<]+)/gi;
    const statusMatches: string[] = [];
    let statusMatch: RegExpExecArray | null;
    while ((statusMatch = statusRegex.exec(text)) !== null) {
      statusMatches.push(statusMatch[1].trim());
    }

    const scheduleRegex =
      /href=["'](\/ru-kz\/niv\/schedule\/\d+\/continue_actions)["']/gi;
    const scheduleMatches: Array<{ path: string; index: number }> = [];
    let scheduleMatch: RegExpExecArray | null;
    while ((scheduleMatch = scheduleRegex.exec(text)) !== null) {
      scheduleMatches.push({
        path: scheduleMatch[1],
        index: scheduleMatch.index ?? 0,
      });
    }

    const groups: Array<{ status: VisaGroupStatus; schedulePath: string }> = [];
    const itemsCount = Math.min(statusMatches.length, scheduleMatches.length);

    for (let i = 0; i < itemsCount; i++) {
      const statusText = statusMatches[i];
      const schedulePath = scheduleMatches[i].path;

      let status: VisaGroupStatus | null = null;
      if (statusText.includes("Зарегистрировать запись")) {
        status = VisaGroupStatus.Register;
      } else if (statusText.includes("Оплатить консульский сбор")) {
        status = VisaGroupStatus.PayFee;
      } else if (statusText.includes("Прийти по записи")) {
        status = VisaGroupStatus.Attend;
      }

      if (!status) continue;
      groups.push({ status, schedulePath });
    }

    return groups;
  }

  private async _getGroupStatusForScheduleIdFromCookie(params: {
    cookie: string;
    scheduleId: string;
  }): Promise<{ cookie: string; status: VisaGroupStatus | null }> {
    const { cookie: c1, groupId } = await this._getAccountGroupId(params.cookie);

    const { res, text, cookie: c2 } = await this._fetchWithCookies(
      `${this.baseURL}/ru-kz/niv/groups/${groupId}`,
      {
        method: "GET",
        headers: { Referer: `${this.baseURL}/ru-kz/niv/account` },
      },
      c1
    );

    if (res.status === 302 || res.status === 301) {
      const location = res.headers.get("location") || "";
      if (location.includes("sign_in") || location.includes("login")) {
        throw new Error("Session expired while verifying booking (groups redirect to login)");
      }
    }
    if (!res.ok && res.status !== 302) {
      throw new Error(`groups page failed: ${res.status}`);
    }

    const groups = this._parseGroupsFromHtml(text);
    const needle = `/ru-kz/niv/schedule/${params.scheduleId}/continue_actions`;
    const found = groups.find((g) => g.schedulePath.includes(needle));
    return { cookie: c2, status: found?.status ?? null };
  }

  private async _verifyBookingAfterAttempt(params: {
    scheduleId: string;
    cookie: string;
    expectedDate: string;
    expectedTime?: string; // если не задан — проверяем только дату (для автовыбора времени)
  }): Promise<{
    confirmed: boolean;
    actualDate: string | null;
    actualTime: string | null;
    groupStatus: VisaGroupStatus | null;
  }> {
    // 1) Пытаемся извлечь фактическую запись со страницы appointment.
    try {
      const { cookie: c, html } = await this._getAppointmentPage({
        scheduleId: params.scheduleId,
        cookie: params.cookie,
      });
      const appt = this._extractAppointmentFromHtml(html);
      const dateOk = appt.date ? appt.date === params.expectedDate : false;
      const timeOk = params.expectedTime
        ? appt.time
          ? appt.time === params.expectedTime
          : false
        : true;

      // Если удалось достать дату и она совпала — считаем подтверждением.
      if (dateOk && timeOk) {
        return {
          confirmed: true,
          actualDate: appt.date,
          actualTime: appt.time,
          groupStatus: null,
        };
      }

      // Если дата есть, но не совпала — это важный сигнал: успех ложный или запись на другое время/дату.
      if (appt.date) {
        return {
          confirmed: false,
          actualDate: appt.date,
          actualTime: appt.time,
          groupStatus: null,
        };
      }

      // Если не смогли извлечь дату — продолжаем проверкой статуса группы.
      params = { ...params, cookie: c };
    } catch (e) {
      // Fallback ниже: статус группы.
      if (this.DEBUG && this.logger.debug) {
        const err = e instanceof Error ? e : new Error(String(e));
        this.logger.debug(`verifyBooking: appointment page check failed: ${err.message}`);
      }
    }

    // 2) Проверка статуса группы (Attend).
    try {
      const { status } = await this._getGroupStatusForScheduleIdFromCookie({
        cookie: params.cookie,
        scheduleId: params.scheduleId,
      });

      return {
        confirmed: status === VisaGroupStatus.Attend,
        actualDate: null,
        actualTime: null,
        groupStatus: status,
      };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.warn(`verifyBooking: group status check failed: ${err.message}`);
      return {
        confirmed: false,
        actualDate: null,
        actualTime: null,
        groupStatus: null,
      };
    }
  }
}
