import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixDaletedAtTypo1700000000001 implements MigrationInterface {
  name = 'FixDaletedAtTypo1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" RENAME COLUMN "daletedAt" TO "deletedAt"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" RENAME COLUMN "deletedAt" TO "daletedAt"`,
    );
  }
}
