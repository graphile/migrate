import { Pool, PoolClient } from "pg";
import { parse } from "pg-connection-string";

import { ParsedSettings } from "./settings";

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
  _timer: NodeJS.Timer | null;
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
  connectionString: string,
): PoolDetails {
  let details:
    | PoolDetailsInternal
    | undefined = poolDetailsByConnectionString.get(connectionString);
  if (!details) {
    const { database } = parse(connectionString);
    if (!database) {
      throw new Error("Connection string does not specify a database");
    }
    const pool = new Pool({ connectionString });
    pool.on("error", (err: Error) => {
      // eslint-disable-next-line no-console
      console.error("An error occurred in the PgPool", err);
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
      _timer: null,
      _reference(): void {
        clearTimeout(this._timer);
        this._timer = null;
        this.referenceCount++;
      },
      _reallyRelease(): void {
        clearTimeout(this._timer);
        this._timer = null;
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
  const details = getPoolDetailsFromConnectionString(connectionString);
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
