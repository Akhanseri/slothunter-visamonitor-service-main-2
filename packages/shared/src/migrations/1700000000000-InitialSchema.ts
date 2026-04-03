import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from "typeorm";

export class InitialSchema1700000000000 implements MigrationInterface {
  name = "InitialSchema1700000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "visa_group_status_enum" AS ENUM('register', 'pay_fee', 'attend')`);
    
    await queryRunner.query(`CREATE TYPE "match_status_enum" AS ENUM('NEW', 'MATCH_PENDING', 'BOOKING_IN_PROGRESS', 'BOOKED', 'MISSED_SLOT', 'REMATCH_REQUIRED')`);

    await queryRunner.createTable(
      new Table({
        name: "clients",
        columns: [
          {
            name: "id",
            type: "integer",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "email",
            type: "varchar",
            isUnique: true,
          },
          {
            name: "password",
            type: "varchar",
          },
          {
            name: "isActive",
            type: "boolean",
            default: true,
          },
          {
            name: "isResident",
            type: "boolean",
            default: false,
          },
          {
            name: "companyEmail",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
          {
            name: "updatedAt",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true
    );

    await queryRunner.createTable(
      new Table({
        name: "client_visa_groups",
        columns: [
          {
            name: "id",
            type: "integer",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "client_id",
            type: "integer",
          },
          {
            name: "status",
            type: "enum",
            enum: ["register", "pay_fee", "attend"],
          },
          {
            name: "schedule_path",
            type: "varchar",
          },
          {
            name: "city",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "slot_start_date",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "slot_end_date",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "delay_days",
            type: "integer",
            isNullable: true,
          },
          {
            name: "match_status",
            type: "enum",
            enum: ["NEW", "MATCH_PENDING", "BOOKING_IN_PROGRESS", "BOOKED", "MISSED_SLOT", "REMATCH_REQUIRED"],
            isNullable: true,
          },
          {
            name: "candidate_slot",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "candidate_slot_expires_at",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "last_notified_at",
            type: "timestamp",
            isNullable: true,
          },
          {
            name: "is_active",
            type: "boolean",
            default: true,
          },
          {
            name: "is_auto_book_enabled",
            type: "boolean",
            default: false,
          },
          {
            name: "created_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
          {
            name: "updated_at",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true
    );

    await queryRunner.createTable(
      new Table({
        name: "visa_logs",
        columns: [
          {
            name: "id",
            type: "integer",
            isPrimary: true,
            isGenerated: true,
            generationStrategy: "increment",
          },
          {
            name: "parserEmail",
            type: "varchar",
          },
          {
            name: "isResident",
            type: "boolean",
            default: false,
          },
          {
            name: "city",
            type: "varchar",
          },
          {
            name: "appointmentDate",
            type: "date",
          },
          {
            name: "availableTimes",
            type: "text",
            isArray: true,
          },
          {
            name: "checkedAt",
            type: "timestamp",
            default: "CURRENT_TIMESTAMP",
          },
        ],
      }),
      true
    );

    await queryRunner.createForeignKey(
      "client_visa_groups",
      new TableForeignKey({
        columnNames: ["client_id"],
        referencedColumnNames: ["id"],
        referencedTableName: "clients",
        onDelete: "CASCADE",
      })
    );

    await queryRunner.createIndex(
      "clients",
      new TableIndex({
        name: "IDX_clients_email",
        columnNames: ["email"],
      })
    );

    await queryRunner.createIndex(
      "client_visa_groups",
      new TableIndex({
        name: "IDX_client_visa_groups_client_id",
        columnNames: ["client_id"],
      })
    );

    await queryRunner.createIndex(
      "client_visa_groups",
      new TableIndex({
        name: "IDX_client_visa_groups_match_status",
        columnNames: ["match_status"],
      })
    );

    await queryRunner.createIndex(
      "client_visa_groups",
      new TableIndex({
        name: "IDX_client_visa_groups_candidate_slot_expires_at",
        columnNames: ["candidate_slot_expires_at"],
      })
    );

    await queryRunner.createIndex(
      "client_visa_groups",
      new TableIndex({
        name: "IDX_client_visa_groups_is_active",
        columnNames: ["is_active"],
      })
    );

    await queryRunner.createIndex(
      "visa_logs",
      new TableIndex({
        name: "IDX_visa_logs_parserEmail_checkedAt",
        columnNames: ["parserEmail", "checkedAt"],
      })
    );

    await queryRunner.createIndex(
      "visa_logs",
      new TableIndex({
        name: "IDX_visa_logs_city_appointmentDate",
        columnNames: ["city", "appointmentDate"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("visa_logs", true);
    await queryRunner.dropTable("client_visa_groups", true);
    await queryRunner.dropTable("clients", true);
    await queryRunner.query(`DROP TYPE IF EXISTS "match_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "visa_group_status_enum"`);
  }
}
