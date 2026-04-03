import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ClientsService } from "./clients.service";
import { ClientsController } from "./clients.controller";
import { Client, ClientVisaGroup } from "@visa-monitor/shared";
import { VisaModule } from "../visa/visa.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Client, ClientVisaGroup]),
    forwardRef(() => VisaModule),
    NotificationsModule,
  ],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
