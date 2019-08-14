import { withClient } from "./pg";
import { ParsedSettings, Commands, isCommandSpec } from "./settings";
import { generatePlaceholderReplacement } from "./migration";
import * as fsp from "./fsp";
import { exec as rawExec } from "child_process";
import { promisify } from "util";

const exec = promisify(rawExec);

export async function runCommands(
  parsedSettings: ParsedSettings,
  shadow = false,
  rawCommands: Commands | undefined
) {
  if (!rawCommands) {
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
  const allCommands = Array.isArray(rawCommands) ? rawCommands : [rawCommands];
  for (const commandSpec of allCommands) {
    if (typeof commandSpec === "string") {
      // SQL
      await withClient(
        connectionString,
        parsedSettings,
        async (pgClient, context) => {
          const body = await fsp.readFile(
            `${parsedSettings.migrationsFolder}/${commandSpec}`,
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
    } else if (isCommandSpec(commandSpec)) {
      // Run the command
      const { stdout, stderr } = await exec(commandSpec.command, {
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: connectionString,
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
