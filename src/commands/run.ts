import { promises as fsp } from "fs";
import { CommandModule } from "yargs";

import { runQueryWithErrorInstrumentation } from "../instrumentation";
import { compilePlaceholders } from "../migration";
import { withClient } from "../pgReal";
import {
  makeRootDatabaseConnectionString,
  parseSettings,
  Settings,
} from "../settings";
import { getDatabaseName, getSettings, readStdin } from "./_common";

export async function run(
  settings: Settings,
  content: string,
  filename: string,
  {
    shadow = false,
    root = false,
    rootDatabase = false,
  }: {
    shadow?: boolean;
    root?: boolean;
    rootDatabase?: boolean;
  } = {},
): Promise<any[] | undefined> {
  const parsedSettings = await parseSettings(settings, shadow);
  const sql = compilePlaceholders(parsedSettings, content, shadow);
  const baseConnectionString = rootDatabase
    ? parsedSettings.rootConnectionString
    : shadow
    ? parsedSettings.shadowConnectionString
    : parsedSettings.connectionString;
  if (!baseConnectionString) {
    throw new Error("Could not determine connection string to use.");
  }

  const connectionString =
    root && !rootDatabase
      ? makeRootDatabaseConnectionString(
          parsedSettings,
          getDatabaseName(baseConnectionString),
        )
      : baseConnectionString;

  return withClient(connectionString, parsedSettings, pgClient =>
    runQueryWithErrorInstrumentation(pgClient, sql, filename),
  );
}

export const runCommand: CommandModule<
  {},
  {
    shadow?: boolean;
    root?: boolean;
    rootDatabase?: boolean;
  }
> = {
  command: "run [file]",
  aliases: [],
  describe: `\
Compiles a SQL file, inserting all the placeholders, and then runs it against the database. Useful for seeding.`,
  builder: {
    shadow: {
      type: "boolean",
      default: false,
      description: "Apply to the shadow database (for development).",
    },
    root: {
      type: "boolean",
      default: false,
      description:
        "Run the file using the root user (but application database).",
    },
    rootDatabase: {
      type: "boolean",
      default: false,
      description:
        "Like --root, but also runs against the root database rather than application database.",
    },
  },
  handler: async argv => {
    const settings = await getSettings();
    const { content, filename } =
      typeof argv.file === "string"
        ? {
            filename: argv.file,
            content: await fsp.readFile(argv.file, "utf8"),
          }
        : { filename: "stdin", content: await readStdin() };

    const rows = await run(settings, content, filename, argv);

    if (rows) {
      // eslint-disable-next-line no-console
      console.table(rows);
    }
  },
};
