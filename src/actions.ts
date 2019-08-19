import { withClient } from "./pg";
import {
  ParsedSettings,
  isCommandActionSpec,
  isSqlActionSpec,
  isActionSpec,
} from "./settings";
import { generatePlaceholderReplacement } from "./migration";
import * as fsp from "./fsp";
import { exec as rawExec } from "child_process";
import { promisify } from "util";

interface ActionSpecBase {
  _: string;
  shadow?: boolean;
}

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
  actions: ActionSpec[]
) {
  if (!actions) {
    return;
  }
  const connectionString = shadow
    ? parsedSettings.shadowConnectionString
    : parsedSettings.connectionString;
  if (!connectionString) {
    throw new Error(
      "Could not determine connection string for running commands"
    );
  }
  for (const actionSpec of actions) {
    if (actionSpec.shadow !== undefined && actionSpec.shadow !== shadow) {
      continue;
    }
    if (actionSpec._ === "sql") {
      await withClient(
        connectionString,
        parsedSettings,
        async (pgClient, context) => {
          const body = await fsp.readFile(
            `${parsedSettings.migrationsFolder}/${actionSpec}`,
            "utf8"
          );
          const query = generatePlaceholderReplacement(parsedSettings, context)(
            body
          );
          // tslint:disable-next-line no-console
          console.log(query);
          await pgClient.query({
            text: query,
          });
        }
      );
    } else if (actionSpec._ === "command") {
      // Run the command
      const { stdout, stderr } = await exec(actionSpec.command, {
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: connectionString, // DO NOT USE THIS! It can be misleadling.
          GM_DBURL: connectionString,
          ...(shadow
            ? {
                GM_SHADOW: "1",
              }
            : null),
        },
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      if (stdout) {
        // tslint:disable-next-line no-console
        console.log(stdout);
      }
      if (stderr) {
        // tslint:disable-next-line no-console
        console.error(stderr);
      }
    }
  }
}

export function makeValidateActionCallback() {
  return async (inputValue: unknown): Promise<ActionSpec[]> => {
    const specs: ActionSpec[] = [];
    if (inputValue) {
      const rawSpecArray = Array.isArray(inputValue)
        ? inputValue
        : [inputValue];
      for (const rawSpec of rawSpecArray) {
        if (rawSpec && typeof rawSpec === "string") {
          const sqlSpec: SqlActionSpec = {
            _: "sql",
            file: rawSpec,
          };
          specs.push(sqlSpec);
        } else if (isActionSpec(rawSpec)) {
          if (isSqlActionSpec(rawSpec) || isCommandActionSpec(rawSpec)) {
            specs.push(rawSpec);
          } else {
            throw new Error(
              `Action spec of type '${
                rawSpec["_"]
              }' not supported; perhaps you need to upgrade?`
            );
          }
        } else {
          throw new Error(
            `Expected action spec to contain an array of strings or action specs; received '${typeof rawSpec}'`
          );
        }
      }
    }
    return specs;
  };
}
