import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";

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

  app.setGlobalPrefix("api");

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    })
  );

  const config = new DocumentBuilder()
    .setTitle("Visa Monitor API")
    .setDescription("Visa Monitor жүйесінің API документациясы")
    .setVersion("1.0")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      "JWT-auth"
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = process.env.PORT || 8989;
  await app.listen(port, "0.0.0.0");

  console.log(`API сервер запущен на порту ${port} (0.0.0.0:${port})`);
  console.log(`Swagger документация: http://0.0.0.0:${port}/api/docs`);
}
bootstrap();
