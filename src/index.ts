import * as chokidar from "chokidar";
import { withClient } from "./pg";
import {
  Settings,
  ParsedSettings,
  parseSettings,
  isCommandSpec,
} from "./settings";
import * as fsp from "./fsp";
import {
  getAllMigrations,
  getLastMigration,
  getMigrationsAfter,
  runCommittedMigration,
  runStringMigration,
  generatePlaceholderReplacement,
} from "./migration";
import { exec as rawExec } from "child_process";
import { promisify } from "util";
import { calculateHash } from "./hash";
import * as pgMinify from "pg-minify";
import chalk from "chalk";
import indent from "./indent";

const BLANK_MIGRATION_CONTENT = "-- Enter migration here";

const exec = promisify(rawExec);

const logDbError = (e: Error) => {
  // tslint:disable no-console
  console.error();
  if (e["_gmMessageOverride"]) {
    console.error(e["_gmMessageOverride"]);
  } else {
    console.error(
      chalk.red.bold(`🛑 Error occurred whilst processing migration`)
    );
    console.error(indent(e.stack ? e.stack : e.message, 4));
  }
  console.error();
  // tslint:enable no-console
};

export async function migrate(settings: Settings, shadow = false) {
  const parsedSettings = await parseSettings(settings, shadow);
  return _migrate(parsedSettings, shadow);
}

export async function watch(settings: Settings, once = false, shadow = false) {
  const parsedSettings = await parseSettings(settings, shadow);
  return _watch(parsedSettings, once, shadow);
}

export async function reset(settings: Settings, shadow = false) {
  const parsedSettings = await parseSettings(settings, shadow);
  return _reset(parsedSettings, shadow);
}

export async function commit(settings: Settings) {
  const parsedSettings = await parseSettings(settings, true);
  return _commit(parsedSettings);
}
/**********/

async function _migrate(parsedSettings: ParsedSettings, shadow = false) {
  const connectionString = shadow
    ? parsedSettings.shadowConnectionString
    : parsedSettings.connectionString;
  if (!connectionString) {
    throw new Error("Could not determine connection string");
  }
  const logSuffix = shadow ? "[shadow]" : "";
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
          migration,
          logSuffix
        );
      }

      // tslint:disable-next-line no-console
      console.log(
        `graphile-migrate${logSuffix}: ${
          lastMigration
            ? "Up to date"
            : remainingMigrations.length
            ? `Up to date — ${
                remainingMigrations.length
              } committed migrations executed`
            : `Up to date — no committed migrations to run`
        }`
      );

      await _dump(parsedSettings, shadow);
    }
  );
}

function getCurrentMigrationPath(parsedSettings: ParsedSettings) {
  return `${parsedSettings.migrationsFolder}/current.sql`;
}

