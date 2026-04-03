import "reflect-metadata";
import { DataSource } from "typeorm";
import { Client } from "./entities/client.entity";
import { ClientVisaGroup } from "./entities/client-visa-group.entity";
import { ClientSession } from "./entities/client-session.entity";
import { VisaLog } from "./entities/visa-log.entity";
import * as path from "path";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USERNAME || "postgres",
  password: process.env.DB_PASSWORD || "password",
  database: process.env.DB_DATABASE || "visa_monitor",
  entities: [Client, ClientVisaGroup, ClientSession, VisaLog],
  migrations: [path.join(__dirname, "migrations", "*.{ts,js}")],
  synchronize: false,
  logging: true,
});



