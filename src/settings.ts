import { parse } from "pg-connection-string";

import {
  ActionSpec,
  CommandActionSpec,
  makeValidateActionCallback,
  SqlActionSpec,
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
      ]}'; expected 'boolean' (or not set)`,
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
      ]}'; expected 'string'`,
    );
  }

  return true;
}

/**
 * This type is not trusted; to use the values within it, it must be
 * parsed/validated into ParsedSettings.
 */
export interface Settings {
  connectionString?: string;
  shadowConnectionString?: string;
  rootConnectionString?: string;
  databaseOwner?: string;
  migrationsFolder?: string;
  manageGraphileMigrateSchema?: boolean;
  pgSettings?: {
    [key: string]: string;
  };
  placeholders?: {
    [key: string]: string;
  };
  afterReset?: Actions;
  afterAllMigrations?: Actions;
  afterCurrent?: Actions;
  blankMigrationContent?: string;
}

// NOTE: only override values that differ (e.g. changing non-nullability)
export interface ParsedSettings extends Settings {
  connectionString: string;
  rootConnectionString: string;
  databaseOwner: string;
  databaseName: string;
  shadowDatabaseName?: string;
  migrationsFolder: string;
  afterReset: ActionSpec[];
  afterAllMigrations: ActionSpec[];
  afterCurrent: ActionSpec[];
  blankMigrationContent: string;
}

export async function parseSettings(
  settings: Settings,
  requireShadow = false,
): Promise<ParsedSettings> {
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
    callback: (key: unknown) => T | Promise<T>,
  ): Promise<T> {
    checkedKeys.push(key);
    const value = settings[key];
    try {
      return await callback(value);
    } catch (e) {
      errors.push(`Setting '${key}': ${e.message}`);
      return void 0 as never;
    }
  }

  const connectionString = await check(
    "connectionString",
    (rawConnectionString = process.env.DATABASE_URL): string => {
      if (typeof rawConnectionString !== "string") {
        throw new Error(
          "Expected a string, or for DATABASE_URL envvar to be set",
        );
      }
      return rawConnectionString;
    },
  );

  const rootConnectionString = await check(
    "rootConnectionString",
    (
      rawRootConnectionString = process.env.ROOT_DATABASE_URL || "template1",
    ): string => {
      if (typeof rawRootConnectionString !== "string") {
        throw new Error(
          "Expected a string, or for ROOT_DATABASE_URL envvar to be set",
        );
      }
      return rawRootConnectionString;
    },
  );

  const migrationsFolder = await check(
    "migrationsFolder",
    (rawMigrationsFolder = `${process.cwd()}/migrations`): string => {
      if (typeof rawMigrationsFolder !== "string") {
        throw new Error("Expected a string");
      }
      return rawMigrationsFolder;
    },
  );

  const blankMigrationContent = await check(
    "blankMigrationContent",
    (rawBlankMigrationContent = "-- Enter migration here\n"): string => {
      if (typeof rawBlankMigrationContent !== "string") {
        throw new Error("Expected a string");
      }
      return rawBlankMigrationContent;
    },
  );

  const { user, database: databaseName } = parse(connectionString || "");
  const databaseOwner = await check(
    "databaseOwner",
    (rawDatabaseOwner = user || databaseName) => {
      if (typeof rawDatabaseOwner !== "string") {
        throw new Error(
          "Expected a string or for user or database name to be specified in connectionString",
        );
      }
      return rawDatabaseOwner;
    },
  );

  const shadowConnectionString = await check(
    "shadowConnectionString",
    (rawShadowConnectionString = process.env.SHADOW_DATABASE_URL) => {
      if (requireShadow) {
        if (typeof rawShadowConnectionString !== "string") {
          throw new Error(
            "Expected `shadowConnectionString` to be a string, or for SHADOW_DATABASE_URL to be set",
          );
        }
        return rawShadowConnectionString;
      }
      return null;
    },
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
            ", ",
          )}' - expected string` /* Number is acceptable, but prefer string. Boolean not acceptable. */,
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
        key => !/^:[A-Z][0-9A-Z_]+$/.exec(key),
      );
      if (badKeys.length) {
        throw new Error(
          `Invalid placeholders keys '${badKeys.join(
            ", ",
          )}' - expected to follow format ':ABCD_EFG_HIJ'`,
        );
      }
      const badValueKeys = Object.keys(rawPlaceholders).filter(key => {
        const value = rawPlaceholders[key];
        return typeof value !== "string";
      });
      if (badValueKeys.length) {
        throw new Error(
          `Invalid placeholders values for keys '${badValueKeys.join(
            ", ",
          )}' - expected string`,
        );
      }
      return Object.entries(rawPlaceholders).reduce(
        (
          memo: { [key: string]: string },
          [key, value],
        ): { [key: string]: string } => {
          if (value === "!ENV") {
            const envvarKey = key.substr(1);
            const envvar = process.env[envvarKey];
            if (!envvar) {
              throw new Error(
                `Could not find environmental variable '${envvarKey}'`,
              );
            }
            memo[key] = envvar;
          }
          return memo;
        },
        { ...rawPlaceholders },
      );
    }
    return undefined;
  });

  const validateAction = makeValidateActionCallback();
  const rootValidateAction = makeValidateActionCallback(true);

  const afterReset = await check("afterReset", rootValidateAction);
  const afterAllMigrations = await check("afterAllMigrations", validateAction);
  const afterCurrent = await check("afterCurrent", validateAction);

  const manageGraphileMigrateSchema = await check(
    "manageGraphileMigrateSchema",
    mgms => {
      const type = typeof mgms;
      if (type !== "undefined" && type !== "boolean") {
        throw new Error(
          `Expected boolean, received '${
            type === "object" && !mgms ? "null" : type
          }'`,
        );
      }
      return mgms !== false;
    },
  );

  /******/

  const uncheckedKeys = keysToCheck.filter(key => !checkedKeys.includes(key));
  if (uncheckedKeys.length) {
    errors.push(
      `The following config settings were not understood: '${uncheckedKeys.join(
        "', '",
      )}'`,
    );
  }

  if (connectionString) {
    if (!databaseOwner) {
      errors.push(
        "Could not determine the database owner, please add the 'databaseOwner' setting.",
      );
    }

    if (!databaseName) {
      errors.push(
        "Could not determine the database name, please ensure connectionString includes the database name.",
      );
    }
  }

  if (requireShadow && !shadowDatabaseName) {
    errors.push(
      "Could not determine the shadow database name, please ensure shadowConnectionString includes the database name.",
    );
  }

  if (errors.length) {
    throw new Error(
      `Errors occurred during settings validation:\n- ${errors.join("\n- ")}`,
    );
  }
  if (!databaseName) {
    // This is just to appease TypeScript, this should be caught above.
    throw new Error("Could not determine databaseName");
  }

  return {
    ...settings,
    afterReset,
    afterAllMigrations,
    afterCurrent,
    rootConnectionString,
    connectionString,
    manageGraphileMigrateSchema,
    databaseOwner,
    migrationsFolder,
    databaseName,
    shadowConnectionString: shadowConnectionString
      ? shadowConnectionString
      : void 0,
    shadowDatabaseName: shadowDatabaseName ? shadowDatabaseName : void 0,
    placeholders,
    blankMigrationContent,
  };
}