async function _dump(parsedSettings: ParsedSettings, shadow = false) {
  if (parsedSettings.dumpCommand) {
    const logSuffix = shadow ? "[shadow]" : "";

    // tslint:disable-next-line no-console
    console.log(`graphile-migrate${logSuffix}: running dump`);

    const connectionString = shadow
      ? parsedSettings.shadowConnectionString
      : parsedSettings.connectionString;
    if (!connectionString) {
      throw new Error("Could not determine connection string for dump");
    }

    const { stdout, stderr } = await exec(parsedSettings.dumpCommand, {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: connectionString,
      },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (stdout) {
      // tslint:disable-next-line no-console
      console.log(stdout);
    }
    if (stderr) {
      // tslint:disable-next-line no-console
      console.error(stderr);
    }
  }
}

async function _watch(
  parsedSettings: ParsedSettings,
  once = false,
  shadow = false
) {
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
          runStringMigration(
            pgClient,
            parsedSettings,
            context,
            body,
            "current.sql"
          )
      );
      const interval = process.hrtime(start);
      const duration = interval[0] * 1e3 + interval[1] * 1e-6;
      // tslint:disable-next-line no-console
      console.log(
        `[${new Date().toISOString()}]: Finished (${duration.toFixed(0)}ms)`
      );

      await _dump(parsedSettings, shadow);
    } catch (e) {
      logDbError(e);
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

export async function _reset(parsedSettings: ParsedSettings, shadow: boolean) {
  const connectionString = shadow
    ? parsedSettings.shadowConnectionString
    : parsedSettings.connectionString;
  if (!connectionString) {
    throw new Error("Could not determine connection string for reset");
  }
  await withClient(
    parsedSettings.rootConnectionString,
    parsedSettings,
    async pgClient => {
      const databaseName = shadow
        ? parsedSettings.shadowDatabaseName
        : parsedSettings.databaseName;
      const databaseOwner = parsedSettings.databaseOwner;
      const logSuffix = shadow ? "[shadow]" : "";
      await pgClient.query(`DROP DATABASE IF EXISTS ${databaseName};`);
      console.log(
        `graphile-migrate${logSuffix}: dropped database '${databaseName}'`
      );
      await pgClient.query(
        `CREATE DATABASE ${databaseName} OWNER ${databaseOwner};`
      );
      await pgClient.query(
        `REVOKE ALL ON DATABASE ${databaseName} FROM PUBLIC;`
      );
      console.log(
        `graphile-migrate${logSuffix}: recreated database '${databaseName}'`
      );
    }
  );
  if (parsedSettings.afterReset) {
    const afterReset = Array.isArray(parsedSettings.afterReset)
      ? parsedSettings.afterReset
      : [parsedSettings.afterReset];
    for (const afterResetItem of afterReset) {
      if (typeof afterResetItem === "string") {
        // SQL
        await withClient(
          connectionString,
          parsedSettings,
          async (pgClient, context) => {
            const body = await fsp.readFile(
              `${parsedSettings.migrationsFolder}/${afterResetItem}`,
              "utf8"
            );
            const query = generatePlaceholderReplacement(
              parsedSettings,
              context
            )(body);
            // tslint:disable-next-line no-console
            console.log(query);
            await pgClient.query({
              text: query,
            });
          }
        );
      } else if (isCommandSpec(afterResetItem)) {
        // Run the command
        const { stdout, stderr } = await exec(afterResetItem.command, {
          env: {
            PATH: process.env.PATH,
            DATABASE_URL: connectionString,
          },
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        });
        if (stdout) {
          // tslint:disable-next-line no-console
          console.log(stdout);
        }
        if (stderr) {
          // tslint:disable-next-line no-console
          console.error(stderr);
        }
      }
    }
  }
  await _migrate(parsedSettings, shadow);
}

export async function _commit(parsedSettings: ParsedSettings) {
  const { migrationsFolder } = parsedSettings;
  const committedMigrationsFolder = `${migrationsFolder}/committed`;
  const allMigrations = await getAllMigrations(parsedSettings);
  const lastMigration = allMigrations[allMigrations.length - 1];
  const newMigrationNumber = lastMigration
    ? parseInt(lastMigration.filename, 10) + 1
    : 1;
  if (Number.isNaN(newMigrationNumber)) {
    throw new Error("Could not determine next migration number");
  }
  const newMigrationFilename =
    String(newMigrationNumber).padStart(6, "0") + ".sql";
  const currentMigrationPath = getCurrentMigrationPath(parsedSettings);
  const body = await fsp.readFile(currentMigrationPath, "utf8");
  const minifiedBody = pgMinify(body);
  if (minifiedBody === "") {
    throw new Error("Current migration is blank.");
  }

  const hash = calculateHash(body, lastMigration && lastMigration.hash);
  const finalBody = `--! Previous: ${
    lastMigration ? lastMigration.hash : "-"
  }\n--! Hash: ${hash}\n\n${body.trim()}\n`;
  await _reset(parsedSettings, true);
  const newMigrationFilepath = `${committedMigrationsFolder}/${newMigrationFilename}`;
  await fsp.writeFile(newMigrationFilepath, finalBody);
  console.log(
    `graphile-migrate: New migration '${newMigrationFilename}' created`
  );
  try {
    await _migrate(parsedSettings, true);
    await _migrate(parsedSettings);
    await fsp.writeFile(currentMigrationPath, BLANK_MIGRATION_CONTENT);
  } catch (e) {
    logDbError(e);
    console.error("ABORTING...");
    await fsp.writeFile(currentMigrationPath, body);
    await fsp.unlink(newMigrationFilepath);
    console.error("ABORTED AND ROLLED BACK");
    process.exitCode = 1;
  }
}
