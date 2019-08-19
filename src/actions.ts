import { withClient } from "./pg";
import {
  ParsedSettings,
  Actions,
  isCommandActionSpec,
  ActionSpec,
  SqlActionSpec,
  isSqlActionSpec,
} from "./settings";
import { generatePlaceholderReplacement } from "./migration";
import * as fsp from "./fsp";
import { exec as rawExec } from "child_process";
import { promisify } from "util";

const exec = promisify(rawExec);

function stringActionToSql(action: string | ActionSpec): ActionSpec {
  if (typeof action === "string") {
    const spec: SqlActionSpec = { _: "sql", file: action };
    return spec;
  }
  return action;
}

export async function executeActions(
  parsedSettings: ParsedSettings,
  shadow = false,
  rawActions: Actions | undefined
) {
  if (!rawActions) {
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
  const allActions: ActionSpec[] = (Array.isArray(rawActions)
    ? rawActions
    : [rawActions]
  ).map(stringActionToSql);
  for (const actionSpec of allActions) {
    if (isSqlActionSpec(actionSpec)) {
      // SQL
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
    } else if (isCommandActionSpec(actionSpec)) {
      if (actionSpec.shadow === undefined || actionSpec.shadow === shadow) {
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
}

export function makeValidateActionCallback(migrationsFolder: string) {
  return async (rawAfterReset: unknown) => {
    if (!rawAfterReset) {
      return;
    }
    const afterResetArray = Array.isArray(rawAfterReset)
      ? rawAfterReset
      : [rawAfterReset];
    for (const afterReset of afterResetArray) {
      if (afterReset && typeof afterReset === "string") {
        await fsp.stat(`${migrationsFolder}/${afterReset}`);
      } else if (
        afterReset &&
        typeof afterReset === "object" &&
        typeof afterReset["command"] === "string"
      ) {
        // OK.
      } else {
        throw new Error(
          `Expected afterReset to contain an array of strings or command specs; received '${typeof afterReset}'`
        );
      }
    }
  };
}
