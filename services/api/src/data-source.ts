import { DataSource } from "typeorm";
import { config } from "dotenv";
import { resolve } from "path";
import { Client, ClientVisaGroup, ClientSession, VisaLog } from "@visa-monitor/shared";

// Загружаем .env.production если он существует
config({ path: resolve(__dirname, "../../../.env.production") });

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USERNAME || "postgres",
  password: process.env.DB_PASSWORD || "password",
  database: process.env.DB_DATABASE || "visa_monitor",
  entities: [Client, ClientVisaGroup, ClientSession, VisaLog],
  migrations: [resolve(__dirname, "./migrations/*.ts")],
  synchronize: false,
  logging: false,
});
