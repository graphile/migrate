import { Pool, PoolClient } from "pg";
import { parse } from "pg-connection-string";

import { ParsedSettings } from "./settings";

type PoolOrMockClient = PoolClient & { __isMockClient?: boolean };

export interface Context {
  database: string;
}

/**
 * For efficiency, we keep pools around for a period of time after they were
 * last "released" so we don't have to keep re-creating them. This value
 * chooses this time (in milliseconds). Note: clean exit will be delayed by
 * this duration.
 */
const POOL_KEEPALIVE = 200;

interface PoolDetails {
  pool: Pool;
  database: string;
  referenceCount: number;
  release(): void;
}
interface PoolDetailsInternal extends PoolDetails {
  _reference(): void;
  _reallyRelease(): void;
  _timer: NodeJS.Timeout | undefined;
}
const poolDetailsByConnectionString = new Map<string, PoolDetailsInternal>();

export function clearAllPools(): void {
  for (const details of poolDetailsByConnectionString.values()) {
    if (details.referenceCount === 0) {
      details._reallyRelease();
    }
  }
}

function getPoolDetailsFromConnectionString(
  { logger }: ParsedSettings,
  connectionString: string,
): PoolDetails {
  let details: PoolDetailsInternal | undefined =
    poolDetailsByConnectionString.get(connectionString);
  if (!details) {
    const { database } = parse(connectionString);
    if (!database) {
      throw new Error("Connection string does not specify a database");
    }
    const pool = new Pool({ connectionString });
    pool.on("error", (error: Error) => {
      logger.error(`An error occurred in the PgPool: ${error.message}`, {
        error,
      });
      process.exit(1);
    });

    // We don't want someone else ending our pool; delete the end method.
    const end = pool.end;
    pool.end = (): never => {
      throw new Error(
        "You must not call .end() on this pool! Release the pool detail instead",
      );
    };

    details = {
      pool,
      database,
      referenceCount: 0,
      release(): void {
        this.referenceCount--;
        if (this.referenceCount === 0) {
          this._timer = setTimeout(this._reallyRelease, POOL_KEEPALIVE);
        }
      },
      _timer: undefined,
      _reference(): void {
        clearTimeout(this._timer);
        this._timer = undefined;
        this.referenceCount++;
      },
      _reallyRelease(): void {
        clearTimeout(this._timer);
        this._timer = undefined;
        pool.end = end;
        pool.end();
        poolDetailsByConnectionString.delete(connectionString);
      },
    };
    poolDetailsByConnectionString.set(connectionString, details);
  }
  details._reference();
  return details;
}

export type Client = PoolClient;
export async function withClient<T = void>(
  connectionString: string,
  parsedSettings: ParsedSettings,
  callback: (pgClient: PoolClient, context: Context) => Promise<T>,
): Promise<T> {
  const details = getPoolDetailsFromConnectionString(
    parsedSettings,
    connectionString,
  );
  const { pool: pgPool, database } = details;
  try {
    const pgClient = await pgPool.connect();
    try {
      if (parsedSettings.pgSettings) {
        const sqlFragments = [];
        const sqlValues = [];
        for (const [key, value] of Object.entries(parsedSettings.pgSettings)) {
          sqlValues.push(key, value);
          sqlFragments.push(
            `pg_catalog.set_config($${sqlValues.length - 1}::text, $${
              sqlValues.length
            }::text, false)`,
          );
        }
        if (sqlFragments.length) {
          await pgClient.query({
            text: `select ${sqlFragments.join(", ")}`,
            values: sqlValues,
          });
        }
      }
      const context: Context = {
        database,
      };
      return await callback(pgClient, context);
    } finally {
      await Promise.resolve(pgClient.release());
    }
  } finally {
    details.release();
  }
}

const ADVISORY_LOCK_MIGRATE =
  "4727445306447283"; /* `GRAPHILE MIGRATE` on phone keypad */
export async function withAdvisoryLock<T>(
  pgClient: PoolOrMockClient,
  callback: (pgClient: PoolClient) => Promise<T>,
): Promise<T> {
  if (pgClient["__isMockClient"]) {
    return callback(pgClient);
  }
  const {
    rows: [{ locked }],
  } = await pgClient.query("select pg_try_advisory_lock($1) as locked", [
    ADVISORY_LOCK_MIGRATE,
  ]);
  if (!locked) {
    throw new Error("Failed to get exclusive lock");
  }
  try {
    return await callback(pgClient);
  } finally {
    await pgClient.query("select pg_advisory_unlock($1)", [
      ADVISORY_LOCK_MIGRATE,
    ]);
  }
}

export async function withTransaction<T>(
  pgClient: PoolClient,
  callback: () => Promise<T>,
): Promise<T> {
  await pgClient.query("begin");
  try {
    const result = await callback();
    await pgClient.query("commit");
    return result;
  } catch (e) {
    await pgClient.query("rollback");
    throw e;
  }
}

export function escapeIdentifier(str: string): string {
  return '"' + str.replace(/"/g, '""') + '"';
}
