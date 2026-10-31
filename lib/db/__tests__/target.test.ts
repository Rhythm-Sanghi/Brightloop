import { describe, it, expect } from 'vitest';
import { parseDatabaseTarget, isLocalHost, sameTarget } from '../target';

describe('Database target parsing and comparison', () => {
  it('parses target correctly and applies default port 5432', () => {
    const target = parseDatabaseTarget('postgresql://postgres:postgres@localhost/brightloop_db');
    expect(target.host).toBe('local');
    expect(target.port).toBe('5432');
    expect(target.database).toBe('brightloop_db');
    expect(isLocalHost(target)).toBe(true);
  });

  it('normalizes localhost, 127.0.0.1, and [::1] to local', () => {
    const t1 = parseDatabaseTarget('postgresql://u:p@localhost:5435/db');
    const t2 = parseDatabaseTarget('postgresql://u:p@127.0.0.1:5435/db');
    const t3 = parseDatabaseTarget('postgresql://u:p@[::1]:5435/db');

    expect(t1.host).toBe('local');
    expect(t2.host).toBe('local');
    expect(t3.host).toBe('local');
    expect(isLocalHost(t1)).toBe(true);
    expect(isLocalHost(t2)).toBe(true);
    expect(isLocalHost(t3)).toBe(true);
  });

  it('treats identical targets with different query strings as equal', () => {
    const t1 = parseDatabaseTarget('postgresql://u:p@localhost:5435/brightloop_db?schema=public&connection_limit=10');
    const t2 = parseDatabaseTarget('postgresql://u:p@127.0.0.1:5435/brightloop_db?pool_timeout=20');

    expect(sameTarget(t1, t2)).toBe(true);
  });

  it('identifies non-local hosts and different databases', () => {
    const remote = parseDatabaseTarget('postgresql://u:p@remote-host.com:5432/brightloop_db');
    expect(remote.host).toBe('remote-host.com');
    expect(isLocalHost(remote)).toBe(false);

    const dev = parseDatabaseTarget('postgresql://u:p@localhost:5435/brightloop_db');
    const test = parseDatabaseTarget('postgresql://u:p@localhost:5435/brightloop_test');
    expect(sameTarget(dev, test)).toBe(false);
  });
});
