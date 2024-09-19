import * as fsp from "fs/promises";
import { relative } from "path";

import { VALID_FILE_REGEX } from "./current";
import { calculateHash } from "./hash";
import { isNoTransactionDefined } from "./header";
import { runQueryWithErrorInstrumentation } from "./instrumentation";
import { mergeWithoutClobbering } from "./lib";
import memoize from "./memoize";
import { Client, Context, withClient } from "./pg";
import { withAdvisoryLock } from "./pgReal";
import { ParsedSettings } from "./settings";

// From https://stackoverflow.com/a/3561711/141284
function escapeRegexp(str: string): string {
  return str.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

export interface Migration {
  /**
   * The filename without the message slug in it, used for storing to the database.
   */
  filename: string;

  /**
   * A hash of the content of the migration.
   */
  hash: string;

  /**
   * The hash of the previous migration, or null if there was no previous migration
   */
  previousHash: string | null;

  /**
   * True if we should allow the hash to be invalid; false otherwise.
   */
  allowInvalidHash: boolean;
}

export interface DbMigration extends Migration {
  date: Date;
}

export interface FileMigration extends Migration {
  /**
   * The actual filename on disk
   */
  realFilename: string;

  /**
   * The content of the migration
   */
  body: string;

  /**
   * The message the migration was committed with
   */
  message: string | null;

  /**
   * The slugified message, stored as part of the file name
   */
  messageSlug: string | null;

  /**
   * The full path to this migration on disk
   */
  fullPath: string;

  /**
   * If there was a previous migration, that
   */
  previous: FileMigration | null;
}

export const slowGeneratePlaceholderReplacement = (
  parsedSettings: ParsedSettings,
  { database }: Context,
): ((str: string) => string) => {
  const placeholders = mergeWithoutClobbering(
    parsedSettings.placeholders || {},
    {
      ":DATABASE_NAME": database,
      ":DATABASE_OWNER": parsedSettings.databaseOwner,
    },
    "do not specify reserved placeholders.",
  );

  const regexp = new RegExp(
    "(?:" + Object.keys(placeholders).map(escapeRegexp).join("|") + ")\\b",
    "g",
  );
  return (str: string): string =>
    str.replace(regexp, (keyword): string => placeholders[keyword] || "");
};

export const generatePlaceholderReplacement = memoize(
  slowGeneratePlaceholderReplacement,
);

// So memoization above holds from compilePlaceholders
const contextObj = memoize((database: string) => ({ database }));

export function compilePlaceholders(
  parsedSettings: ParsedSettings,
  content: string,
  shadow = false,
): string {
  const database = shadow
    ? parsedSettings.shadowDatabaseName
    : parsedSettings.databaseName;
  if (!database) {
    throw new Error("Could not determine name of the database");
  }
  return generatePlaceholderReplacement(
    parsedSettings,
    contextObj(database),
  )(content);
}

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await fsp.realpath(path);
  } catch (e) {
    return null;
  }
}

