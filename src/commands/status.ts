import pgMinify = require("pg-minify");
import { CommandModule } from "yargs";

import { getCurrentMigrationLocation, readCurrentMigration } from "../current";
import { getLastMigration, getMigrationsAfter } from "../migration";
import { withClient } from "../pg";
import { ParsedSettings, parseSettings, Settings } from "../settings";
import { getSettings } from "./_common";

interface Status {
  remainingMigrations: Array<string>;
  hasCurrentMigration: boolean;
}

async function _status(parsedSettings: ParsedSettings): Promise<Status> {
  const connectionString = parsedSettings.connectionString;
  if (!connectionString) {
    throw new Error("Could not determine connection string");
  }
  return withClient(connectionString, parsedSettings, async pgClient => {
    const lastMigration = await getLastMigration(pgClient, parsedSettings);
    const remainingMigrations = await getMigrationsAfter(
      parsedSettings,
      lastMigration,
    );
    const currentLocation = await getCurrentMigrationLocation(parsedSettings);
    const body = await readCurrentMigration(parsedSettings, currentLocation);
    const minifiedBody = pgMinify(body);
    const hasCurrentMigration = minifiedBody !== "";
    return {
      remainingMigrations: remainingMigrations.map(m => m.filename),
      hasCurrentMigration,
    };
  });
}

export async function status(settings: Settings): Promise<Status> {
  const parsedSettings = await parseSettings(settings, true);
  return _status(parsedSettings);
}

export const statusCommand: CommandModule<never, {}> = {
  command: "status",
  aliases: [],
  describe: `\
Exits with a bitmap status code indicating statuses:

- 1 if there are committed migrations that have not been executed yet
- 2 if the current migration is non-empty (ignoring comments)

If both of the above are true then the output status will be 3 (1+2). If neither
are true, exit status will be 0 (success). Additional messages may also be output.`,
  builder: {},
  handler: async () => {
    /* eslint-disable no-console */
    let exitCode = 0;
    const details = await status(await getSettings());
    const remainingCount = details.remainingMigrations.length;
    if (remainingCount) {
      console.log(
        `There are ${remainingCount} committed migrations pending:\n\n  ${details.remainingMigrations.join(
          "\n  ",
        )}`,
      );
      exitCode += 1;
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
