import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { VisaService } from "./visa.service";
import { SlotMatcherService } from "./slot-matcher.service";
import { VisaLog } from "@visa-monitor/shared";

@Module({
  imports: [TypeOrmModule.forFeature([VisaLog])],
  providers: [VisaService, SlotMatcherService],
  exports: [VisaService, SlotMatcherService],
})
export class VisaModule {}

