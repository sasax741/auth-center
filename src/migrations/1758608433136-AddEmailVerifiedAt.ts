import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailVerifiedAt1758608433136 implements MigrationInterface {
  name = 'AddEmailVerifiedAt1758608433136';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD "emailVerifiedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN "emailVerifiedAt"`,
    );
  }
}
