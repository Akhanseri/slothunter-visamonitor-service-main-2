import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClientSessions1735000000000 implements MigrationInterface {
  name = "AddClientSessions1735000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "client_sessions" (
        "id" SERIAL NOT NULL,
        "client_id" integer NOT NULL,
        "schedule_id" character varying NOT NULL,
        "cookie_enc" text NOT NULL,
        "csrf_enc" text NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "last_error" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_client_sessions_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_client_sessions_client_schedule"
      ON "client_sessions" ("client_id", "schedule_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_client_sessions_expires_at"
      ON "client_sessions" ("expires_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "client_sessions"
      ADD CONSTRAINT "FK_client_sessions_client_id"
      FOREIGN KEY ("client_id") REFERENCES "clients"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_sessions" DROP CONSTRAINT IF EXISTS "FK_client_sessions_client_id"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_client_sessions_expires_at"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_client_sessions_client_schedule"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "client_sessions"`);
  }
}


