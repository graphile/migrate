import * as chokidar from "chokidar";
import { withClient } from "./pg";
import { Settings, ParsedSettings, parseSettings } from "./settings";
import * as fsp from "./fsp";
import {
  getLastMigration,
  getMigrationsAfter,
  runCommittedMigration,
  runStringMigration,
  generatePlaceholderReplacement,
} from "./migration";

export async function migrate(settings: Settings, shadow = false) {
  const parsedSettings = await parseSettings(settings, shadow);
  return _migrate(parsedSettings, shadow);
}

export async function watch(settings: Settings, once = false, shadow = false) {
  const parsedSettings = await parseSettings(settings, shadow);
  return _watch(parsedSettings, once, shadow);
}

export async function reset(
  settings: Settings,
  shadow = false,
  rootConnectionString = "template1"
) {
  const parsedSettings = await parseSettings(settings, shadow);
  return _reset(parsedSettings, shadow, rootConnectionString);
}
/**********/

async function _migrate(parsedSettings: ParsedSettings, shadow = false) {
  const connectionString = shadow
    ? parsedSettings.shadowConnectionString
    : parsedSettings.connectionString;
  if (!connectionString) {
    throw new Error("Could not determine connection string");
  }
  await withClient(
    connectionString,
    parsedSettings,
    async (pgClient, context) => {
      const lastMigration = await getLastMigration(pgClient, parsedSettings);
      const remainingMigrations = await getMigrationsAfter(
        parsedSettings,
        lastMigration
      );
      // Run migrations in series
      for (const migration of remainingMigrations) {
        await runCommittedMigration(
          pgClient,
          parsedSettings,
          context,
          migration
        );
      }
      // tslint:disable-next-line no-console
      console.log("graphile-migrate: Up to date");
    }
  );
}

async function _watch(
  parsedSettings: ParsedSettings,
  once = false,
  shadow = false
) {
  await _migrate(parsedSettings, shadow);
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
        (pgClient, context) =>
          runStringMigration(pgClient, parsedSettings, context, body)
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
  if (!once) {
    const watcher = chokidar.watch(currentMigrationPath);
    watcher.on("change", queue);
  }
  queue();
}

export async function _reset(
  parsedSettings: ParsedSettings,
  shadow: boolean,
  rootConnectionString = "template1"
) {
  const connectionString = shadow
    ? parsedSettings.shadowConnectionString
    : parsedSettings.connectionString;
  if (!connectionString) {
    throw new Error("Could not determine connection string for reset");
  }
  await withClient(rootConnectionString, parsedSettings, async pgClient => {
    const databaseName = shadow
      ? parsedSettings.shadowDatabaseName
      : parsedSettings.databaseName;
    const databaseOwner = parsedSettings.databaseOwner;
    await pgClient.query(`DROP DATABASE IF EXISTS ${databaseName};`);
    await pgClient.query(
      `CREATE DATABASE ${databaseName} OWNER ${databaseOwner};`
    );
    await pgClient.query(`REVOKE ALL ON DATABASE ${databaseName} FROM PUBLIC;`);
  });
  if (parsedSettings.afterReset) {
    await withClient(
      connectionString,
      parsedSettings,
      async (pgClient, context) => {
        const body = await fsp.readFile(
          `${parsedSettings.migrationsFolder}/${parsedSettings.afterReset}`,
          "utf8"
        );
        const query = generatePlaceholderReplacement(parsedSettings, context)(
          body
        );
        // tslint:disable-next-line no-console
        console.log(query);
        await pgClient.query({
          text: query,
        });
      }
    );
  }
  await _migrate(parsedSettings, shadow);
}
