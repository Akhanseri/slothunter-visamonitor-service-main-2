import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BaseVisaApiService,
  VisaApiLogger,
  VisaApiConfig,
} from "@visa-monitor/shared";

@Injectable()
export class VisaService extends BaseVisaApiService {
  constructor(private readonly configService: ConfigService) {
    const loggerInstance = new Logger(VisaService.name);

    const logger: VisaApiLogger = {
      log: (message: string, ...optionalParams: any[]) => {
        loggerInstance.log(message, ...optionalParams);
      },
      warn: (message: string, ...optionalParams: any[]) => {
        loggerInstance.warn(message, ...optionalParams);
      },
      error: (message: string, ...optionalParams: any[]) => {
        loggerInstance.error(message, ...optionalParams);
      },
      debug: (message: string, ...optionalParams: any[]) => {
        loggerInstance.debug?.(message, ...optionalParams);
      },
    };

    const config: VisaApiConfig = {
      debug:
        String(configService.get<string>("DEBUG_VISA_RUNNER") || "").trim() ===
        "1",
      baseURL: "https://ais.usvisa-info.com",
      proxyUrl: configService.get<string>("PROXY_URL"),
    };

    super(logger, config);
  }
}
