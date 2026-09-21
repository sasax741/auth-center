import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientEmailIndex1758608433137 implements MigrationInterface {
  name = 'AddClientEmailIndex1758608433137';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_user_client_email" ON "user" ("client", "email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_user_client_email"`);
  }
}
