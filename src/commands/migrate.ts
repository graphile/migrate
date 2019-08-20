import { parseSettings, Settings, ParsedSettings } from "../settings";
import { withClient } from "../pg";
import {
  getLastMigration,
  getMigrationsAfter,
  runCommittedMigration,
} from "../migration";
import { executeActions } from "../actions";

export async function migrate(
  settings: Settings,
  shadow = false,
  force = false
) {
  const parsedSettings = await parseSettings(settings, shadow);
  return _migrate(parsedSettings, shadow, force);
}

export async function _migrate(
  parsedSettings: ParsedSettings,
  shadow = false,
  force = false
) {
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
      if (remainingMigrations.length > 0 || force) {
        await executeActions(
          parsedSettings,
          shadow,
          parsedSettings.afterAllMigrations
        );
      }
      // tslint:disable-next-line no-console
      console.log(
        `graphile-migrate${logSuffix}: ${
          remainingMigrations.length > 0
            ? `${remainingMigrations.length} committed migrations executed`
            : lastMigration
            ? "Already up to date"
            : `Up to date — no committed migrations to run`
        }`
      );
    }
  );
}
