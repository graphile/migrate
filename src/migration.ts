import { calculateHash } from "./hash";
import { Client, Context, withClient } from "./pg";
import * as fsp from "./fsp";
import { ParsedSettings } from "./settings";
import memoize from "./memoize";
import { runQueryWithErrorInstrumentation } from "./instrumentation";

// NEVER CHANGE THESE!
const PREVIOUS = "--! Previous: ";
const HASH = "--! Hash: ";

// From https://stackoverflow.com/a/3561711/141284
function escapeRegexp(str: string): string {
  return str.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

export interface Migration {
  filename: string;
  hash: string;
  previousHash: string | null;
}

export interface DbMigration extends Migration {
  date: Date;
}

export interface FileMigration extends Migration {
  body: string;
  fullPath: string;
  previous: FileMigration | null;
}

export const slowGeneratePlaceholderReplacement = (
  parsedSettings: ParsedSettings,
  { database }: Context
): ((str: string) => string) => {
  const placeholders = {
    ...parsedSettings.placeholders,
    ":DATABASE_NAME": database,
    ":DATABASE_OWNER": parsedSettings.databaseOwner,
  };

  const regexp = new RegExp(
    "(?:" +
      Object.keys(placeholders)
        .map(escapeRegexp)
        .join("|") +
      ")\\b",
    "g"
  );
  return (str: string): string =>
    str.replace(regexp, (keyword): string => placeholders[keyword] || "");
};

export const generatePlaceholderReplacement = memoize(
  slowGeneratePlaceholderReplacement
);

export async function _migrateMigrationSchema(
  pgClient: Client,
  _parsedSettings: ParsedSettings
): Promise<void> {
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

export async function getLastMigration(
  pgClient: Client,
  parsedSettings: ParsedSettings
): Promise<DbMigration | null> {
  if (!parsedSettings.skipOwnSchema) {
    await _migrateMigrationSchema(pgClient, parsedSettings);
  }

  const {
    rows: [row],
  } = await pgClient.query(
    `select filename, previous_hash as "previousHash", hash, date from graphile_migrate.migrations order by filename desc limit 1`
  );
  return (row as DbMigration) || null;
}

export async function getAllMigrations(
  parsedSettings: ParsedSettings
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
  const isMigration = (filename: string): RegExpMatchArray | null =>
    /^[0-9]{6,}\.sql/.exec(filename);
  const migrations: Array<FileMigration> = await Promise.all(
    files.filter(isMigration).map(
      async (filename): Promise<FileMigration> => {
        const fullPath = `${committedMigrationsFolder}/${filename}`;
        const contents = await fsp.readFile(fullPath, "utf8");
        const i = contents.indexOf("\n");
        const firstLine = contents.substring(0, i);
        if (!firstLine.startsWith(PREVIOUS)) {
          throw new Error(
            "Invalid committed migration - no 'previous' comment"
          );
        }
        const previousHashRaw = firstLine.substring(PREVIOUS.length) || null;
        const previousHash =
          previousHashRaw && previousHashRaw !== "-" ? previousHashRaw : null;
        const j = contents.indexOf("\n", i + 1);
        const secondLine = contents.substring(i + 1, j);
        if (!secondLine.startsWith(HASH)) {
          throw new Error("Invalid committed migration - no 'hash' comment");
        }
        const hash = secondLine.substring(HASH.length);
        if (contents[j + 1] !== "\n") {
          throw new Error(`Invalid migration header in '${fullPath}'`);
        }
        const body = contents.substring(j + 2);
        return {
          filename,
          fullPath,
          hash,
          previousHash,
          body,
          previous: null,
        };
      }
    )
  );
  migrations.sort((a, b) => a.filename.localeCompare(b.filename));
  // Validate and link
  let previous = null;
  for (const migration of migrations) {
    if (!previous) {
      if (migration.previousHash !== null) {
        throw new Error(
          `Migration '${migration.filename}' expected a previous migration, but no correctly ordered previous migration was found`
        );
      }
    } else {
      if (migration.previousHash !== previous.hash) {
        throw new Error(
          `Previous migration with hash '${previous.hash}' doesn't match '${migration.filename}''s expected previous hash '${migration.previousHash}'`
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
  previousMigration: Migration | null
): Promise<Array<FileMigration>> {
  const allMigrations = await getAllMigrations(parsedSettings);
  return allMigrations.filter(
    m => !previousMigration || m.filename > previousMigration.filename
  );
}

export async function runStringMigration(
  pgClient: Client,
  parsedSettings: ParsedSettings,
  context: Context,
  rawBody: string,
  filename: string,
  committedMigration?: FileMigration,
  dryRun?: boolean
): Promise<{ sql: string; transaction: boolean }> {
  const placeholderReplacement = generatePlaceholderReplacement(
    parsedSettings,
    context
  );
  const sql = placeholderReplacement(rawBody);
  const i = sql.indexOf("\n");
  const firstLine = sql.substring(0, i);
  const transaction = !/^--!\s*no-transaction\b/.exec(firstLine);
  if (dryRun) {
    return { sql, transaction };
  }
  if (transaction) {
    await pgClient.query("begin");
  }
  try {
    await runQueryWithErrorInstrumentation(pgClient, sql, filename);
    if (committedMigration) {
      const { hash, previousHash, filename } = committedMigration;
      await pgClient.query({
        name: "migration-insert",
        text:
          "insert into graphile_migrate.migrations(hash, previous_hash, filename) values ($1, $2, $3)",
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
}

export async function undoMigration(
  parsedSettings: ParsedSettings,
  committedMigration: FileMigration
): Promise<void> {
  const { hash } = committedMigration;
  await withClient(
    parsedSettings.connectionString,
    parsedSettings,
    async pgClient => {
      await pgClient.query({
        name: "migration-delete",
        text: "delete from graphile_migrate.migrations where hash = $1",
        values: [hash],
      });
    }
  );
}

export async function runCommittedMigration(
  pgClient: Client,
  parsedSettings: ParsedSettings,
  context: Context,
  committedMigration: FileMigration,
  logSuffix: string
): Promise<void> {
  const { hash, filename, body, previousHash } = committedMigration;
  // Check the hash
  const newHash = calculateHash(body, previousHash);
  if (newHash !== hash) {
    throw new Error(
      `Hash for ${filename} does not match - ${newHash} !== ${hash}; has the file been tampered with?`
    );
  }
  // eslint-disable-next-line no-console
  console.log(`graphile-migrate${logSuffix}: Running migration '${filename}'`);
  await runStringMigration(
    pgClient,
    parsedSettings,
    context,
    body,
    filename,
    committedMigration
  );
}

export async function reverseMigration(
  pgClient: Client,
  _body: string
): Promise<void> {
  // TODO: reverse the migration

  // Clean up graphile_migrate.current
  await pgClient.query(
    `delete from graphile_migrate.current where filename = 'current.sql'`
  );
}
