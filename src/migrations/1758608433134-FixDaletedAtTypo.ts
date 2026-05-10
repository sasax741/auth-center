import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixDaletedAtTypo1758608433134 implements MigrationInterface {
  name = 'FixDaletedAtTypo1758608433134';

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
