import { getAllMigrations } from "../migration";
import { ParsedSettings, parseSettings, Settings } from "../settings";
import pgMinify = require("pg-minify");
import { promises as fsp } from "fs";

import {
  getCurrentMigrationLocation,
  readCurrentMigration,
  writeCurrentMigration,
} from "../current";
import { calculateHash } from "../hash";
import { logDbError } from "../instrumentation";
import { _migrate } from "./migrate";
import { _reset } from "./reset";

export async function _commit(parsedSettings: ParsedSettings): Promise<void> {
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

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);
  const body = await readCurrentMigration(parsedSettings, currentLocation);

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
  // eslint-disable-next-line no-console
  console.log(
    `graphile-migrate: New migration '${newMigrationFilename}' created`,
  );
  try {
    await _migrate(parsedSettings, true);
    await _migrate(parsedSettings);
    await writeCurrentMigration(
      parsedSettings,
      currentLocation,
      parsedSettings.blankMigrationContent,
    );
  } catch (e) {
    logDbError(e);
    // eslint-disable-next-line no-console
    console.error("ABORTING...");
    await writeCurrentMigration(parsedSettings, currentLocation, body);
    await fsp.unlink(newMigrationFilepath);
    // eslint-disable-next-line no-console
    console.error("ABORTED AND ROLLED BACK");
    process.exitCode = 1;
  }
}

export async function commit(settings: Settings): Promise<void> {
  const parsedSettings = await parseSettings(settings, true);
  return _commit(parsedSettings);
}
