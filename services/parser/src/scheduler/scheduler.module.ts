import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Client, ClientVisaGroup, VisaLog } from "@visa-monitor/shared";
import { VisaSchedulerProcessor } from "./visa-scheduler.processor";
import { ClientQueueManager } from "./client-queue.manager";
import { VisaModule } from "../visa/visa.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { SessionsModule } from "../sessions/sessions.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Client, ClientVisaGroup, VisaLog]),
    forwardRef(() => VisaModule),
    NotificationsModule,
    SessionsModule,
  ],
  providers: [VisaSchedulerProcessor, ClientQueueManager],
  exports: [ClientQueueManager],
})
export class SchedulerModule {}

