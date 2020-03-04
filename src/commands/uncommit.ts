import { getAllMigrations, undoMigration } from "../migration";
import { ParsedSettings, parseSettings, Settings } from "../settings";
import pgMinify = require("pg-minify");
import { promises as fsp } from "fs";

import {
  getCurrentMigrationLocation,
  readCurrentMigration,
  writeCurrentMigration,
} from "../current";
import { _migrate } from "./migrate";
import { _reset } from "./reset";

export async function _uncommit(parsedSettings: ParsedSettings): Promise<void> {
  const { migrationsFolder } = parsedSettings;
  const committedMigrationsFolder = `${migrationsFolder}/committed`;

  // Determine the last migration
  const allMigrations = await getAllMigrations(parsedSettings);
  const lastMigration = allMigrations[allMigrations.length - 1];
  if (!lastMigration) {
    throw new Error("There's no committed migration to uncommit");
  }

  // Check current.sql is blank
  const currentLocation = await getCurrentMigrationLocation(parsedSettings);
  const currentBody = await readCurrentMigration(
    parsedSettings,
    currentLocation,
  );
  const minifiedCurrentBody = pgMinify(currentBody);
  if (minifiedCurrentBody !== "") {
    throw new Error("Cannot uncommit - current migration is not blank.");
  }

  // Restore current.sql from migration
  const lastMigrationFilepath = `${committedMigrationsFolder}/${lastMigration.filename}`;
  const body = await fsp.readFile(lastMigrationFilepath, "utf8");
  const nn = body.indexOf("\n\n");
  if (nn < 10) {
    throw new Error(
      `Migration '${lastMigrationFilepath}' seems invalid - could not read metadata`,
    );
  }
  const bodyWithoutMetadata = body.substr(nn + 2);
  await writeCurrentMigration(
    parsedSettings,
    currentLocation,
    bodyWithoutMetadata,
  );

  // Delete the migration from committed and from the DB
  await fsp.unlink(lastMigrationFilepath);
  await undoMigration(parsedSettings, lastMigration);

  // eslint-disable-next-line no-console
  console.log(`graphile-migrate: migration '${lastMigrationFilepath}' undone`);

  // Reset shadow
  await _reset(parsedSettings, true);
  await _migrate(parsedSettings, true, true);
}

export async function uncommit(settings: Settings): Promise<void> {
  const parsedSettings = await parseSettings(settings, true);
  return _uncommit(parsedSettings);
}
