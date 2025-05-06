import { CommandModule } from "yargs";

import { executeActions } from "../actions";
import { escapeIdentifier, withClient } from "../pg";
import { ParsedSettings, parseSettings, Settings } from "../settings";
import { CommonArgv, getSettings } from "./_common";
import { _migrate } from "./migrate";

interface ResetArgv extends CommonArgv {
  shadow: boolean;
  erase: boolean;
  force: boolean;
}

export async function _reset(
  parsedSettings: ParsedSettings,
  shadow: boolean,
  force: boolean,
): Promise<void> {
  const connectionString = shadow
    ? parsedSettings.shadowConnectionString
    : parsedSettings.connectionString;
  if (!connectionString) {
    throw new Error("Could not determine connection string for reset");
  }
  await executeActions(parsedSettings, shadow, parsedSettings.beforeReset);
  await withClient(
    parsedSettings.rootConnectionString,
    parsedSettings,
    async (pgClient) => {
      const databaseName = shadow
        ? parsedSettings.shadowDatabaseName
        : parsedSettings.databaseName;
      if (!databaseName) {
        throw new Error("Database name unknown");
      }
      const databaseOwner = parsedSettings.databaseOwner;
      const logSuffix = shadow ? "[shadow]" : "";
      if (force) {
        await pgClient.query(
          `DROP DATABASE IF EXISTS ${escapeIdentifier(databaseName)} WITH (FORCE);`,
        );
      } else {
        await pgClient.query(
          `DROP DATABASE IF EXISTS ${escapeIdentifier(databaseName)};`,
        );
      }
      parsedSettings.logger.info(
        `graphile-migrate${logSuffix}: dropped database '${databaseName}'`,
      );
      try {
        await pgClient.query(
          `CREATE DATABASE ${escapeIdentifier(
            databaseName,
          )} OWNER ${escapeIdentifier(databaseOwner)};`,
        );
      } catch (e) {
        throw new Error(
          `Failed to create database '${databaseName}' with owner '${databaseOwner}': ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      await pgClient.query(
        `REVOKE ALL ON DATABASE ${escapeIdentifier(databaseName)} FROM PUBLIC;`,
      );
      parsedSettings.logger.info(
        `graphile-migrate${logSuffix}: recreated database '${databaseName}'`,
      );
    },
  );
  await executeActions(parsedSettings, shadow, parsedSettings.afterReset);
  await _migrate(parsedSettings, shadow);
}

export async function reset(
  settings: Settings,
  shadow = false,
  force = false,
): Promise<void> {
  const parsedSettings = await parseSettings(settings, shadow);
  return _reset(parsedSettings, shadow, force);
}

export const resetCommand: CommandModule<Record<string, never>, ResetArgv> = {
  command: "reset",
  aliases: [],
  describe:
    "Drops and re-creates the database, re-running all committed migrations from the start. **HIGHLY DESTRUCTIVE**.",
  builder: {
    shadow: {
      type: "boolean",
      default: false,
      description: "Applies migrations to shadow DB.",
    },
    erase: {
      type: "boolean",
      default: false,
      description:
        "This is your double opt-in to make it clear this DELETES EVERYTHING.",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Terminate all existing connections to the database.",
    },
  },
  handler: async (argv) => {
    if (!argv.erase) {
      // eslint-disable-next-line no-console
      console.error(
        "DANGER! Reset is highly destructive. If you're sure you want to do this, please add --erase to your command.",
      );
      process.exit(2);
    }
    await reset(
      await getSettings({ configFile: argv.config }),
      argv.shadow,
      argv.force,
    );
  },
};
