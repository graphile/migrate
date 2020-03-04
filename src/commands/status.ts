import { ParsedSettings, parseSettings, Settings } from "../settings";
import { withClient } from "../pg";
import { getLastMigration, getMigrationsAfter } from "../migration";
import pgMinify = require("pg-minify");
import { getCurrentMigrationLocation, readCurrentMigration } from "../current";

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
      lastMigration
    );
    const currentLocation = await getCurrentMigrationLocation(parsedSettings);
    const currentBody = await readCurrentMigration(
      parsedSettings,
      currentLocation
    );
    const minifiedBody = pgMinify(currentBody);
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
