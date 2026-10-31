export interface DatabaseTarget {
  host: string;
  port: string;
  database: string;
}

export function parseDatabaseTarget(rawUrl: string): DatabaseTarget {
  try {
    const parsed = new URL(rawUrl);
    let host = parsed.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
      host = 'local';
    }
    const port = parsed.port || '5432';
    const database = parsed.pathname.replace(/^\/+/, '');
    return { host, port, database };
  } catch (error) {
    throw new Error(`Invalid database URL: ${rawUrl}`);
  }
}

export function isLocalHost(target: DatabaseTarget): boolean {
  return target.host === 'local';
}

export function sameTarget(a: DatabaseTarget, b: DatabaseTarget): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}
