import * as fsp from "./fsp";
import { ParsedSettings } from "./settings";

export enum CurrentMigrationFormat {
  Minimal,
  Commit,
}

export interface Current {
  path: string;
  isFile: boolean;
  exists: boolean;
  body: string;
}

export async function getCurrent(
  parsedSettings: ParsedSettings,
  format: CurrentMigrationFormat = CurrentMigrationFormat.Minimal
): Promise<Current> {
  const filePath = getCurrentMigrationFilePath(parsedSettings);
  const directoryPath = getCurrentMigrationDirectoryPath(parsedSettings);

  let fileExists: boolean;
  try {
    fileExists = (await fsp.stat(filePath)).isFile();
  } catch (e) {
    if (e.code !== "ENOENT") {
      throw e;
    }
    fileExists = false;
  }

  let directoryExists: boolean;
  try {
    directoryExists = (await fsp.stat(directoryPath)).isDirectory();
  } catch (e) {
    if (e.code !== "ENOENT") {
      throw e;
    }
    directoryExists = false;
  }

  if (fileExists && directoryExists) {
    throw new Error(
      "Invalid current migration. Both current.sql and current/ directory cannot co-exist at the same time."
    );
  }

  let path: string;
  let isFile: boolean;
  let exists: boolean;
  let body: string;

  if (fileExists || (!fileExists && !directoryExists)) {
    // Defaults to file if neither file nor directory exist
    path = filePath;
    isFile = true;
    exists = fileExists;
    body = (await fsp.readFile(path, "utf8")).trim();
  } else {
    path = directoryPath;
    isFile = false;

    const files = await fsp.readdir(directoryPath);
    exists = files.length > 0;

    if (exists) {
      // Is sorting necessary, or are files always sorted by filename asc?
      files.sort();

      const bodies = new Array<string>();
      for (let file of files) {
        if (file.match(VALID_FILE_REGEX) == null) {
          throw new Error(`Invalid current migration filename: ${file}`);
        }

        const filePath = `${path}/${file}`;
        let body: string;
        try {
          body = (await fsp.readFile(filePath, "utf8")).trim();
        } catch (e) {
          throw new Error(
            `Failed to read current migration file: ${filePath} (${e.message})`
          );
        }

        if (format == CurrentMigrationFormat.Commit) {
          let fileSplit = SPLIT.replace("{file}", file);
          body = `${fileSplit}\n${body}`;
        }

        bodies.push(body);
      }

      body = bodies.join("\n\n") + "\n";
    } else {
      body = "";
    }
  }

  const current: Current = {
    path,
    isFile,
    exists,
    body,
  };

  return current;
}

export async function writeBlankCurrent(current: Current) {
  if (current.isFile) {
    await fsp.writeFile(current.path, BLANK_MIGRATION_CONTENT);
  } else {
    const files = await fsp.readdir(current.path);
    for (let file of files) {
      await fsp.unlink(`${current.path}/${file}`);
    }
    await fsp.writeFile(`${current.path}/1.sql`, BLANK_MIGRATION_CONTENT);
  }

  current.exists = false;
}

export async function writeCurrentFromCommit(
  parsedSettings: ParsedSettings,
  body: string
) {
  const parts: Array<RegExpMatchArray> = [...body.matchAll(SPLIT_REGEX)];
  if (parts.length == 0) {
    await fsp.writeFile(getCurrentMigrationFilePath(parsedSettings), body);
  } else {
    const directory = getCurrentMigrationDirectoryPath(parsedSettings);

    try {
      const files = await fsp.readdir(directory);
      for (let file of files) {
        await fsp.unlink(`${directory}/${file}`);
      }
    } catch (e) {
      if (e.code !== "ENOENT") {
        throw e;
      }
    }

    for (let i = 0; i < parts.length; ++i) {
      const part = parts[i];

      const name =
        part
          .slice(1, part.length)
          .filter((it: string | undefined) => it != undefined)
          .join("") + ".sql";

      const bodyPart =
        body
          .substring(
            part.index! + part[0].length,
            i < parts.length - 1 ? parts[i + 1].index : body.length
          )
          .trim() + "\n";

      fsp.writeFile(`${directory}/${name}`, bodyPart);
    }
  }
}

const VALID_FILE_REGEX = /^([0-9]+)(-[-_a-z0-9]+)?\.sql$/g;
const SPLIT_REGEX = /^--! split: ([0-9]+)(-[-_a-z0-9]+)?\.sql\n$/gm;
const SPLIT = "--! split: {file}\n";
const BLANK_MIGRATION_CONTENT = "-- Enter migration here\n";

export function getCurrentMigrationFilePath(
  parsedSettings: ParsedSettings
): string {
  return `${parsedSettings.migrationsFolder}/current.sql`;
}

export function getCurrentMigrationDirectoryPath(
  parsedSettings: ParsedSettings
): string {
  return `${parsedSettings.migrationsFolder}/current`;
}