/**
 * Overrides the databaseName in rootConnectionString and returns the resulting
 * connection string.
 */
export function makeRootDatabaseConnectionString(
  parsedSettings: ParsedSettings,
  databaseName: string,
): string {
  const { rootConnectionString } = parsedSettings;
  if (!rootConnectionString) {
    throw new Error(
      "Cannot execute SQL as root since rootConnectionString / ROOT_DATABASE_URL is not specified",
    );
  }
  const parsed = parse(rootConnectionString);
  // TODO: factor in other connection parameters
  let str = "postgres://";
  if (parsed.user) {
    str += encodeURIComponent(parsed.user);
  }
  if (parsed.password) {
    str += ":" + encodeURIComponent(parsed.password);
  }
  if (parsed.user || parsed.password) {
    str += "@";
  }
  if (parsed.host) {
    str += parsed.host;
  }
  if (parsed.port) {
    str += ":" + parsed.port;
  }
  str += "/";
  str += databaseName;
  let sep = "?";
  const q = (key: string, val: string | null | undefined | boolean): string => {
    if (val != null) {
      const str =
        sep +
        encodeURIComponent(key) +
        "=" +
        encodeURIComponent(val === true ? "1" : val === false ? "0" : val);
      if (sep === "?") {
        sep = "&";
      }
      return str;
    }
    return "";
  };
  str += q("ssl", parsed.ssl);
  str += q("client_encoding", parsed.client_encoding);
  str += q("application_name", parsed.application_name);
  str += q("fallback_application_name", parsed.fallback_application_name);
  return str;
}
