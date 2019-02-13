import * as pg from "pg";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as chokidar from "chokidar";
import { promisify } from "util";

const migrationsFolder = `${process.cwd()}/migrations`;

const calculateHash = (str: string) =>
  crypto
    .createHash("sha1")
    .update(str)
    .digest("hex");

// NEVER CHANGE THESE!
const PREVIOUS = "--! Previous: ";
const HASH = "--! Hash: ";

const fsp = {
  readFile: promisify(fs.readFile),
  writeFile: promisify(fs.writeFile),
  stat: promisify(fs.stat),
  readdir: promisify(fs.readdir),
  mkdir: promisify(fs.mkdir),
};

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

async function migrateMigrationSchema(pgClient: pg.PoolClient) {
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

async function getLastMigration(
  pgClient: pg.PoolClient
): Promise<DbMigration | null> {
  await migrateMigrationSchema(pgClient);
  const {
    rows: [row],
  } = await pgClient.query(
    `select filename, previous_hash as "previousHash", hash, date from graphile_migrate.migrations order by filename desc limit 1`
  );
  return (row as DbMigration) || null;
}

async function getAllMigrations(): Promise<Array<FileMigration>> {
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

async function getMigrationsAfter(
  previousMigration: Migration | null
): Promise<Array<FileMigration>> {
  const allMigrations = await getAllMigrations();
  return allMigrations.filter(
    m => !previousMigration || m.filename > previousMigration.filename
  );
}

async function runStringMigration(
  pgClient: pg.PoolClient,
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

async function runCommittedMigration(
  pgClient: pg.PoolClient,
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
    await runStringMigration(pgClient, body, committedMigration);
  } catch (e) {
    // tslint:disable-next-line no-console
    console.error("Migration failed: ", e);
    process.exit(1);
  }
}

export async function migrate(settings: Settings) {
  validateSettings(settings);
  const { connectionString } = settings;
  await withClient(connectionString, async pgClient => {
    const lastMigration = await getLastMigration(pgClient);
    const remainingMigrations = await getMigrationsAfter(lastMigration);
    // Run migrations in series
    for (const migration of remainingMigrations) {
      await runCommittedMigration(pgClient, migration);
    }
    // tslint:disable-next-line no-console
    console.log("graphile-migrate: Up to date");
  });
}

interface Settings {
  connectionString: string;
  shadowConnectionString: string;
}

function validateSettings(settings: unknown): settings is Settings {
  if (!settings) {
    throw new Error("Expected settings object");
  }
  if (typeof settings !== "object") {
    throw new Error("Expected settings object, received " + typeof settings);
  }
  // tslint:disable no-string-literal
  if (typeof settings!["connectionString"] !== "string") {
    throw new Error("Expected settings.connectionString to be a string");
  }
  if (typeof settings!["shadowConnectionString"] !== "string") {
    throw new Error("Expected settings.shadowConnectionString to be a string");
  }
  // tslint:enable no-string-literal
  return true;
}

export async function watch(settings: Settings) {
  validateSettings(settings);
  await migrate(settings);
  // Watch the file
  const currentMigrationPath = `${migrationsFolder}/current.sql`;
  try {
    await fsp.stat(currentMigrationPath);
  } catch (e) {
    if (e.code === "ENOENT") {
      await fsp.writeFile(currentMigrationPath, "-- Enter migration here");
    } else {
      throw e;
    }
  }
  const watcher = chokidar.watch(currentMigrationPath);
  let running = false;
  let runAgain = false;
  async function run() {
    try {
      // tslint:disable-next-line no-console
      console.log(`[${new Date().toISOString()}]: running current.sql`);
      const body = await fsp.readFile(currentMigrationPath, "utf8");
      await withClient(settings.connectionString, pgClient =>
        runStringMigration(pgClient, body)
      );
    } catch (e) {
      // tslint:disable-next-line no-console
      console.error(e);
    }
  }
  function queue() {
    if (running) {
      runAgain = true;
      return;
    }
    running = true;

    run().finally(() => {
      running = false;
      if (runAgain) {
        run();
      }
    });
  }
  watcher.on("change", queue);
  queue();
}

async function withClient(
  connectionString: string,
  callback: (pgClient: pg.PoolClient) => Promise<void>
) {
  const pgPool = new pg.Pool({ connectionString });
  pgPool.on("error", (err: Error) => {
    // tslint:disable-next-line no-console
    console.error("An error occurred in the PgPool", err);
    process.exit(1);
  });
  try {
    const pgClient = await pgPool.connect();
    try {
      await callback(pgClient);
    } finally {
      await pgClient.release();
    }
  } finally {
    await pgPool.end();
  }
}
