import { Logger } from "@graphile/logger";
import { exec as rawExec } from "child_process";
import { promises as fsp } from "fs";
import { parse } from "pg-connection-string";
import { promisify } from "util";

import { mergeWithoutClobbering } from "./lib";
import { generatePlaceholderReplacement } from "./migration";
import { withClient } from "./pg";
import {
  isActionSpec,
  isCommandActionSpec,
  isSqlActionSpec,
  makeRootDatabaseConnectionString,
  ParsedSettings,
} from "./settings";

interface ActionSpecBase {
  _: string;
  shadow?: boolean;

  /**
   * USE THIS WITH CARE! Currently only supported by the afterReset hook, all
   * other hooks will throw an error when set. Runs the file using the
   * rootConnectionString role (i.e. a superuser, but with database name from
   * connectionString), useful for creating extensions.
   */
  root?: boolean;
}

export const DO_NOT_USE_DATABASE_URL = "postgres://PLEASE:USE@GM_DBURL/INSTEAD";

export interface SqlActionSpec extends ActionSpecBase {
  _: "sql";
  file: string;
}

export interface CommandActionSpec extends ActionSpecBase {
  _: "command";
  command: string;
}

export type ActionSpec = SqlActionSpec | CommandActionSpec;

const exec = promisify(rawExec);

export async function executeActions(
  parsedSettings: ParsedSettings,
  shadow = false,
  actions: ActionSpec[],
): Promise<void> {
  if (!actions) {
    return;
  }
  const connectionString = shadow
    ? parsedSettings.shadowConnectionString
    : parsedSettings.connectionString;
  if (!connectionString) {
    throw new Error(
      "Could not determine connection string for running commands",
    );
  }
  const { database: databaseName, user: databaseUser } = parse(
    connectionString,
  );
  if (!databaseName) {
    throw new Error("Could not extract database name from connection string");
  }
  for (const actionSpec of actions) {
    if (actionSpec.shadow !== undefined && actionSpec.shadow !== shadow) {
      continue;
    }
    const hookConnectionString = actionSpec.root
      ? makeRootDatabaseConnectionString(parsedSettings, databaseName)
      : connectionString;
    if (actionSpec._ === "sql") {
      const body = await fsp.readFile(
        `${parsedSettings.migrationsFolder}/${actionSpec.file}`,
        "utf8",
      );
      await withClient(
        hookConnectionString,
        parsedSettings,
        async (pgClient, context) => {
          const query = generatePlaceholderReplacement(
            parsedSettings,
            context,
          )(body);
          await pgClient.query({
            text: query,
          });
        },
      );
    } else if (actionSpec._ === "command") {
      // Run the command
      const { stdout, stderr } = await exec(actionSpec.command, {
        env: mergeWithoutClobbering(
          {
            ...process.env,
            DATABASE_URL: DO_NOT_USE_DATABASE_URL, // DO NOT USE THIS! It can be misleading.
          },
          {
            GM_DBNAME: databaseName,
            GM_DBUSER: actionSpec.root ? undefined : databaseUser,
            GM_DBURL: hookConnectionString,
            ...(shadow
              ? {
                  GM_SHADOW: "1",
                }
              : null),
          },
          "please ensure this environmental variable is not set because graphile-migrate sets it dynamically for children.",
        ),
        encoding: "utf8",
        // 50MB of log data should be enough for any reasonable migration... right?
        maxBuffer: 50 * 1024 * 1024,
      });
      if (stdout) {
        parsedSettings.logger.info(stdout);
      }
      if (stderr) {
        parsedSettings.logger.error(stderr);
      }
    }
  }
}

export function makeValidateActionCallback(logger: Logger, allowRoot = false) {
  return async (inputValue: unknown): Promise<ActionSpec[]> => {
    const specs: ActionSpec[] = [];
    if (inputValue) {
      const rawSpecArray = Array.isArray(inputValue)
        ? inputValue
        : [inputValue];
      for (const trueRawSpec of rawSpecArray) {
        // This fudge is for backwards compatibility with v0.0.3
        const isV003OrBelowCommand =
          typeof trueRawSpec === "object" &&
          trueRawSpec &&
          !trueRawSpec["_"] &&
          typeof trueRawSpec["command"] === "string";
        if (isV003OrBelowCommand) {
          logger.warn(
            "DEPRECATED: graphile-migrate now requires command action specs to have an `_: 'command'` property; we'll back-fill this for now, but please update your configuration",
          );
        }
        const rawSpec = isV003OrBelowCommand
          ? { _: "command", ...trueRawSpec }
          : trueRawSpec;

        if (rawSpec && typeof rawSpec === "string") {
          const sqlSpec: SqlActionSpec = rawSpec.startsWith("!")
            ? {
                _: "sql",
                file: rawSpec.substr(1),
                root: true,
              }
            : {
                _: "sql",
                file: rawSpec,
              };
          specs.push(sqlSpec);
        } else if (isActionSpec(rawSpec)) {
          if (isSqlActionSpec(rawSpec) || isCommandActionSpec(rawSpec)) {
            specs.push(rawSpec);
          } else {
            throw new Error(
              `Action spec of type '${rawSpec["_"]}' not supported; perhaps you need to upgrade?`,
            );
          }
        } else {
          throw new Error(
            `Expected action spec to contain an array of strings or action specs; received '${typeof rawSpec}'`,
          );
        }
      }
    }

    // Final validations
    for (const spec of specs) {
      if (!allowRoot && spec._ === "sql" && spec.root) {
        throw new Error(
          "This hooks isn't permitted to require root privileges.",
        );
      }
    }

    return specs;
  };
}
