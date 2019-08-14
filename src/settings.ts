import { parse } from "pg-connection-string";
import * as fsp from "./fsp";
import { makeValidateCommandCallback } from "./commands";

export interface CommandSpec {
  command: string;
}

export type Commands = string | Array<string | CommandSpec>;

export function isCommandSpec(o: unknown): o is CommandSpec {
  return (
    (typeof o === "object" && o && typeof o["command"] === "string") || false
  );
}

export interface Settings {
  connectionString?: string;
  shadowConnectionString?: string;
  rootConnectionString?: string;
  databaseOwner?: string;
  pgSettings?: {
    [key: string]: string;
  };
  placeholders?: {
    [key: string]: string;
  };
  afterReset?: Commands;
}

export interface ParsedSettings extends Settings {
  connectionString: string;
  rootConnectionString: string;
  databaseOwner: string;
  migrationsFolder: string;
  databaseName: string;
  shadowDatabaseName?: string;
}

export async function parseSettings(
  settings: Settings,
  requireShadow = false
): Promise<ParsedSettings> {
  const migrationsFolder = `${process.cwd()}/migrations`;
  if (!settings) {
    throw new Error("Expected settings object");
  }
  if (typeof settings !== "object") {
    throw new Error("Expected settings object, received " + typeof settings);
  }
  const errors: Array<string> = [];
  const keysToCheck = Object.keys(settings);
  const checkedKeys: Array<string> = [];
  async function check<T = void>(
    key: string,
    callback: (key: unknown) => T | Promise<T>
  ): Promise<T | undefined> {
    checkedKeys.push(key);
    const value = settings[key];
    try {
      return await callback(value);
    } catch (e) {
      errors.push(`Setting '${key}': ${e.message}`);
      return void 0;
    }
  }
  const connectionString = await check(
    "connectionString",
    (rawConnectionString = process.env.DATABASE_URL): string => {
      // tslint:disable no-string-literal
      if (typeof rawConnectionString !== "string") {
        throw new Error(
          "Expected a string, or for DATABASE_URL envvar to be set"
        );
      }
      return rawConnectionString;
    }
  );

  const rootConnectionString = await check(
    "rootConnectionString",
    (
      rawRootConnectionString = process.env.ROOT_DATABASE_URL || "template1"
    ): string => {
      if (typeof rawRootConnectionString !== "string") {
        throw new Error(
          "Expected a string, or for DATABASE_URL envvar to be set"
        );
      }
      return rawRootConnectionString;
    }
  );

  await check("databaseOwner", rawDatabaseOwner => {
    if (rawDatabaseOwner && typeof rawDatabaseOwner !== "string") {
      throw new Error("Expected settings.databaseOwner to be a string");
    }
  });

  const { user, database: databaseName } = parse(connectionString || "");
  const databaseOwner = settings.databaseOwner || user || databaseName;

  const shadowConnectionString = await check(
    "shadowConnectionString",
    (rawShadowConnectionString = process.env.SHADOW_DATABASE_URL) => {
      if (requireShadow) {
        if (typeof rawShadowConnectionString !== "string") {
          throw new Error(
            "Expected a string, or for TEST_DATABASE_URL to be set"
          );
        }
        return rawShadowConnectionString;
      }
      return null;
    }
  );
  const { database: shadowDatabaseName } = parse(shadowConnectionString || "");

  await check("pgSettings", pgSettings => {
    if (pgSettings) {
      if (typeof pgSettings !== "object" || pgSettings === null) {
        throw new Error("Expected settings.pgSettings to be an object");
      }
      const badKeys = Object.keys(pgSettings).filter(key => {
        const value = pgSettings[key];
        return typeof value !== "string" && typeof value !== "number";
      });
      if (badKeys.length) {
        throw new Error(
          `Invalid pgSettings for keys '${badKeys.join(
            ", "
          )}' - expected string` /* Number is acceptable, but prefer string. Boolean not acceptable. */
        );
      }
    }
  });

  const placeholders = await check(
    "placeholders",
    (rawPlaceholders): { [key: string]: string } | undefined => {
      if (rawPlaceholders) {
        if (typeof rawPlaceholders !== "object" || rawPlaceholders === null) {
          throw new Error("Expected settings.placeholders to be an object");
        }
        const badKeys = Object.keys(rawPlaceholders).filter(
          key => !key.match(/^:[A-Z][0-9A-Z_]+$/)
        );
        if (badKeys.length) {
          throw new Error(
            `Invalid placeholders keys '${badKeys.join(
              ", "
            )}' - expected to follow format ':ABCD_EFG_HIJ'`
          );
        }
        const badValueKeys = Object.keys(rawPlaceholders).filter(key => {
          const value = rawPlaceholders[key];
          return typeof value !== "string";
        });
        if (badValueKeys.length) {
          throw new Error(
            `Invalid placeholders values for keys '${badValueKeys.join(
              ", "
            )}' - expected string`
          );
        }
        return Object.entries(rawPlaceholders).reduce(
          (
            memo: { [key: string]: string },
            [key, value]
          ): { [key: string]: string } => {
            if (value === "!ENV") {
              const envvarKey = key.substr(1);
              const envvar = process.env[envvarKey];
              if (!envvar) {
                throw new Error(
                  `Could not find environmental variable '${envvarKey}'`
                );
              }
              memo[key] = envvar;
            }
            return memo;
          },
          { ...rawPlaceholders }
        );
      }
      return undefined;
    }
  );

  const validateCommand = makeValidateCommandCallback(migrationsFolder);

  await check("afterReset", validateCommand);

  /******/

  const uncheckedKeys = keysToCheck.filter(key => checkedKeys.indexOf(key) < 0);
  if (uncheckedKeys.length) {
    errors.push(
      `The following config settings were not understood: '${uncheckedKeys.join(
        "', '"
      )}'`
    );
  }

  if (connectionString) {
    if (!databaseOwner) {
      errors.push(
        "Could not determine the database owner, please add the 'databaseOwner' setting."
      );
    }

    if (!databaseName) {
      errors.push(
        "Could not determine the database name, please ensure connectionString includes the database name."
      );
    }
  }

  if (requireShadow && !shadowDatabaseName) {
    errors.push(
      "Could not determine the shadow database name, please ensure shadowConnectionString includes the database name."
    );
  }

  if (errors.length) {
    throw new Error(
      `Errors occurred during settings validation:\n- ${errors.join("\n- ")}`
    );
  }
  // tslint:enable no-string-literal
  return {
    ...settings,
    rootConnectionString: rootConnectionString!,
    connectionString: connectionString!,
    databaseOwner: databaseOwner!,
    migrationsFolder,
    databaseName: databaseName!,
    shadowConnectionString: shadowConnectionString
      ? shadowConnectionString
      : void 0,
    shadowDatabaseName: shadowDatabaseName ? shadowDatabaseName : void 0,
    placeholders,
  };
}