export async function compileIncludes(
  parsedSettings: ParsedSettings,
  content: string,
  processedFiles: ReadonlySet<string>,
): Promise<string> {
  const regex = /^--![ \t]*include[ \t]+(.*\.sql)[ \t]*$/gm;

  // Find all includes in this `content`
  const matches = [...content.matchAll(regex)];

  // There's no includes
  if (matches.length === 0) {
    return content;
  }

  // Since there's at least one include, we need the fixtures path:
  const rawFixturesPath = `${parsedSettings.migrationsFolder}/fixtures`;
  const fixturesPath = await realpathOrNull(rawFixturesPath);
  if (!fixturesPath) {
    throw new Error(
      `File contains '--!include' but fixtures folder '${rawFixturesPath}' doesn't exist?`,
    );
  }

  // Go through these matches and resolve their full paths, checking they are allowed
  const sqlPathByRawSqlPath = Object.create(null) as Record<string, string>;
  for (const match of matches) {
    const [line, rawSqlPath] = match;
    const sqlPath = await realpathOrNull(`${fixturesPath}/${rawSqlPath}`);

    if (!sqlPath) {
      throw new Error(
        `Include of '${rawSqlPath}' failed because '${fixturesPath}/${rawSqlPath}' doesn't seem to exist?`,
      );
    }

    if (processedFiles.has(sqlPath)) {
      throw new Error(
        `Circular include detected - '${sqlPath}' is included again! Import statement: \`${line}\`; trace:\n  ${[...processedFiles].reverse().join("\n  ")}`,
      );
    }

    const relativePath = relative(fixturesPath, sqlPath);
    if (relativePath.startsWith("..")) {
      throw new Error(
        `Forbidden: cannot include path '${sqlPath}' because it's not inside '${fixturesPath}'`,
      );
    }

    // Looks good to me
    sqlPathByRawSqlPath[rawSqlPath] = sqlPath;
  }

  // For the unique set of paths, load the file and then recursively do its own includes
  const distinctSqlPaths = [...new Set(Object.values(sqlPathByRawSqlPath))];
  const contentsForDistinctSqlPaths = await Promise.all(
    distinctSqlPaths.map(async (sqlPath) => {
      const fileContents = await fsp.readFile(sqlPath, "utf8");
      const processed = await compileIncludes(
        parsedSettings,
        fileContents,
        new Set([...processedFiles, sqlPath]),
      );
      return processed;
    }),
  );

  // Turn the results into a map for ease of lookup
  const contentBySqlPath = Object.create(null) as Record<string, string>;
  for (let i = 0, l = distinctSqlPaths.length; i < l; i++) {
    const sqlPath = distinctSqlPaths[i];
    const content = contentsForDistinctSqlPaths[i];
    contentBySqlPath[sqlPath] = content;
  }

  // Simple string replacement for each path matched
  const compiledContent = content.replace(
    regex,
    (_match, rawSqlPath: string) => {
      const sqlPath = sqlPathByRawSqlPath[rawSqlPath];
      const content = contentBySqlPath[sqlPath];
      return content;
    },
  );

  return compiledContent;
}

const TABLE_CHECKS = {
  migrations: {
    columnCount: 4,
  },
  current: {
    columnCount: 3,
  },
};

async function verifyGraphileMigrateSchema(pgClient: Client): Promise<null> {
  // Verify that graphile_migrate schema exists
  const {
    rows: [graphileMigrateSchema],
  } = await pgClient.query<{ oid: string }>(
    `select oid from pg_namespace where nspname = 'graphile_migrate';`,
  );
  if (!graphileMigrateSchema) {
    throw new Error(
      "You've set manageGraphileMigrateSchema to false, but have not installed our database schema - we cannot continue.",
    );
  }

  for (const [tableName, expected] of Object.entries(TABLE_CHECKS)) {
    // Check that table exists
    const {
      rows: [table],
    } = await pgClient.query<{ oid: string }>(
      `select oid from pg_class where relnamespace = ${graphileMigrateSchema.oid} and relname = '${tableName}'  and relkind = 'r'`,
    );
    if (!table) {
      throw new Error(
        `You've set manageGraphileMigrateSchema to false, but the 'graphile_migrate.${tableName}' table couldn't be found - we cannot continue.`,
      );
    }

    // Check that it has the right number of columns
    const { rows: columns } = await pgClient.query<{
      attrelid: string;
      attname: string;
    }>(
      `select attrelid, attname from pg_attribute where attrelid = ${table.oid} and attnum > 0`,
    );
    if (columns.length !== expected.columnCount) {
      throw new Error(
        `You've set manageGraphileMigrateSchema to false, but the 'graphile_migrate.${tableName}' table has the wrong number of columns (${columns.length} != ${expected.columnCount}) - we cannot continue.`,
      );
    }
  }

  return null;
}

export async function _migrateMigrationSchema(
  pgClient: Client,
  parsedSettings: ParsedSettings,
): Promise<void> {
  if (!parsedSettings.manageGraphileMigrateSchema) {
    // Verify schema
    await verifyGraphileMigrateSchema(pgClient);
    return;
  }

  await pgClient.query(`
    create schema if not exists graphile_migrate;

    create table if not exists graphile_migrate.migrations (
      hash text primary key,
      previous_hash text references graphile_migrate.migrations,
      filename text not null,
      date timestamptz not null default now()
    );

    create table if not exists graphile_migrate.current (
      filename text primary key default 'current.sql',
      content text not null,
      date timestamptz not null default now()
    );
  `);
}

