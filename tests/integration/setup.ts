import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { parseDatabaseTarget, isLocalHost, sameTarget } from '../../lib/db/target';

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error('DATABASE_URL_TEST is not set in integration test setup.');
}

const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  throw new Error('DATABASE_URL is not set in integration test setup.');
}

const testTarget = parseDatabaseTarget(testUrl);
const devTarget = parseDatabaseTarget(devUrl);

if (testTarget.database !== 'brightloop_test') {
  throw new Error(`Integration test database must be 'brightloop_test', got '${testTarget.database}'.`);
}

if (!isLocalHost(testTarget)) {
  throw new Error(`Integration test host must be local, got '${testTarget.host}'.`);
}

if (sameTarget(testTarget, devTarget)) {
  throw new Error('Integration test target cannot equal development target.');
}

// Point DATABASE_URL to DATABASE_URL_TEST so any prisma client uses the test db
process.env.DATABASE_URL = testUrl;
