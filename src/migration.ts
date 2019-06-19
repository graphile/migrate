import { calculateHash } from "./hash";
import { Client, Context } from "./pg";
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

interface Migration {
  filename: string;
  hash: string;
  previousHash: string | null;
}

interface DbMigration extends Migration {
  date: Date;
}

interface FileMigration extends Migration {
  body: string;
  fullPath: string;
  previous: FileMigration | null;
}

export const generatePlaceholderReplacement = memoize(
  (
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
    return str => str.replace(regexp, keyword => placeholders[keyword] || "");
  }
);

async function migrateMigrationSchema(
  pgClient: Client,
  _parsedSettings: ParsedSettings
) {
  await pgClient.query(`
    create schema if not exists graphile_migrate;

    create table if not exists graphile_migrate.migrations (
      hash text primary key,
      previous_hash text references graphile_migrate.migrations,
      filename text not null,
      date timestamptz not null default now()
    );
  `);
}

export async function getLastMigration(
  pgClient: Client,
  parsedSettings: ParsedSettings
): Promise<DbMigration | null> {
  await migrateMigrationSchema(pgClient, parsedSettings);
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
  const isMigration = (filename: string) => filename.match(/^[0-9]{6,}\.sql/);
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
          throw new Error("Invalid migration header in '${fullPath}'");
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
          `Migration '${
            migration.filename
          }' expected a previous migration, but no correctly ordered previous migration was found`
        );
      }
    } else {
      if (migration.previousHash !== previous.hash) {
        throw new Error(
          `Previous migration with hash '${previous.hash}' doesn't match '${
            migration.filename
          }''s expected previous hash '${migration.previousHash}'`
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
  committedMigration?: FileMigration
) {
  const placeholderReplacement = generatePlaceholderReplacement(
    parsedSettings,
    context
  );
  const body = placeholderReplacement(rawBody);
  const i = body.indexOf("\n");
  const firstLine = body.substring(0, i);
  const transaction = !firstLine.match(/^--!\s*no-transaction\b/);
  if (transaction) {
    await pgClient.query("begin");
  }
  try {
    await runQueryWithErrorInstrumentation(pgClient, body, filename);
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
  } catch (e) {
    if (transaction) {
      await pgClient.query("rollback");
    }
    throw e;
  }
}

export async function runCommittedMigration(
  pgClient: Client,
  parsedSettings: ParsedSettings,
  context: Context,
  committedMigration: FileMigration,
  logSuffix: string
) {
  const { hash, filename, body, previousHash } = committedMigration;
  // Check the hash
  const newHash = calculateHash(body, previousHash);
  if (newHash !== hash) {
    throw new Error(
      `Hash for ${filename} does not match - ${newHash} !== ${hash}; has the file been tampered with?`
    );
  }
  // tslint:disable-next-line no-console
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
