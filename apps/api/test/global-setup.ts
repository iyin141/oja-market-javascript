import { execSync } from 'child_process';
import * as path from 'path';

/** Fresh `oja_test` database per jest run, migrated with the real migration SQL (via the compose postgres on :5433). */
export default async function () {
  const admin = process.env.MIGRATE_DATABASE_URL_BASE ?? 'postgresql://postgres:postgres@localhost:5433';
  const dbDir = path.resolve(__dirname, '../../../packages/db');
  const sql = (q: string) => execSync(`docker exec oja-postgres-1 psql -U postgres -v ON_ERROR_STOP=1 -c "${q}"`, { stdio: 'pipe' });
  sql('DROP DATABASE IF EXISTS oja_test WITH (FORCE)');
  sql('CREATE DATABASE oja_test');
  execSync('pnpm exec prisma migrate deploy', { cwd: dbDir, stdio: 'pipe', env: { ...process.env, DATABASE_URL: `${admin}/oja_test` } });
}
