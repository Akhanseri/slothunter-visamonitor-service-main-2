import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Client, ClientSession, ClientVisaGroup } from "@visa-monitor/shared";
import { VisaModule } from "../visa/visa.module";
import { CryptoService } from "./crypto.service";
import { SessionStoreService } from "./session-store.service";
import { SessionWarmerService } from "./session-warmer.service";

@Module({
  imports: [
    VisaModule,
    TypeOrmModule.forFeature([Client, ClientVisaGroup, ClientSession]),
  ],
  providers: [CryptoService, SessionStoreService, SessionWarmerService],
  exports: [SessionStoreService, SessionWarmerService],
})
export class SessionsModule {}


