
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const isTypeScript = __filename.endsWith('.ts');
const sourceRoot = isTypeScript
  ? path.join(process.cwd(), 'src')
  : path.join(process.cwd(), 'dist', 'src');
const extension = isTypeScript ? 'ts' : 'js';

export default new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: [
        path.join(sourceRoot, '**', `*.entity.${extension}`),
    ],
    migrations: [
        path.join(sourceRoot, 'migrations', `*.${extension}`),
    ],
    synchronize: false,
});
