import { promises as fsp } from "fs";
import { CommandModule } from "yargs";

import { DO_NOT_USE_DATABASE_URL } from "../actions";
import { runQueryWithErrorInstrumentation } from "../instrumentation";
import { compilePlaceholders } from "../migration";
import { withClient } from "../pgReal";
import {
  makeRootDatabaseConnectionString,
  parseSettings,
  Settings,
} from "../settings";
import {
  CommonOptions,
  getDatabaseName,
  getSettings,
  readStdin,
} from "./_common";

interface RunOptions extends CommonOptions {
  shadow?: boolean;
  root?: boolean;
  rootDatabase?: boolean;
}

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

export const runCommand: CommandModule<{}, RunOptions> = {
  command: "run [file]",
  aliases: [],
  describe: `\
Compiles a SQL file, inserting all the placeholders, and then runs it against the database. Useful for seeding. If called from an action will automatically run against the same database (via GM_DBURL envvar) unless --shadow or --rootDatabase are supplied.`,
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
    const defaultSettings = await getSettings({ configFile: argv.config });

    // `run` might be called from an action; in this case `DATABASE_URL` will
    // be unavailable (overwritten with DO_NOT_USE_DATABASE_URL) to avoid
    // ambiguity (so we don't accidentally run commands against the main
    // database when it was the shadow database that triggered the action); in
    // this case, unless stated otherwise, the user would want to `run` against
    // whatever database was just modified, so we automatically use `GM_DBURL`
    // in this case.
    const settings =
      argv.shadow ||
      argv.rootDatabase ||
      process.env.DATABASE_URL !== DO_NOT_USE_DATABASE_URL
        ? defaultSettings
        : {
            ...defaultSettings,
            connectionString: process.env.GM_DBURL,
          };

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