export function parseMigrationText(
  fullPath: string,
  contents: string,

  /**
   * Should be set true for committed migrations - requires that there is a \n\n divide after the header
   */
  strict = true,
): {
  headers: {
    [key: string]: string | null;
  };
  body: string;
} {
  const lines = contents.split("\n");

  const headers: {
    [key: string]: string | null;
  } = {};
  let headerLines = 0;
  for (const line of lines) {
    // Headers always start with a capital letter
    const matches = /^--! ([A-Z][a-zA-Z0-9_]*)(?::(.*))?$/.exec(line);
    if (!matches) {
      // Not headers any more
      break;
    }
    headerLines++;
    const [, key, value = null] = matches;
    if (key in headers) {
      throw new Error(
        `Invalid migration '${fullPath}': header '${key}' is specified more than once`,
      );
    }
    headers[key] = value ? value.trim() : value;
  }

  // The `\r\n` should never exist; however Windows users may be having git convert LF to CRLF, corrupting migrations.
  if (strict && lines[headerLines] !== "") {
    if (lines[headerLines] === "\r") {
      throw new Error(
        `Invalid migration '${fullPath}': it looks like the line endings have been corrupted - perhaps you have configured git to replace LF with CRLF? Here's a couple potential solutions:
Option 1: Add \`path/to/migrations/committed/*.sql -text\` to \`.gitattributes\` in your repository
Option 2: Globally reconfigure git to convert CRLF to LF on commit, but never convert LF back to CRLF: \`git config --global core.autocrlf input\`
`,
      );
    } else {
      throw new Error(
        `Invalid migration '${fullPath}': there should be two newlines after the headers section`,
      );
    }
  }

  const body = lines.slice(headerLines).join("\n").trim() + "\n";
  return { headers, body };
}

export function serializeHeader(key: string, value: string | null): string {
  return `--! ${key}` + (value ? `: ${value}` : "");
}

export function serializeMigration(
  body: string,
  headers: { [key: string]: string | null | undefined },
): string {
  const headerLines = [];

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    headerLines.push(serializeHeader(key, value));
  }
  const finalBody = `${body.trim()}\n`;
  if (headerLines.length) {
    return `${headerLines.join("\n")}\n\n${finalBody}`;
  } else {
    return finalBody;
  }
}

export const isMigrationFilename = (
  filename: string,
): RegExpMatchArray | null => VALID_FILE_REGEX.exec(filename);

export async function getLastMigration(
  pgClient: Client,
  parsedSettings: ParsedSettings,
): Promise<DbMigration | null> {
  await _migrateMigrationSchema(pgClient, parsedSettings);

  const {
    rows: [row],
  } = await pgClient.query<{
    filename: string;
    previousHash: string | null;
    hash: string;
    date: Date;
  }>(
    `select filename, previous_hash as "previousHash", hash, date from graphile_migrate.migrations order by filename desc limit 1`,
  );
  return (row as DbMigration) || null;
}

export async function getAllMigrations(
  parsedSettings: ParsedSettings,
): Promise<Array<FileMigration>> {
  const { migrationsFolder } = parsedSettings;
  const committedMigrationsFolder = `${migrationsFolder}/committed`;
  try {
    await fsp.mkdir(migrationsFolder);
  } catch (e) {
    // noop
  }
  try {
    await fsp.mkdir(committedMigrationsFolder);
  } catch (e) {
    // noop
  }
  const files = await fsp.readdir(committedMigrationsFolder);
  const migrations: Array<FileMigration> = await Promise.all(
    files
      .map(isMigrationFilename)
      .filter((matches): matches is RegExpMatchArray => !!matches)
      .map(async (matches): Promise<FileMigration> => {
        const [realFilename, migrationNumberString, messageSlug = null] =
          matches;
        const fullPath = `${committedMigrationsFolder}/${realFilename}`;
        const contents = await fsp.readFile(fullPath, "utf8");

        const { headers, body } = parseMigrationText(fullPath, contents);

        // --! Previous:
        const previousHashRaw = headers["Previous"];
        if (!previousHashRaw) {
          throw new Error(
            `Invalid committed migration '${fullPath}': no 'Previous' comment`,
          );
        }
        const previousHash =
          previousHashRaw && previousHashRaw !== "-" ? previousHashRaw : null;

        // --! Hash:
        const hash = headers["Hash"];
        if (!hash) {
          throw new Error(
            `Invalid committed migration '${fullPath}': no 'Hash' comment`,
          );
        }

        // --! Message:
        const message = headers["Message"];

        // --! AllowInvalidHash
        const allowInvalidHash = "AllowInvalidHash" in headers;

        return {
          realFilename,
          filename: migrationNumberString + ".sql",
          message,
          messageSlug,
          fullPath,
          hash,
          previousHash,
          allowInvalidHash,
          body,
          previous: null,
        };
      }),
  );
  migrations.sort((a, b) => a.filename.localeCompare(b.filename, "en"));
  // Validate and link
  let previous = null;
  for (const migration of migrations) {
    if (!previous) {
      if (migration.previousHash != null) {
        throw new Error(
          `Migration '${migration.filename}' expected a previous migration ('${migration.previousHash}'), but no correctly ordered previous migration was found`,
        );
      }
    } else {
      if (migration.previousHash !== previous.hash) {
        throw new Error(
          `Previous migration with hash '${previous.hash}' doesn't match '${migration.filename}''s expected previous hash '${migration.previousHash}'`,
        );
      }
    }
    migration.previous = previous;
    previous = migration;
  }
  return migrations;
}

