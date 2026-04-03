import { MigrationInterface, QueryRunner } from "typeorm";

export class AddApplicantsToClientVisaGroups1736000000000
  implements MigrationInterface
{
  name = "AddApplicantsToClientVisaGroups1736000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "client_visa_groups"
      ADD COLUMN IF NOT EXISTS "applicants" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "client_visa_groups"
      DROP COLUMN IF EXISTS "applicants"
    `);
  }
}
