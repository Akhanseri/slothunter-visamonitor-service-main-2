import "reflect-metadata";
import { AppDataSource } from "./data-source";

async function runMigrations() {
  try {
    console.log("🔄 Инициализация подключения к базе данных...");
    console.log(`   Host: ${process.env.DB_HOST || "localhost"}`);
    console.log(`   Database: ${process.env.DB_DATABASE || "visa_monitor"}`);
    
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }

    console.log("🔄 Применение миграций...");
    const migrations = await AppDataSource.runMigrations();
    
    if (migrations.length === 0) {
      console.log("✅ Все миграции уже применены");
    } else {
      console.log(`✅ Применено миграций: ${migrations.length}`);
      migrations.forEach((migration) => {
        console.log(`   - ${migration.name}`);
      });
    }

    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }

    console.log("✅ Миграции завершены успешно");
    process.exit(0);
  } catch (error) {
    console.error("❌ Ошибка при применении миграций:", error);
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }
}

runMigrations();


