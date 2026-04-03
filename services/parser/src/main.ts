import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

// Полифилл для crypto в старых версиях Node.js
if (!globalThis.crypto) {
  globalThis.crypto = require("crypto").webcrypto;
}

async function bootstrap() {
  const logLevels = process.env.LOG_LEVEL
    ? process.env.LOG_LEVEL.split(",")
    : ["error", "warn", "log"];

  const app = await NestFactory.create(AppModule, {
    logger: logLevels as any,
  });

  // Парсер не нужен в публичной сети, но оставляем порт для health check
  const port = process.env.PORT || 8991;
  await app.listen(port, "0.0.0.0");

  console.log(
    `Parser сервис запущен на порту ${port} (0.0.0.0:${port})`
  );
  console.log(`Режим: ${process.env.PARSER_TYPE || "all"}`);
}
bootstrap();

