import { MigrationInterface, QueryRunner } from "typeorm";

export class AddQueueIndexToClients1732000000000
  implements MigrationInterface
{
  name = "AddQueueIndexToClients1732000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Добавляем поле queue_index для управления очередью клиентов
    await queryRunner.query(
      `ALTER TABLE "clients" ADD "queue_index" integer`
    );

    // Добавляем поле last_processed_at для статистики обработки
    await queryRunner.query(
      `ALTER TABLE "clients" ADD "last_processed_at" TIMESTAMP`
    );

    // Создаем составные индексы для быстрого поиска в очереди
    await queryRunner.query(
      `CREATE INDEX "IDX_clients_isResident_queueIndex" ON "clients" ("isResident", "queue_index")`
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_clients_isResident_isActive_queueIndex" ON "clients" ("isResident", "isActive", "queue_index")`
    );

    // Инициализируем queue_index для существующих клиентов
    // Resident клиенты получают индексы 1, 2, 3...
    await queryRunner.query(`
      WITH numbered_residents AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY id) as row_num
        FROM clients
        WHERE "isResident" = true
      )
      UPDATE clients
      SET queue_index = numbered_residents.row_num
      FROM numbered_residents
      WHERE clients.id = numbered_residents.id
    `);

    // Non-resident клиенты получают индексы 1, 2, 3...
    await queryRunner.query(`
      WITH numbered_non_residents AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY id) as row_num
        FROM clients
        WHERE "isResident" = false
      )
      UPDATE clients
      SET queue_index = numbered_non_residents.row_num
      FROM numbered_non_residents
      WHERE clients.id = numbered_non_residents.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Откат миграции
    await queryRunner.query(
      `DROP INDEX "IDX_clients_isResident_isActive_queueIndex"`
    );

    await queryRunner.query(
      `DROP INDEX "IDX_clients_isResident_queueIndex"`
    );

    await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "last_processed_at"`);

    await queryRunner.query(`ALTER TABLE "clients" DROP COLUMN "queue_index"`);
  }
}

