import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthVersion1758610000000 implements MigrationInterface {
  name = 'AddAuthVersion1758610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "authVersion" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "authVersion"`);
  }
}
