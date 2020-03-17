import pgMinify = require("pg-minify");
import { CommandModule } from "yargs";

import { getCurrentMigrationLocation, readCurrentMigration } from "../current";
import { getLastMigration, getMigrationsAfter } from "../migration";
import { withClient } from "../pg";
import { ParsedSettings, parseSettings, Settings } from "../settings";
import { getSettings } from "./_common";

interface Status {
  remainingMigrations?: Array<string>;
  hasCurrentMigration: boolean;
}

interface StatusOptions {
  skipDatabase?: boolean;
}

async function _status(
  parsedSettings: ParsedSettings,
  { skipDatabase }: StatusOptions,
): Promise<Status> {
  // Checks that don't need a database connection
  const currentLocation = await getCurrentMigrationLocation(parsedSettings);
  const body = await readCurrentMigration(parsedSettings, currentLocation);
  const minifiedBody = pgMinify(body);
  const hasCurrentMigration = minifiedBody !== "";

  // Checks that need a database connection
  let remainingMigrations: undefined | string[];
  if (!skipDatabase) {
    const connectionString = parsedSettings.connectionString;
    if (!connectionString) {
      throw new Error("Could not determine connection string");
    }
    await withClient(connectionString, parsedSettings, async pgClient => {
      const lastMigration = await getLastMigration(pgClient, parsedSettings);
      const remainingMigrationDefinitions = await getMigrationsAfter(
        parsedSettings,
        lastMigration,
      );
      remainingMigrations = remainingMigrationDefinitions.map(m => m.filename);
      return {
        remainingMigrations,
      };
    });
  }

  return {
    remainingMigrations,
    hasCurrentMigration,
  };
}

export async function status(
  settings: Settings,
  options: StatusOptions = {},
): Promise<Status> {
  const parsedSettings = await parseSettings(settings, true);
  return _status(parsedSettings, options);
}

export const statusCommand: CommandModule<never, StatusOptions> = {
  command: "status",
  aliases: [],
  describe: `\
Exits with a bitmap status code indicating statuses:

- 1 if there are committed migrations that have not been executed yet (requires DB connection)
- 2 if the current migration is non-empty (ignoring comments)

If both of the above are true then the output status will be 3 (1+2). If neither
are true, exit status will be 0 (success). Additional messages may also be output.`,
  builder: {
    skipDatabase: {
      type: "boolean",
      description: "Skip checks that require a database connection.",
      default: false,
    },
  },
  handler: async argv => {
    /* eslint-disable no-console */
    let exitCode = 0;
    const details = await status(await getSettings(), argv);
    if (details.remainingMigrations) {
      const remainingCount = details.remainingMigrations?.length;
      if (remainingCount > 0) {
        console.log(
          `There are ${remainingCount} committed migrations pending:\n\n  ${details.remainingMigrations.join(
            "\n  ",
          )}`,
        );
        exitCode += 1;
      }
    }
    if (details.hasCurrentMigration) {
      if (exitCode) {
        console.log();
      }
      console.log(
        "The current migration is not empty and has not been committed.",
      );
      exitCode += 2;
    }

    // ESLint false positive.
    // eslint-disable-next-line require-atomic-updates
    process.exitCode = exitCode;

    if (exitCode === 0) {
      console.log("Up to date.");
    }
    /* eslint-enable */
  },
};
