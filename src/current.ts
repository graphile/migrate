import * as assert from "assert";
import { promises as fsp, Stats } from "fs";

import { isNoTransactionDefined } from "./header";
import { parseMigrationText, serializeHeader } from "./migration";
import { ParsedSettings } from "./settings";

export const VALID_FILE_REGEX = /^([0-9]+)(-[-_a-zA-Z0-9]*)?\.sql$/;

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await fsp.stat(path);
  } catch (e) {
    if (e.code === "ENOENT") {
      return null;
    }
    throw e;
  }
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await fsp.readFile(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") {
      return null;
    }
    throw e;
  }
}
async function readFileOrError(path: string): Promise<string> {
  try {
    return await fsp.readFile(path, "utf8");
  } catch (e) {
    throw new Error(`Failed to read file at '${path}': ${e.message}`);
  }
}

export interface CurrentMigrationLocation {
  isFile: boolean;
  path: string;
  exists: boolean;
  // stats: Stats,
}

export async function getCurrentMigrationLocation(
  parsedSettings: ParsedSettings,
): Promise<CurrentMigrationLocation> {
  const filePath = `${parsedSettings.migrationsFolder}/current.sql`;
  const dirPath = `${parsedSettings.migrationsFolder}/current`;

  const fileStats = await statOrNull(filePath);
  const dirStats = await statOrNull(dirPath);

  if (fileStats && !fileStats.isFile()) {
    throw new Error(`'${filePath}' exists but is not a file.`);
  }
  if (dirStats && !dirStats.isDirectory()) {
    throw new Error(`'${dirPath}' exists but is not a directory.`);
  }

  if (fileStats && dirStats) {
    throw new Error(
      `Invalid current migration: both the '${filePath}' file and the '${dirPath}' directory exist; only one of these may exist at a time.`,
    );
  }

  const isFile = !dirStats;
  const stats = isFile ? fileStats : dirStats;
  const exists = !!stats;

  return {
    isFile,
    path: isFile ? filePath : dirPath,
    exists,
    // stats,
  };
}

function idFromFilename(file: string): number {
  const matches = VALID_FILE_REGEX.exec(file);
  if (!matches) {
    throw new Error(
      `Invalid current migration filename: '${file}'. File must follow the naming 001.sql or 001-message.sql, where 001 is a unique number (with optional zero padding) and message is an optional alphanumeric string.`,
    );
  }
  const [, rawId, _message] = matches;
  const id = parseInt(rawId, 10);

  if (!id || !isFinite(id) || id < 1) {
    throw new Error(
      `Invalid current migration filename: '${file}'. File must start with a (positive) number, could not coerce '${rawId}' to int.`,
    );
  }
  return id;
}

export async function readCurrentMigration(
  _parsedSettings: ParsedSettings,
  location: CurrentMigrationLocation,
): Promise<string> {
  if (location.isFile) {
    const content = await readFileOrNull(location.path);

    // If file doesn't exist, treat it as if it were empty.
    return content || "";
  } else {
    const files = await fsp.readdir(location.path);
    const parts = new Map<
      number,
      {
        filePath: string;
        file: string;
        bodyPromise: Promise<string>;
      }
    >();

    for (const file of files) {
      // Do not await during this loop, it will limit parallelism

      if (file.startsWith(".")) {
        // Ignore dotfiles
        continue;
      }
      if (!file.endsWith(".sql")) {
        // Skip non-SQL files
        continue;
      }
      const id = idFromFilename(file);
      const duplicate = parts.get(id);
      if (duplicate) {
        throw new Error(
          `Current migration filename clash: files must have a unique numeric prefix, but at least 2 files ('${file}' and '${duplicate.file}') have the prefix '${id}'.`,
        );
      }

      const filePath = `${location.path}/${file}`;
      const bodyPromise = readFileOrError(filePath);

      parts.set(id, {
        filePath,
        file,
        bodyPromise,
      });
    }

    const ids = [...parts.keys()].sort((a, b) => a - b);
    let wholeBody = "";

    // Like hobbitses
    const headerses: Array<{ [key: string]: string | null }> = [];

    for (const id of ids) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { file, filePath, bodyPromise } = parts.get(id)!;
      const contents = await bodyPromise;
      const { body, headers } = parseMigrationText(filePath, contents, false);
      headerses.push(headers);
      if (isNoTransactionDefined(body)) {
        throw new Error(
          `Error in '${location.path}/${file}': cannot use '--! no-transaction' with 'current/' directory migrations; use 'current.sql' instead.`,
        );
      }
      if (wholeBody.length > 0) {
        wholeBody += "\n";
      }
      // 'split' is not a "header", so it must NOT start with a capital.
      wholeBody += `--! split: ${file}\n`;
      wholeBody += body.trim() + "\n";
    }
    const headerLines: string[] = [];
    for (const headers of headerses) {
      for (const key of Object.keys(headers)) {
        const value = headers[key];
        headerLines.push(serializeHeader(key, value));
      }
    }
    if (headerLines.length) {
      wholeBody = headerLines.join("\n") + "\n\n" + wholeBody;
    }
    return wholeBody;
  }
}

