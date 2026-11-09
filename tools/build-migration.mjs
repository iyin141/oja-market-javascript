// Regenerates migrations/0001_init = prisma-generated DDL + hand-written prisma/custom/constraints.sql.
// Run from repo root: node tools/build-migration.mjs
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const db = 'packages/db';
const ddl = execSync('pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script', { cwd: db, encoding: 'utf8', maxBuffer: 1 << 26 });
const custom = readFileSync(`${db}/prisma/custom/constraints.sql`, 'utf8');
mkdirSync(`${db}/prisma/migrations/0001_init`, { recursive: true });
writeFileSync(`${db}/prisma/migrations/0001_init/migration.sql`, `${ddl}\n\n${custom}`);
writeFileSync(`${db}/prisma/migrations/migration_lock.toml`, 'provider = "postgresql"\n');
console.log('migration written');
