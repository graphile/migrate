import { constants, promises as fsp } from "fs";
import * as JSON5 from "json5";
import { parse } from "pg-connection-string";

import { Settings } from "../settings";

export const makeGmrcJsPath = (gmrcPath: string): string => `${gmrcPath}.js`;
export const DEFAULT_GMRC_PATH = `${process.cwd()}/.gmrc`;
export const DEFAULT_GMRCJS_PATH = makeGmrcJsPath(DEFAULT_GMRC_PATH);

// Used to type `argv` in all commands
export type ConfigOptions = { config?: string };

export async function exists(path: string): Promise<boolean> {
  try {
    await fsp.access(path, constants.F_OK /* visible to us */);
    return true;
  } catch (e) {
    return false;
  }
}

export async function getSettingsFromJSON(path: string): Promise<Settings> {
  let data;
  try {
    data = await fsp.readFile(path, "utf8");
  } catch (e) {
    throw new Error(`Failed to read '${path}': ${e.message}`);
  }
  try {
    return JSON5.parse(data);
  } catch (e) {
    throw new Error(`Failed to parse '${path}': ${e.message}`);
  }
}

export async function getSettings({
  configFile,
}: { configFile?: string } = {}): Promise<Settings> {
  let settings: Settings;

  const tryRequire = (path: string): Settings => {
    try {
      return require(path);
    } catch (e) {
      throw new Error(
        `Failed to import '${path}'; error:\n    ${e.stack.replace(
          /\n/g,
          "\n    ",
        )}`,
      );
    }
  };

  if (configFile != null) {
    if (!(await exists(configFile))) {
      throw new Error(`Failed to import '${configFile}': file not found`);
    }

    if (configFile.endsWith(".js")) {
      settings = tryRequire(configFile);
    } else {
      settings = await getSettingsFromJSON(configFile);
    }
  } else if (await exists(DEFAULT_GMRC_PATH)) {
    settings = await getSettingsFromJSON(DEFAULT_GMRC_PATH);
  } else if (await exists(DEFAULT_GMRCJS_PATH)) {
    settings = tryRequire(DEFAULT_GMRCJS_PATH);
  } else {
    throw new Error(
      "No .gmrc file found; please run `graphile-migrate init` first.",
    );
  }

  return settings;
}

export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");

    process.stdin.on("error", reject);
    process.stdin.on("readable", () => {
      let chunk;
      // Use a loop to make sure we read all available data.
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on("end", () => {
      resolve(data);
    });
  });
}

export function getDatabaseName(connectionString: string): string {
  const databaseName = parse(connectionString).database;
  if (!databaseName) {
    throw new Error(
      "Could not determine database name from connection string.",
    );
  }
  return databaseName;
}
