import pgMinify = require("pg-minify");

import { executeActions } from "./actions";
import { getCurrentMigrationLocation, readCurrentMigration } from "./current";
import { logDbError } from "./instrumentation";
import type { DbCurrent } from "./interfaces";
import { reverseMigration, runStringMigration } from "./migration";
import { withClient, withTransaction } from "./pg";
import type { ParsedSettings } from "./settings";

export function makeCurrentMigrationRunner(
  parsedSettings: ParsedSettings,
  options: {
    once?: boolean;
    shadow?: boolean;
    forceActions?: boolean;
  } = {},
): () => Promise<void> {
  const { shadow = false, forceActions = false } = options;
  async function run(): Promise<void> {
    const currentLocation = await getCurrentMigrationLocation(parsedSettings);
    const body = await readCurrentMigration(parsedSettings, currentLocation);
    let migrationsAreEquivalent = false;

    try {
      parsedSettings.logger.info(
        `[${new Date().toISOString()}]: Running current.sql`,
      );
      const start = process.hrtime();
      const connectionString = shadow
        ? parsedSettings.shadowConnectionString
        : parsedSettings.connectionString;
      if (!connectionString) {
        throw new Error(
          "Could not determine connection string for running commands",
        );
      }
      await withClient(
        connectionString,
        parsedSettings,
        (lockingPgClient, context) =>
          withTransaction(lockingPgClient, async () => {
            // 1: lock graphile_migrate.current so no concurrent migrations can occur
            await lockingPgClient.query(
              "lock graphile_migrate.current in EXCLUSIVE mode",
            );

            // 2: Get last current.sql from graphile_migrate.current
            const {
              rows: [previousCurrent],
            } = await lockingPgClient.query<DbCurrent>(
              `
              select *
              from graphile_migrate.current
              where filename = 'current.sql'
            `,
            );

            // 3: minify and compare last ran current.sql with this _COMPILED_ current.sql.
            const previousBody: string | void =
              previousCurrent && previousCurrent.content;
            const { sql: currentBodyFromDryRun } = await runStringMigration(
              lockingPgClient,
              parsedSettings,
              context,
              body,
              "current.sql",
              undefined,
              true,
            );
            const previousBodyMinified = previousBody
              ? pgMinify(previousBody)
              : null;
            const currentBodyMinified = pgMinify(currentBodyFromDryRun);
            migrationsAreEquivalent =
              currentBodyMinified === previousBodyMinified;

            // 4: if different
            if (forceActions || !migrationsAreEquivalent) {
              await executeActions(
                parsedSettings,
                shadow,
                parsedSettings.beforeCurrent,
              );

              // 4a: invert previous current; on success delete from graphile_migrate.current; on failure rollback and abort
              if (previousBody) {
                await reverseMigration(lockingPgClient, previousBody);
              }

              // COMMIT ─ because we need to commit that the migration was reversed
              await lockingPgClient.query("commit");
              await lockingPgClient.query("begin");
              // Re-establish a lock ASAP to continue with migration
              await lockingPgClient.query(
                "lock graphile_migrate.current in EXCLUSIVE mode",
              );

              // 4b: run this current (in its own independent transaction) if not empty
              if (currentBodyMinified !== "") {
                await withClient(
                  connectionString,
                  parsedSettings,
                  (independentPgClient, context) =>
                    runStringMigration(
                      independentPgClient,
                      parsedSettings,
                      context,
                      body,
                      "current.sql",
                      undefined,
                    ),
                );
              }
            } else {
              parsedSettings.logger.info(
                `[${new Date().toISOString()}]: current.sql unchanged, skipping migration`,
              );
            }

            // 5: update graphile_migrate.current with latest content
            //   (NOTE: we update even if the minified versions don't differ since
            //    the comments may have changed.)
            await lockingPgClient.query({
              name: "current-insert",
              text: `
              insert into graphile_migrate.current(content)
              values ($1)
              on conflict (filename)
              do update
              set content = excluded.content, date = excluded.date
            `,
              values: [currentBodyFromDryRun],
            });
          }),
      );
      const interval = process.hrtime(start);
      const duration = interval[0] * 1e3 + interval[1] * 1e-6;
      if (!migrationsAreEquivalent) {
        await executeActions(
          parsedSettings,
          shadow,
          parsedSettings.afterCurrent,
        );
      }
      const interval2 = process.hrtime(start);
      const duration2 = interval2[0] * 1e3 + interval2[1] * 1e-6;
      parsedSettings.logger.info(
        `[${new Date().toISOString()}]: Finished (${duration2.toFixed(0)}ms${
          duration2 - duration >= 5
            ? `; excluding actions: ${duration.toFixed(0)}ms`
            : ""
        })`,
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      logDbError(parsedSettings, e);
      throw e;
    }
  }
  return run;
}
