import * as fsp from "fs/promises";
import { CommandModule } from "yargs";

import { getCurrentMigrationLocation, writeCurrentMigration } from "../current";
import { parseSettings } from "../settings";
import { version } from "../version";
import {
  CommonArgv,
  DEFAULT_GMRC_PATH,
  DEFAULT_GMRCJS_PATH,
  exists,
  getSettings,
} from "./_common";

interface InitArgv extends CommonArgv {
  folder?: boolean;
}

export async function init(options: InitArgv = {}): Promise<void> {
  if (await exists(DEFAULT_GMRC_PATH)) {
    throw new Error(`.gmrc file already exists at ${DEFAULT_GMRC_PATH}`);
  }
  if (await exists(DEFAULT_GMRCJS_PATH)) {
    throw new Error(`.gmrc.js file already exists at ${DEFAULT_GMRCJS_PATH}`);
  }
  if (options.config && (await exists(options.config))) {
    throw new Error(`.gmrc file already exists at ${options.config}`);
  }

  const gmrcPath = options.config || DEFAULT_GMRC_PATH;

  const dbStrings =
    process.env.DATABASE_URL &&
    process.env.SHADOW_DATABASE_URL &&
    process.env.ROOT_DATABASE_URL
      ? `
  /*
   * Database connections strings are sourced from the DATABASE_URL,
   * SHADOW_DATABASE_URL and ROOT_DATABASE_URL environmental variables.
   */
`
      : `
  /*
   * connectionString: this tells Graphile Migrate where to find the database
   * to run the migrations against.
   *
   * RECOMMENDATION: use \`DATABASE_URL\` envvar instead.
   */
  // "connectionString": "postgres://dbowner:password@host:5432/appdb",

  /*
   * shadowConnectionString: like connectionString, but this is used for the
   * shadow database (which will be reset frequently).
   *
   * RECOMMENDATION: use \`SHADOW_DATABASE_URL\` envvar instead.
   */
  // "shadowConnectionString": "postgres://dbowner:password@host:5432/appdb_shadow",

  /*
   * rootConnectionString: like connectionString, but this is used for
   * dropping/creating the database in \`graphile-migrate reset\`. This isn't
   * necessary, shouldn't be used in production, but helps during development.
   *
   * RECOMMENDATION: use \`ROOT_DATABASE_URL\` envvar instead.
   */
  // "rootConnectionString": "postgres://adminuser:adminpassword@host:5432/postgres",
`;

  const initialComment = `\
/*
 * Graphile Migrate configuration.
 *
 * If you decide to commit this file (recommended) please ensure that it does
 * not contain any secrets (passwords, etc) - we recommend you manage these
 * with environmental variables instead.
 *
 * This file is in JSON5 format, in VSCode you can use "JSON with comments" as
 * the file format.
 */
`;

  const jsonContent = `\
{${dbStrings}
  /*
   * pgSettings: key-value settings to be automatically loaded into PostgreSQL
   * before running migrations, using an equivalent of \`SET LOCAL <key> TO
   * <value>\`
   */
  "pgSettings": {
    // "search_path": "app_public,app_private,app_hidden,public",
  },

  /*
   * placeholders: substituted in SQL files when compiled/executed. Placeholder
   * keys should be prefixed with a colon and in all caps, like
   * \`:COLON_PREFIXED_ALL_CAPS\`. Placeholder values should be strings. They
   * will be replaced verbatim with NO ESCAPING AT ALL (this differs from how
   * psql handles placeholders) so should only be used with "safe" values. This
   * is useful for committing migrations where certain parameters can change
   * between environments (development, staging, production) but you wish to
   * use the same signed migration files for all.
   *
   * The special value "!ENV" can be used to indicate an environmental variable
   * of the same name should be used.
   *
   * Graphile Migrate automatically sets the \`:DATABASE_NAME\` and
   * \`:DATABASE_OWNER\` placeholders, and you should not attempt to override
   * these.
   */
  "placeholders": {
    // ":DATABASE_VISITOR": "!ENV", // Uses process.env.DATABASE_VISITOR
  },

  /*
   * Actions allow you to run scripts or commands at certain points in the
   * migration lifecycle. SQL files are ran against the database directly.
   * "command" actions are ran with the following environmental variables set:
   *
   * - GM_DBURL: the PostgreSQL URL of the database being migrated
   * - GM_DBNAME: the name of the database from GM_DBURL
   * - GM_DBUSER: the user from GM_DBURL
   * - GM_SHADOW: set to 1 if the shadow database is being migrated, left unset
   *   otherwise
   *
   * If "shadow" is unspecified, the actions will run on events to both shadow
   * and normal databases. If "shadow" is true the action will only run on
   * actions to the shadow DB, and if false only on actions to the main DB.
   */

  /*
   * afterReset: actions executed after a \`graphile-migrate reset\` command.
   */
  "afterReset": [
    // "afterReset.sql",
    // { "_": "command", "command": "graphile-worker --schema-only" },
  ],
 
  /*
   * afterAllMigrations: actions executed once all migrations are complete.
   */
  "afterAllMigrations": [
    // {
    //   "_": "command",
    //   "shadow": true,
    //   "command": "if [ \\"$IN_TESTS\\" != \\"1\\" ]; then ./scripts/dump-db; fi",
    // },
  ],

  /*
   * afterCurrent: actions executed once the current migration has been
   * evaluated (i.e. in watch mode).
   */
  "afterCurrent": [
    // {
    //   "_": "command",
    //   "shadow": true,
    //   "command": "if [ \\"$IN_TESTS\\" = \\"1\\" ]; then ./scripts/test-seed; fi",
    // },
  ],

  /*
   * blankMigrationContent: content to be written to the current migration
   * after commit. NOTE: this should only contain comments.
   */
  // "blankMigrationContent": "-- Write your migration here\\n",

  /****************************************************************************\\
  ***                                                                        ***
  ***         You probably don't want to edit anything below here.           ***
  ***                                                                        ***
  \\****************************************************************************/

  /*
   * manageGraphileMigrateSchema: if you set this false, you must be sure to
   * keep the graphile_migrate schema up to date yourself. We recommend you
   * leave it at its default.
   */
  // "manageGraphileMigrateSchema": true,

  /*
   * migrationsFolder: path to the folder in which to store your migrations.
   */
  // migrationsFolder: "./migrations",

  "//generatedWith": "${version}"
}`;

  const fileContent = gmrcPath.endsWith(".js")
    ? `${initialComment}module.exports = ${jsonContent};\n`
    : `${initialComment}${jsonContent}\n`;
  await fsp.writeFile(gmrcPath, fileContent);

  // eslint-disable-next-line
  console.log(
    `Template .gmrc file written to '${gmrcPath}'; please read and edit it to suit your needs.`,
  );
  const settings = await getSettings({ configFile: options.config });
  const parsedSettings = await parseSettings({
    connectionString: process.env.DATABASE_URL || "NOT_NEEDED",
    shadowConnectionString: process.env.SHADOW_DATABASE_URL || "NOT_NEEDED",
    ...settings,
  });
  await fsp.mkdir(parsedSettings.migrationsFolder);
  await fsp.mkdir(parsedSettings.migrationsFolder + "/committed");
  if (options.folder) {
    await fsp.mkdir(parsedSettings.migrationsFolder + "/current");
  }
  const currentLocation = await getCurrentMigrationLocation(parsedSettings);
  await writeCurrentMigration(
    parsedSettings,
    currentLocation,
    parsedSettings.blankMigrationContent.trim() + "\n",
  );
  // eslint-disable-next-line
  console.log(
    `The current migration was created at '${currentLocation.path}'.\n${
      process.env.DATABASE_URL
        ? "Try"
        : "After configuring your connectionString/DATABASE_URL try"
    } running \`graphile-migrate watch\` and editing the current migration.`,
  );
}

export const initCommand: CommandModule<Record<string, never>, InitArgv> = {
  command: "init",
  aliases: [],
  describe: `\
Initializes a graphile-migrate project by creating a \`.gmrc\` file and \`migrations\` folder.`,
  builder: {
    folder: {
      type: "boolean",
      description: "Use a folder rather than a file for the current migration.",
      default: false,
    },
  },
  handler: init,
};
