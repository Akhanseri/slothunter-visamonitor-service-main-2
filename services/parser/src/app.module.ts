import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Client, ClientVisaGroup, ClientSession, VisaLog } from "@visa-monitor/shared";

import { SchedulerModule } from "./scheduler/scheduler.module";
import { VisaModule } from "./visa/visa.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { HealthModule } from "./health.module";
import { SessionsModule } from "./sessions/sessions.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // В Docker/production используем только переменные окружения
      // В dev читаем локальный .env.local файл
      envFilePath:
        process.env.NODE_ENV === "production" ? undefined : ".env.local",
    }),
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT) || 5432,
      username: process.env.DB_USERNAME || "postgres",
      password: process.env.DB_PASSWORD || "password",
      database: process.env.DB_DATABASE || "visa_monitor",
      entities: [Client, ClientVisaGroup, ClientSession, VisaLog],
      synchronize: process.env.NODE_ENV === "production" ? false : true,
      logging: process.env.NODE_ENV === "production" ? false : true,
    }),
    SchedulerModule,
    VisaModule,
    NotificationsModule,
    SessionsModule,
    HealthModule,
  ],
})
export class AppModule {}
