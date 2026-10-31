import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { parseDatabaseTarget, isLocalHost, sameTarget } from '../lib/db/target';

function runGuard(): void {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const isDev = args.includes('--dev');

  if (isTest) {
    const testUrl = process.env.DATABASE_URL_TEST;
    if (!testUrl) {
      console.error('guard error: DATABASE_URL_TEST is not set.');
      process.exit(1);
    }
    const devUrl = process.env.DATABASE_URL;
    if (!devUrl) {
      console.error('guard error: DATABASE_URL is not set.');
      process.exit(1);
    }

    const testTarget = parseDatabaseTarget(testUrl);
    const devTarget = parseDatabaseTarget(devUrl);

    if (testTarget.database !== 'brightloop_test') {
      console.error(`guard error: test database must be 'brightloop_test', got '${testTarget.database}'.`);
      process.exit(1);
    }

    if (!isLocalHost(testTarget)) {
      console.error(`guard error: test host must be local, got '${testTarget.host}'.`);
      process.exit(1);
    }

    if (sameTarget(testTarget, devTarget)) {
      console.error('guard error: test target cannot equal development target.');
      process.exit(1);
    }

    process.exit(0);
  }

  if (isDev) {
    if (process.env.NODE_ENV === 'production') {
      console.error('guard error: NODE_ENV cannot be production for dev reset.');
      process.exit(1);
    }

    const devUrl = process.env.DATABASE_URL;
    if (!devUrl) {
      console.error('guard error: DATABASE_URL is not set.');
      process.exit(1);
    }

    const devTarget = parseDatabaseTarget(devUrl);
    if (devTarget.database !== 'brightloop_db') {
      console.error(`guard error: dev database must be 'brightloop_db', got '${devTarget.database}'.`);
      process.exit(1);
    }

    if (!isLocalHost(devTarget)) {
      console.error(`guard error: dev host must be local, got '${devTarget.host}'.`);
      process.exit(1);
    }

    process.exit(0);
  }

  console.error('guard error: must specify --test or --dev');
  process.exit(1);
}

runGuard();
