import * as chokidar from "chokidar";
import { withClient } from "./pg";
import { Settings, parseSettings } from "./settings";
import * as fsp from "./fsp";
import {
  getLastMigration,
  getMigrationsAfter,
  runCommittedMigration,
  runStringMigration,
} from "./migration";

export async function migrate(settings: Settings) {
  const parsedSettings = parseSettings(settings);
  const { connectionString } = parsedSettings;
  await withClient(connectionString, parsedSettings, async pgClient => {
    const lastMigration = await getLastMigration(pgClient, parsedSettings);
    const remainingMigrations = await getMigrationsAfter(
      parsedSettings,
      lastMigration
    );
    // Run migrations in series
    for (const migration of remainingMigrations) {
      await runCommittedMigration(pgClient, parsedSettings, migration);
    }
    // tslint:disable-next-line no-console
    console.log("graphile-migrate: Up to date");
  });
}

export async function watch(settings: Settings) {
  const parsedSettings = parseSettings(settings);
  await migrate(parsedSettings);
  // Watch the file
  const currentMigrationPath = `${parsedSettings.migrationsFolder}/current.sql`;
  try {
    await fsp.stat(currentMigrationPath);
  } catch (e) {
    if (e.code === "ENOENT") {
      await fsp.writeFile(currentMigrationPath, "-- Enter migration here");
    } else {
      throw e;
    }
  }
  const watcher = chokidar.watch(currentMigrationPath);
  let running = false;
  let runAgain = false;
  async function run() {
    try {
      const body = await fsp.readFile(currentMigrationPath, "utf8");
      // tslint:disable-next-line no-console
      console.log(`[${new Date().toISOString()}]: Running current.sql`);
      const start = process.hrtime();
      await withClient(
        parsedSettings.connectionString,
        parsedSettings,
        pgClient => runStringMigration(pgClient, parsedSettings, body)
      );
      const interval = process.hrtime(start);
      const duration = interval[0] * 1e3 + interval[1] * 1e-6;
      // tslint:disable-next-line no-console
      console.log(
        `[${new Date().toISOString()}]: Finished (${duration.toFixed(0)}ms)`
      );
    } catch (e) {
      // tslint:disable-next-line no-console
      console.error(e);
    }
  }
  function queue() {
    if (running) {
      runAgain = true;
      return;
    }
    running = true;

    run().finally(() => {
      running = false;
      if (runAgain) {
        run();
      }
    });
  }
  watcher.on("change", queue);
  queue();
}
