import pgMinify = require("pg-minify");
import * as fsp from "fs/promises";
import { CommandModule } from "yargs";

import {
  getCurrentMigrationLocation,
  readCurrentMigration,
  writeCurrentMigration,
} from "../current";
import {
  getAllMigrations,
  parseMigrationText,
  serializeMigration,
  undoMigration,
} from "../migration";
import { ParsedSettings, parseSettings, Settings } from "../settings";
import { CommonArgv, getSettings } from "./_common";
import { _migrate } from "./migrate";
import { _reset } from "./reset";

export async function _uncommit(parsedSettings: ParsedSettings): Promise<void> {
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
  const lastMigrationFilepath = lastMigration.fullPath;
  const contents = await fsp.readFile(lastMigrationFilepath, "utf8");
  const { headers, body } = parseMigrationText(lastMigrationFilepath, contents);

  // Drop Hash, Previous and AllowInvalidHash from headers; then write out
  const { Hash, Previous, AllowInvalidHash, ...otherHeaders } = headers;
  const completeBody = serializeMigration(body, otherHeaders);
  await writeCurrentMigration(parsedSettings, currentLocation, completeBody);

  // Delete the migration from committed and from the DB
  await fsp.unlink(lastMigrationFilepath);
  await undoMigration(parsedSettings, lastMigration);

  parsedSettings.logger.info(
    `graphile-migrate: migration '${lastMigrationFilepath}' undone`,
  );

  // Reset shadow
  await _reset(parsedSettings, true);
  await _migrate(parsedSettings, true, true);
}

export async function uncommit(settings: Settings): Promise<void> {
  const parsedSettings = await parseSettings(settings, true);
  return _uncommit(parsedSettings);
}

export const uncommitCommand: CommandModule<
  Record<string, never>,
  CommonArgv
> = {
  command: "uncommit",
  aliases: [],
  describe:
    "This command is useful in development if you need to modify your latest commit before you push/merge it, or if other DB commits have been made by other developers and you need to 'rebase' your migration onto theirs. Moves the latest commit out of the committed migrations folder and back to the current migration (assuming the current migration is empty-ish). Removes the migration tracking entry from ONLY the local database. Do not use after other databases have executed this committed migration otherwise they will fall out of sync. Assuming nothing else has changed, `graphile-migrate uncommit && graphile-migrate commit` should result in the exact same hash. Development only, and liable to cause conflicts with other developers - be careful.",
  builder: {},
  handler: async (argv) => {
    if (argv.message !== undefined && !argv.message) {
      throw new Error("Missing or empty commit message after --message flag");
    }
    await uncommit(await getSettings({ configFile: argv.config }));
  },
};
