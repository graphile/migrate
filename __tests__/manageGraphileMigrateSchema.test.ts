jest.mock("child_process");
jest.mock("../src/migration");

import { TEST_DATABASE_URL, resetDb } from "./helpers";
import { parseSettings, ParsedSettings } from "../src/settings";
import { _watch, _makeCurrentMigrationRunner } from "../src/commands/watch";
import { _migrateMigrationSchema } from "../src/migration";
import { Pool, PoolClient } from "pg";

beforeEach(resetDb);

async function withClient<T>(
  parsedSettings: ParsedSettings,
  cb: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = new Pool({
    connectionString: parsedSettings.connectionString,
    max: 1,
  });

  try {
    const client = await pool.connect();
    try {
      return await cb(client);
    } finally {
      client.release();
    }
  } finally {
    pool.end();
  }
}
async function getError(initialSchema = ""): Promise<Error | null> {
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    manageGraphileMigrateSchema: false,
  });
  return withClient(parsedSettings, async client => {
    if (initialSchema) {
      await client.query(initialSchema);
    }
    let error = null;
    try {
      await _migrateMigrationSchema(client, parsedSettings);
    } catch (e) {
      error = e;
    }
    return error;
  });
}

describe("manageGraphlileMigrateSchema = false", () => {
  it("throws error if schema doesn't exist", async () => {
    const error = await getError();
    expect(error).toBeTruthy();
    expect(error).toMatchInlineSnapshot(
      `[Error: Couldn't find graphile_migrate schema.]`
    );
  });

  it("throws error if schema exists but is empty", async () => {
    const error = await getError(`
      create schema graphile_migrate;
    `);
    expect(error).toBeTruthy();
    expect(error).toMatchInlineSnapshot(
      `[Error: Couldn't find the current table expected in graphile_migrate schema.]`
    );
  });

  it("throws error if schema exists but doesn't contain one of the tables", async () => {
    const error = await getError(`
      create schema graphile_migrate;

      create table if not exists graphile_migrate.migrations (
        hash text primary key,
        previous_hash text references graphile_migrate.migrations,
        filename text not null,
        date timestamptz not null default now()
      );
    `);
    expect(error).toBeTruthy();
    expect(error).toMatchInlineSnapshot(
      `[Error: Couldn't find the current table expected in graphile_migrate schema.]`
    );
  });

  it("throws error if schema exists but one of the tables has the wrong number of columns", async () => {
    const error = await getError(`
      create schema graphile_migrate;

      create table if not exists graphile_migrate.migrations (
        hash text primary key,
        previous_hash text references graphile_migrate.migrations,
        filename text not null
        -- DELETED LINE
      );

      create table if not exists graphile_migrate.current (
        filename text primary key default 'current.sql',
        content text not null,
        date timestamptz not null default now()
      );
    `);
    expect(error).toBeTruthy();
    expect(error).toMatchInlineSnapshot(
      `[Error: The table migrations doesn't have the right number of columns.]`
    );
  });

  it("succeeds if everything is fine", async () => {
    const error = await getError(`
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
    expect(error).toBeFalsy();
  });
});
