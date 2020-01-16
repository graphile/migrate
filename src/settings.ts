import { parse } from "pg-connection-string";
import {
  makeValidateActionCallback,
  ActionSpec,
  SqlActionSpec,
  CommandActionSpec,
} from "./actions";

export type Actions = string | Array<string | ActionSpec>;

export function isActionSpec(o: unknown): o is ActionSpec {
  if (!(typeof o === "object" && o && typeof o["_"] === "string")) {
    return false;
  }

  // After here it's definitely an action spec; but we should still validate the
  // other properties.

  if ("shadow" in o && typeof o["shadow"] !== "boolean") {
    throw new Error(
      `'${o["_"]}' action has 'shadow' property of type '${typeof o[
        "shadow"
      ]}'; expected 'boolean' (or not set)`
    );
  }

  return true;
}

export function isSqlActionSpec(o: unknown): o is SqlActionSpec {
  if (!isActionSpec(o) || o._ !== "sql") {
    return false;
  }
  if (typeof o["file"] !== "string") {
    throw new Error("SQL command requires 'file' property to be set");
  }
  return true;
}

export function isCommandActionSpec(o: unknown): o is CommandActionSpec {
  if (!isActionSpec(o) || o._ !== "command") {
    return false;
  }

  // Validations
  if (typeof o["command"] !== "string") {
    throw new Error(
      `Command action has 'command' property of type '${typeof o[
        "command"
      ]}'; expected 'string'`
    );
  }

  return true;
}

export interface Settings {
  connectionString?: string;
  shadowConnectionString?: string;
  rootConnectionString?: string;
  databaseOwner?: string;
  skipOwnSchema?: boolean;
  pgSettings?: {
    [key: string]: string;
  };
  placeholders?: {
    [key: string]: string;
  };
  afterReset?: Actions;
  afterAllMigrations?: Actions;
  afterCurrent?: Actions;
}

export interface ParsedSettings extends Settings {
  connectionString: string;
  rootConnectionString: string;
  databaseOwner: string;
  migrationsFolder: string;
  databaseName: string;
  shadowDatabaseName?: string;
  afterReset: ActionSpec[];
  afterAllMigrations: ActionSpec[];
  afterCurrent: ActionSpec[];
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
          "Expected a string, or for ROOT_DATABASE_URL envvar to be set"
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
            "Expected `shadowConnectionString` to be a string, or for SHADOW_DATABASE_URL to be set"
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

  const placeholders = await check("placeholders", (rawPlaceholders):
    | { [key: string]: string }
    | undefined => {
    if (rawPlaceholders) {
      if (typeof rawPlaceholders !== "object" || rawPlaceholders === null) {
        throw new Error("Expected settings.placeholders to be an object");
      }
      const badKeys = Object.keys(rawPlaceholders).filter(
        key => !/^:[A-Z][0-9A-Z_]+$/.exec(key)
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
  });

  const validateAction = makeValidateActionCallback();

  const afterReset = await check("afterReset", validateAction);
  const afterAllMigrations = await check("afterAllMigrations", validateAction);
  const afterCurrent = await check("afterCurrent", validateAction);

  const skipOwnSchema = await check("skipOwnSchema", skip => {
    return !!skip;
  });

  /******/

  const uncheckedKeys = keysToCheck.filter(key => !checkedKeys.includes(key));
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
  /* eslint-disable @typescript-eslint/no-non-null-assertion */
  return {
    ...settings,
    afterReset: afterReset!,
    afterAllMigrations: afterAllMigrations!,
    afterCurrent: afterCurrent!,
    rootConnectionString: rootConnectionString!,
    connectionString: connectionString!,
    skipOwnSchema: skipOwnSchema!,
    databaseOwner: databaseOwner!,
    migrationsFolder,
    databaseName: databaseName!,
    shadowConnectionString: shadowConnectionString
      ? shadowConnectionString
      : void 0,
    shadowDatabaseName: shadowDatabaseName ? shadowDatabaseName : void 0,
    placeholders,
  };
  /* eslint-enable */
}

export function getCurrentMigrationPath(
  parsedSettings: ParsedSettings
): string {
  return `${parsedSettings.migrationsFolder}/current.sql`;
}

export const BLANK_MIGRATION_CONTENT = "-- Enter migration here\n";
