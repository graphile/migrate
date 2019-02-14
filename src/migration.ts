import { calculateHash } from "./hash";
import { Client } from "./pg";
import { ParsedSettings } from "./parsedSettings";
import * as fsp from "./fsp";
import { ParsedSettings } from "./settings";

// NEVER CHANGE THESE!
const PREVIOUS = "--! Previous: ";
const HASH = "--! Hash: ";

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
  const isMigration = (filename: string) => filename.match(/^[0-9]{6}_.*\.sql/);
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
        const previousHash = firstLine.substring(PREVIOUS.length) || null;
        const j = contents.indexOf("\n", i + 1);
        const secondLine = contents.substring(i + 1, j);
        if (!secondLine.startsWith(HASH)) {
          throw new Error("Invalid committed migration - no 'hash' comment");
        }
        const hash = secondLine.substring(HASH.length);
        const body = contents.substring(j + 1).trim();
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
          }''s expected previous hash ${migration.previousHash}`
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
  _parsedSettings: ParsedSettings,
  body: string,
  committedMigration?: FileMigration
) {
  const i = body.indexOf("\n");
  const firstLine = body.substring(0, i);
  const transaction = !firstLine.match(/^--!\s*no-transaction\b/);
  if (transaction) {
    await pgClient.query("begin");
  }
  try {
    await pgClient.query({
      text: body,
    });
  } catch (e) {
    // tslint:disable-next-line no-console
    console.error(`Error occurred whilst processing migration: ${e.message}`);
    // tslint:disable-next-line no-console
    // console.error(e);
  }
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
}

export async function runCommittedMigration(
  pgClient: Client,
  parsedSettings: ParsedSettings,
  committedMigration: FileMigration
) {
  const { hash, filename, body } = committedMigration;
  // Check the hash
  const newHash = calculateHash(body);
  if (newHash !== hash) {
    throw new Error(
      `Hash for ${filename} does not match - ${newHash} !== ${hash}; has the file been tampered with?`
    );
  }
  // tslint:disable-next-line no-console
  console.log(`graphile-migrate: Running migration '${filename}'`);
  try {
    await runStringMigration(
      pgClient,
      parsedSettings,
      body,
      committedMigration
    );
  } catch (e) {
    // tslint:disable-next-line no-console
    console.error("Migration failed: ", e);
    process.exit(1);
  }
}