export async function writeCurrentMigration(
  parsedSettings: ParsedSettings,
  location: CurrentMigrationLocation,
  body: string,
): Promise<void> {
  if (body.trim() + "\n" !== body) {
    throw new Error(
      "graphile-migrate error - 'body' should be sanitized before being passed to 'writeCurrentMigration'",
    );
  }
  if (location.isFile) {
    await fsp.writeFile(location.path, body);
  } else {
    // Split body and write to files

    const lines = body.split("\n");

    /**
     * List of filenames we've written, so we can determine which files not to
     * delete.
     */
    const filenamesWritten: string[] = [];

    /**
     * List of write operation promises, so we can do all our waiting in
     * parallel at the end.
     */
    const writePromises: Array<Promise<void>> = [];

    /**
     * The next file that will be written to, once all lines are accumulated.
     */
    let nextFileToWrite: string | null = null;

    /**
     * The lines being accumulated to write to `nextFileToWrite`.
     */
    let linesToWrite: string[] = [];

    /**
     * The highest file index we've seen, so that we can ensure that we don't
     * have any ambiguities or conflicts.
     */
    let highestIndex = 0;
    let highestIndexFilename: string | null = null;

    /**
     * Writes `linesToWrite` to `nextFileToWrite` (or '001.sql' if unknown), then
     * resets these variables ready for the next batch.
     */
    const flushToFile = (force = false): void => {
      if (!linesToWrite.length && !nextFileToWrite) {
        // Optimisation to avoid writing the initial empty migration file before the first `--! split`
        return;
      }
      const sql = linesToWrite.join("\n").trim() + "\n";
      const fileName =
        nextFileToWrite || (force ? `${highestIndex + 1}-current.sql` : null);
      if (!fileName) {
        // Merge into first file
        return;
      }
      const id = idFromFilename(fileName);
      if (id <= highestIndex) {
        throw new Error(
          `Bad migration, split ids must be monotonically increasing, but '${id}' (from '${fileName}') <= '${highestIndex}' (from '${highestIndexFilename}').`,
        );
      }
      highestIndex = id;
      highestIndexFilename = fileName;

      writePromises.push(fsp.writeFile(`${location.path}/${fileName}`, sql));
      filenamesWritten.push(fileName);

      linesToWrite = [];
      nextFileToWrite = null;
    };

    for (const line of lines) {
      // Do not await in this loop, it decreases parallelism

      const matches = /^--! split: ([0-9]+(?:-[-_a-zA-Z0-9]+)?\.sql)$/.exec(
        line,
      );
      if (matches) {
        // Write out previous linesToWrite, if appropriate
        flushToFile();

        // Prepare to write next linesToWrite
        nextFileToWrite = matches[1];
      } else {
        // Regular line, just add to next linesToWrite
        linesToWrite.push(line);
      }
    }

    // Handle any trailing lines
    flushToFile(true);

    if (writePromises.length === 0) {
      // Body must have been empty, so no files were written.
      assert.equal(body.length, 0);

      // Lets write out just the one empty file.
      const filename = `001.sql`;
      const sql = parsedSettings.blankMigrationContent;

      writePromises.push(fsp.writeFile(`${location.path}/${filename}`, sql));
      filenamesWritten.push(filename);
    }

    // Clear out old files that were not overwritten
    const files = await fsp.readdir(location.path);
    for (const file of files) {
      if (
        VALID_FILE_REGEX.test(file) &&
        !file.startsWith(".") &&
        file.endsWith(".sql") &&
        !filenamesWritten.includes(file)
      ) {
        writePromises.push(fsp.unlink(`${location.path}/${file}`));
      }
    }

    // Wait for writing to finish
    await Promise.all(writePromises);
  }
}
