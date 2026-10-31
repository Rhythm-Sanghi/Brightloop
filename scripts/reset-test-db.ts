import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDatabaseTarget, isLocalHost, sameTarget } from '../lib/db/target';

const prismaCliPath = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');

if (!fs.existsSync(prismaCliPath)) {
  console.error('Prisma CLI entry file not found at node_modules/prisma/build/index.js. Please run npm install.');
  process.exit(1);
}

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  console.error('reset-test-db: target check failed');
  process.exit(1);
}

const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error('reset-test-db: target check failed');
  process.exit(1);
}

try {
  const testTarget = parseDatabaseTarget(testUrl);
  if (testTarget.database !== 'brightloop_test') {
    console.error('reset-test-db: target check failed');
    process.exit(1);
  }
  if (!isLocalHost(testTarget)) {
    console.error('reset-test-db: target check failed');
    process.exit(1);
  }

  const devTarget = parseDatabaseTarget(devUrl);
  if (sameTarget(testTarget, devTarget)) {
    console.error('reset-test-db: target check failed');
    process.exit(1);
  }
} catch {
  console.error('reset-test-db: target check failed');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [prismaCliPath, 'migrate', 'reset', '--force', '--skip-seed'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: testUrl,
    },
  }
);

if (result.status !== 0) {
  process.exit(result.status || 1);
}
