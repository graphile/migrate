import {
  parseSettings,
  Settings,
  ParsedSettings,
  getCurrentMigrationPath,
} from "../settings";
import { getAllMigrations, undoMigration } from "../migration";
import pgMinify = require("pg-minify");
import * as fsp from "../fsp";
import { _reset } from "./reset";
import { _migrate } from "./migrate";

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
  const currentMigrationPath = getCurrentMigrationPath(parsedSettings);
  const currentBody = await fsp.readFile(currentMigrationPath, "utf8");
  const minifiedCurrentBody = pgMinify(currentBody);
  if (minifiedCurrentBody !== "") {
    throw new Error("Cannot uncommit - current migration is not blank.");
  }

  // Restore current.sql from migration
  const lastMigrationFilename = lastMigration.title
    ? lastMigration.filename.replace(".sql", `-${lastMigration.title}.sql`)
    : lastMigration.filename;
  const lastMigrationFilepath = `${committedMigrationsFolder}/${lastMigrationFilename}`;
  const body = await fsp.readFile(lastMigrationFilepath, "utf8");
  const nn = body.indexOf("\n\n");
  if (nn < 10) {
    throw new Error(
      `Migration '${lastMigrationFilepath}' seems invalid - could not read metadata`
    );
  }
  const bodyWithoutMetadata = body.substr(nn + 2);

  // Slip in a title comment to allow for the migration to be uncommitted and recommitted without destroying the title
  const titleMarker = "--! Title:";
  const titleLine = lastMigration.title
    ? `--! Title: ${lastMigration.title}\n`
    : "";
  const completeBody = bodyWithoutMetadata.includes(titleMarker)
    ? bodyWithoutMetadata.replace(/--! Title: .*\n/, titleLine)
    : `${titleLine}${bodyWithoutMetadata}`;

  await fsp.writeFile(currentMigrationPath, completeBody);

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
