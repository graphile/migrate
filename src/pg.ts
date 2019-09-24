import * as pg from "pg";
import { ParsedSettings } from "./settings";
import { parse } from "pg-connection-string";

export interface Context {
  database: string;
}

export type Client = pg.PoolClient;
export async function withClient<T = void>(
  connectionString: string,
  parsedSettings: ParsedSettings,
  callback: (pgClient: pg.PoolClient, context: Context) => Promise<T>
): Promise<T> {
  const { database } = parse(connectionString);
  if (!database) {
    throw new Error("Connection string does not specify a database");
  }
  const pgPool = new pg.Pool({ connectionString });
  pgPool.on("error", (err: Error) => {
    // eslint-disable-next-line no-console
    console.error("An error occurred in the PgPool", err);
    process.exit(1);
  });
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
            }::text, false)`
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
    await pgPool.end();
  }
}

export async function withTransaction<T>(
  pgClient: pg.PoolClient,
  callback: () => Promise<T>
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
