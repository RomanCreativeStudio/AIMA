import type { Client, Pool } from 'pg';

/**
 * Anything that can run a parameterized query — satisfied by both `Pool`
 * (production) and `Client` (tests, so a whole request can run inside one
 * transaction that's rolled back afterward).
 */
export type Queryable = Pool | Client;
