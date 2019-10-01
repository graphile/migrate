import * as chokidar from "chokidar";
import { withClient, withTransaction } from "../pg";
import {
  Settings,
  ParsedSettings,
  parseSettings,
  getCurrentMigrationPath,
  BLANK_MIGRATION_CONTENT,
} from "../settings";
import * as fsp from "../fsp";
import { runStringMigration, reverseMigration } from "../migration";
import { executeActions } from "../actions";
import { _migrate } from "./migrate";
import { logDbError } from "../instrumentation";
import pgMinify = require("pg-minify");

export function _makeCurrentMigrationRunner(
  parsedSettings: ParsedSettings,
  _once = false,
  shadow = false
): () => Promise<void> {
  const currentMigrationPath = getCurrentMigrationPath(parsedSettings);
  async function run(): Promise<void> {
    let migrationsAreEquivalent = false;
    try {
      const body = await fsp.readFile(currentMigrationPath, "utf8");
      // eslint-disable-next-line no-console
      console.log(`[${new Date().toISOString()}]: Running current.sql`);
      const start = process.hrtime();
      const connectionString = shadow
        ? parsedSettings.shadowConnectionString
        : parsedSettings.connectionString;
      if (!connectionString) {
        throw new Error(
          "Could not determine connection string for running commands"
        );
      }
      await withClient(
        connectionString,
        parsedSettings,
        (lockingPgClient, context) =>
          withTransaction(lockingPgClient, async () => {
            // 1: lock graphile_migrate.current so no concurrent migrations can occur
            await lockingPgClient.query(
              "lock graphile_migrate.current in EXCLUSIVE mode"
            );

            // 2: Get last current.sql from graphile_migrate.current
            const {
              rows: [previousCurrent],
            } = await lockingPgClient.query(
              `
              select *
              from graphile_migrate.current
              where filename = 'current.sql'
            `
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
              true
            );
            const previousBodyMinified = previousBody
              ? pgMinify(previousBody)
              : null;
            const currentBodyMinified = pgMinify(currentBodyFromDryRun);
            migrationsAreEquivalent =
              currentBodyMinified === previousBodyMinified;

            // 4: if different
            if (!migrationsAreEquivalent) {
              // 4a: invert previous current; on success delete from graphile_migrate.current; on failure rollback and abort
              if (previousBody) {
                await reverseMigration(lockingPgClient, previousBody);
              }

              // COMMIT ─ because we need to commit that the migration was reversed
              await lockingPgClient.query("commit");
              await lockingPgClient.query("begin");
              // Re-establish a lock ASAP to continue with migration
              await lockingPgClient.query(
                "lock graphile_migrate.current in EXCLUSIVE mode"
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
                      undefined
                    )
                );
              }
            } else {
              // eslint-disable-next-line no-console
              console.log(
                `[${new Date().toISOString()}]: current.sql unchanged, skipping migration`
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
          })
      );
      const interval = process.hrtime(start);
      const duration = interval[0] * 1e3 + interval[1] * 1e-6;
      if (!migrationsAreEquivalent) {
        await executeActions(
          parsedSettings,
          shadow,
          parsedSettings.afterCurrent
        );
      }
      const interval2 = process.hrtime(start);
      const duration2 = interval2[0] * 1e3 + interval2[1] * 1e-6;
      // eslint-disable-next-line no-console
      console.log(
        `[${new Date().toISOString()}]: Finished (${duration2.toFixed(0)}ms${
          duration2 - duration >= 5
            ? `; excluding actions: ${duration.toFixed(0)}ms`
            : ""
        })`
      );
    } catch (e) {
      logDbError(e);
    }
  }
  return run;
}

export async function _watch(
  parsedSettings: ParsedSettings,
  once = false,
  shadow = false
): Promise<void> {
  await _migrate(parsedSettings, shadow);
  // Watch the file
  const currentMigrationPath = getCurrentMigrationPath(parsedSettings);
  try {
    await fsp.stat(currentMigrationPath);
  } catch (e) {
    if (e.code === "ENOENT") {
      await fsp.writeFile(currentMigrationPath, BLANK_MIGRATION_CONTENT);
    } else {
      throw e;
    }
  }
  const run = _makeCurrentMigrationRunner(parsedSettings, once, shadow);
  if (once) {
    return run();
  } else {
    let running = false;
    let runAgain = false;
    const queue = (): void => {
      if (running) {
        runAgain = true;
      }
      running = true;

      run().finally(() => {
        running = false;
        if (runAgain) {
          runAgain = false;
          queue();
        }
      });
    };
    const watcher = chokidar.watch(currentMigrationPath, {
      /*
       * Without `usePolling`, on Linux, you can prevent the watching from
       * working by issuing `git stash && sleep 2 && git stash pop`. This is
       * annoying.
       */
      usePolling: true,

      /*
       * Some editors stream the writes out a little at a time, we want to wait
       * for the write to finish before triggering.
       */
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });
    watcher.on("change", queue);
    queue();
    return Promise.resolve();
  }
}

export async function watch(
  settings: Settings,
  once = false,
  shadow = false
): Promise<void> {
  const parsedSettings = await parseSettings(settings, shadow);
  return _watch(parsedSettings, once, shadow);
}
