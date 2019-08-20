import {
  Settings,
  parseSettings,
  ParsedSettings,
  getCurrentMigrationPath,
} from "../settings";
import { withClient } from "../pg";
import { getLastMigration, getMigrationsAfter } from "../migration";
import pgMinify = require("pg-minify");
import * as fsp from "../fsp";

export async function status(settings: Settings) {
  const parsedSettings = await parseSettings(settings, true);
  return _status(parsedSettings);
}

async function _status(parsedSettings: ParsedSettings) {
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
    const currentMigrationPath = getCurrentMigrationPath(parsedSettings);
    const body = await fsp.readFile(currentMigrationPath, "utf8");
    const minifiedBody = pgMinify(body);
    const hasCurrentMigration = minifiedBody !== "";
    return {
      remainingMigrations: remainingMigrations.map(m => m.filename),
      hasCurrentMigration,
    };
  });
}
