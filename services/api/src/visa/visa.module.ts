import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { VisaService } from "./visa.service";

import { VisaLogsController } from "./visa-logs.controller";
import { ClientsModule } from "../clients/clients.module";
import { VisaLog } from "@visa-monitor/shared";

@Module({
  imports: [
    forwardRef(() => ClientsModule),
    TypeOrmModule.forFeature([VisaLog]),
  ],
  controllers: [VisaLogsController],
  providers: [VisaService],
  exports: [VisaService],
})
export class VisaModule {}
