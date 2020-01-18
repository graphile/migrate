import * as fsp from "./fsp";
import { isNoTransactionDefined } from "./header";
import { ParsedSettings } from "./settings";

export interface CurrentOptions {
  readBody: boolean;
  splitBody?: boolean;
}

export interface Current {
  path: string;
  isFile: boolean;
  exists: boolean;
  body: string;
}

const VALID_FILE_REGEX = /^([0-9]+)(-[-_a-z0-9]+)?\.sql$/g;
const SPLIT_REGEX = /^--! split: ([0-9]+)(-[-_a-z0-9]+)?\.sql\n$/gm;
const SPLIT = "--! split: {file}\n";
const BLANK_MIGRATION_CONTENT = "-- Enter migration here\n";

function getCurrentMigrationFilePath(parsedSettings: ParsedSettings): string {
  return `${parsedSettings.migrationsFolder}/current.sql`;
}

function getCurrentMigrationDirectoryPath(
  parsedSettings: ParsedSettings
): string {
  return `${parsedSettings.migrationsFolder}/current`;
}

export async function getCurrent(
  parsedSettings: ParsedSettings,
  { readBody, splitBody = false }: CurrentOptions
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

    if (readBody) {
      body = (await fsp.readFile(path, "utf8")).trim();
    } else {
      body = "";
    }
  } else {
    path = directoryPath;
    isFile = false;
    const files = await fsp.readdir(directoryPath);
    exists = files.length > 0;

    if (exists && readBody) {
      const parts = new Map<number, string>();
      for (const file of files) {
        const match = [...file.matchAll(VALID_FILE_REGEX)];
        if (match.length != 1) {
          throw new Error(
            `Invalid current migration filename: ${file}. File must follow the naming 1.sql or 1-message.sql, where 1 is a unique number and message is optional.`
          );
        }

        const matchResult = match[0];
        const id = Number(matchResult[1]);
        if (isNaN(id) || parts.has(id)) {
          throw new Error(
            `Invalid current migration filename: ${file}. File must start with a unique number.`
          );
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

        if (isNoTransactionDefined(body) && files.length > 1) {
          throw new Error(
            "Cannot use --! no-transaction with multiple current migration files."
          );
        }

        if (splitBody) {
          const fileSplit = SPLIT.replace("{file}", file);
          body = `${fileSplit}\n${body}`;
        }

        parts.set(id, body);
      }

      // Sort body parts
      const ids = [...parts.keys()].sort((a, b) => a - b);

      body = ids.map(id => parts.get(id)).join("\n\n") + "\n";
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

export async function writeBlankCurrent(current: Current): Promise<void> {
  if (current.isFile) {
    await fsp.writeFile(current.path, BLANK_MIGRATION_CONTENT);
  } else {
    const files = await fsp.readdir(current.path);
    for (const file of files) {
      await fsp.unlink(`${current.path}/${file}`);
    }
    await fsp.writeFile(`${current.path}/1.sql`, BLANK_MIGRATION_CONTENT);
  }
}

export async function writeCurrentFromCommit(
  parsedSettings: ParsedSettings,
  body: string
): Promise<void> {
  const parts: Array<RegExpMatchArray> = [...body.matchAll(SPLIT_REGEX)];
  if (parts.length == 0) {
    await fsp.writeFile(getCurrentMigrationFilePath(parsedSettings), body);
  } else {
    const directory = getCurrentMigrationDirectoryPath(parsedSettings);

    try {
      const files = await fsp.readdir(directory);
      for (const file of files) {
        await fsp.unlink(`${directory}/${file}`);
      }
    } catch (e) {
      if (e.code !== "ENOENT") {
        throw e;
      }
    }

    for (let i = 0; i < parts.length; ++i) {
      const part = parts[i];
      if (part.index == undefined) {
        // Not possible but required for compiler and lint validation
        continue;
      }

      const name =
        part
          .slice(1, part.length)
          .filter((it: string | undefined) => it != undefined)
          .join("") + ".sql";

      const bodyPart =
        body
          .substring(
            part.index + part[0].length,
            i < parts.length - 1 ? parts[i + 1].index : body.length
          )
          .trim() + "\n";

      fsp.writeFile(`${directory}/${name}`, bodyPart);
    }
  }
}