export async function getMigrationsAfter(
  parsedSettings: ParsedSettings,
  previousMigration: Migration | null,
): Promise<Array<FileMigration>> {
  const allMigrations = await getAllMigrations(parsedSettings);
  return allMigrations.filter(
    (m) => !previousMigration || m.filename > previousMigration.filename,
  );
}

export async function runStringMigration(
  pgClient: Client,
  parsedSettings: ParsedSettings,
  context: Context,
  rawBody: string,
  filename: string,
  committedMigration?: FileMigration,
  dryRun?: boolean,
): Promise<{ sql: string; transaction: boolean }> {
  const placeholderReplacement = generatePlaceholderReplacement(
    parsedSettings,
    context,
  );
  const sql = placeholderReplacement(rawBody);
  const transaction = isNoTransactionDefined(sql) === false;
  if (dryRun) {
    return { sql, transaction };
  }
  return withAdvisoryLock(pgClient, async () => {
    if (transaction) {
      await pgClient.query("begin");
    }
    try {
      await runQueryWithErrorInstrumentation(pgClient, sql, filename);
      if (committedMigration) {
        const { hash, previousHash, filename } = committedMigration;
        await pgClient.query({
          name: "migration-insert",
          text: "insert into graphile_migrate.migrations(hash, previous_hash, filename) values ($1, $2, $3)",
          values: [hash, previousHash, filename],
        });
      }
      if (transaction) {
        await pgClient.query("commit");
      }
      return { sql, transaction };
    } catch (e) {
      if (transaction) {
        await pgClient.query("rollback");
      }
      throw e;
    }
  });
}

export async function undoMigration(
  parsedSettings: ParsedSettings,
  committedMigration: FileMigration,
): Promise<void> {
  const { hash } = committedMigration;
  await withClient(
    parsedSettings.connectionString,
    parsedSettings,
    async (pgClient) => {
      await pgClient.query({
        name: "migration-delete",
        text: "delete from graphile_migrate.migrations where hash = $1",
        values: [hash],
      });
    },
  );
}

export async function runCommittedMigration(
  pgClient: Client,
  parsedSettings: ParsedSettings,
  context: Context,
  committedMigration: FileMigration,
  logSuffix: string,
): Promise<void> {
  const { hash, realFilename, filename, body, previousHash, allowInvalidHash } =
    committedMigration;
  // Check the hash
  const newHash = calculateHash(body, previousHash);
  const hashIsInvalid = newHash !== hash;
  if (hashIsInvalid && !allowInvalidHash) {
    throw new Error(
      `Hash for ${realFilename} does not match - ${newHash} !== ${hash}; has the file been tampered with?`,
    );
  }
  if (allowInvalidHash && !hashIsInvalid) {
    throw new Error(
      `Invalid hash allowed for ${realFilename}; but hash matches.`,
    );
  }
  parsedSettings.logger.info(
    `graphile-migrate${logSuffix}: Running migration '${realFilename}'${
      hashIsInvalid ? " (🚨 INVALID HASH, allowed via AllowInvalidHash 🚨)" : ""
    }`,
  );
  await runStringMigration(
    pgClient,
    parsedSettings,
    context,
    body,
    filename,
    committedMigration,
  );
}

export async function reverseMigration(
  pgClient: Client,
  _body: string,
): Promise<void> {
  // TODO: reverse the migration

  // Clean up graphile_migrate.current
  await pgClient.query(
    `delete from graphile_migrate.current where filename = 'current.sql'`,
  );
}
