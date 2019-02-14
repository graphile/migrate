import * as pg from "pg";

export type Client = pg.PoolClient;
export async function withClient<T = void>(
  connectionString: string,
  settings: Settings,
  callback: (pgClient: pg.PoolClient) => Promise<T>
): Promise<T> {
  const pgPool = new pg.Pool({ connectionString });
  pgPool.on("error", (err: Error) => {
    // tslint:disable-next-line no-console
    console.error("An error occurred in the PgPool", err);
    process.exit(1);
  });
  try {
    const pgClient = await pgPool.connect();
    try {
      if (settings.pgSettings) {
        const sqlFragments = [];
        const sqlValues = [];
        for (const [key, value] of Object.entries(settings.pgSettings)) {
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
      return await callback(pgClient);
    } finally {
      await pgClient.release();
    }
  } finally {
    await pgPool.end();
  }
}
