import { Pool } from 'pg';

export interface PoolOptions {
  /** Negotiate TLS with the server (Phase 3.1) — most managed Postgres providers need this in production. `rejectUnauthorized: false` because these providers commonly present a certificate not chained to a public CA; the connection is still encrypted, just not identity-verified against a public root. */
  ssl?: boolean;
  /** Bounds simultaneous connections so a traffic spike can't exhaust the database's own connection limit. */
  maxConnections?: number;
}

export function createPool(databaseUrl: string, options: PoolOptions = {}): Pool {
  return new Pool({
    connectionString: databaseUrl,
    ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
    max: options.maxConnections,
  });
}
