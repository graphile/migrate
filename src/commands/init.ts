import { promises as fsp } from "fs";
import { CommandModule } from "yargs";

// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import { version } from "../../package.json";
import { GMRC_PATH } from "./_common";

export async function init(): Promise<void> {
  try {
    await fsp.stat(GMRC_PATH);
    throw new Error(".gmrc file already exists");
  } catch (e) {
    if (e.code === "ENOENT") {
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
  // "connectionString": "postgres://appuser:apppassword@host:5432/appdb",

  /* 
   * shadowConnectionString: like connectionString, but this is used for the
   * shadow database (which will be reset frequently).
   * 
   * RECOMMENDATION: use \`SHADOW_DATABASE_URL\` envvar instead.
   */
  // "shadowConnectionString": "postgres://appuser:apppassword@host:5432/appdb_shadow",

  /* 
   * rootConnectionString: like connectionString, but this is used for
   * dropping/creating the database in \`graphile-migrate reset\`. This isn't
   * necessary, shouldn't be used in production, but helps during development.
   * 
   * RECOMMENDATION: use \`ROOT_DATABASE_URL\` envvar instead.
   */
  // "rootConnectionString": "postgres://adminuser:adminpassword@host:5432/postgres",
`;

      await fsp.writeFile(
        GMRC_PATH,
        `\
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

{${dbStrings}
  /* 
   * Add key-value settings here to be automatically loaded into PostgreSQL
   * before running migrations, using an equivalent of \`SET LOCAL <key> TO
   * <value>\`
   */
  "pgSettings": {
    // "search_path": "app_public,app_private,app_hidden,public",
  },

  /* 
   * Placeholders should be prefixed with a colon and in all caps, like
   * \`:COLON_PREFIXED_ALL_CAPS\`. They will be replaced with the (string)
   * value here when your migration scripts are executed; this is useful for
   * committing migrations where certain parameters can change between
   * environments (development, staging, production) but you wish to use the
   * same signed migration files for all.
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
  "afterReset": [
    /* 
     * Executed after a \`graphile-migrate reset\` command.
     */

    // "afterReset.sql",
    // { "_": "command", "command": "graphile-worker --schema-only" },
  ],
  
  "afterAllMigrations": [
    /* 
     * Executed once all migrations are complete.
     */

    // {
    //   "_": "command",
    //   "shadow": true,
    //   "command": "if [ \\"$IN_TESTS\\" != \\"1\\" ]; then ./scripts/dump-db; fi",
    // },
  ],

  "afterCurrent": [
    /* 
     * Executed once the current migration has been evaluated (i.e. in watch mode).
     */

    // {
    //   "_": "command",
    //   "shadow": true,
    //   "command": "if [ \\"$IN_TESTS\\" = \\"1\\" ]; then ./scripts/test-seed; fi",
    // },
  ],

  /****************************************************************************\\
  ***                                                                        ***
  ***         You probably don't want to edit anything below here.           ***
  ***                                                                        ***
  \\****************************************************************************/

  /* 
   * If you set this false, you must be sure to keep the graphile_migrate schema
   * up to date yourself. We recommend you leave it at its default.
   */
  // "manageGraphileMigrateSchema": true,

  /* 
   * Content to be written to the current migration after commit. NOTE: this
   * should only contain comments.
   */
  // "blankMigrationContent": "-- Write your migration here\\n",

  /* 
   * Path to the folder in which to store your migrations.
   */
  // migrationsFolder: "./migrations",

  "generatedWith": "${version}"
}
`,
      );
      // eslint-disable-next-line
      console.log(
        "Template .gmrc file written; please read and edit it to suit your needs.",
      );
    } else {
      throw e;
    }
  }
}

export const initCommand: CommandModule<{}, {}> = {
  command: "init",
  aliases: [],
  describe: `\
Initializes a graphile-migrate project by creating a \`.gmrc\` file.`,
  builder: {},
  handler: init,
};
