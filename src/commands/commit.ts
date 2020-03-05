import pgMinify = require("pg-minify");
import { promises as fsp } from "fs";

import {
  getCurrentMigrationLocation,
  readCurrentMigration,
  writeCurrentMigration,
} from "../current";
import { calculateHash } from "../hash";
import { logDbError } from "../instrumentation";
import { getAllMigrations, isMigrationFilename } from "../migration";
import { ParsedSettings, parseSettings, Settings } from "../settings";
import { sluggify } from "../sluggify";
import { _migrate } from "./migrate";
import { _reset } from "./reset";

export async function _commit(
  parsedSettings: ParsedSettings,
  messageOverride: string | null | undefined = undefined,
): Promise<void> {
  const { migrationsFolder } = parsedSettings;

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);
  const body = await readCurrentMigration(parsedSettings, currentLocation);

  const committedMigrationsFolder = `${migrationsFolder}/committed`;
  const allMigrations = await getAllMigrations(parsedSettings);
  const lastMigration = allMigrations[allMigrations.length - 1];
  const newMigrationNumber = lastMigration
    ? parseInt(lastMigration.filename, 10) + 1
    : 1;
  if (Number.isNaN(newMigrationNumber)) {
    throw new Error("Could not determine next migration number");
  }

  const messageMatches = /^--! Message:(.*)(\r?\n|$)/.exec(body);
  const messageFromComment = messageMatches ? messageMatches[1].trim() : null;

  const message =
    messageOverride !== undefined ? messageOverride : messageFromComment;

  const sluggifiedMessage = message ? sluggify(message) : null;

  const newMigrationFilename =
    String(newMigrationNumber).padStart(6, "0") +
    (sluggifiedMessage ? `-${sluggifiedMessage}` : "") +
    ".sql";
  if (!isMigrationFilename(newMigrationFilename)) {
    throw Error("Could not construct migration filename");
  }
  const bodyWithoutMessage = messageMatches
    ? body.substr(messageMatches[0].length)
    : body;
  const minifiedBody = pgMinify(bodyWithoutMessage);
  if (minifiedBody === "") {
    throw new Error("Current migration is blank.");
  }

  const hash = calculateHash(
    bodyWithoutMessage,
    lastMigration && lastMigration.hash,
  );
  const messageLine = message ? `--! Message: ${message}\n` : "";
  const finalBody = `--! Previous: ${
    lastMigration ? lastMigration.hash : "-"
  }\n--! Hash: ${hash}\n${messageLine}\n${bodyWithoutMessage.trim()}\n`;
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

export async function commit(
  settings: Settings,
  message?: string | null,
): Promise<void> {
  const parsedSettings = await parseSettings(settings, true);
  return _commit(parsedSettings, message);
}
