jest.mock("child_process");
jest.mock("../src/migration");

import { Pool, PoolClient } from "pg";

import { _makeCurrentMigrationRunner, _watch } from "../src/commands/watch";
import { _migrateMigrationSchema } from "../src/migration";
import { ParsedSettings, parseSettings } from "../src/settings";
import { resetDb, TEST_DATABASE_URL } from "./helpers";

beforeEach(resetDb);

async function withClient<T>(
  parsedSettings: ParsedSettings,
  cb: (client: PoolClient) => Promise<T>,
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
  it("throws error if we set the option to something strange", async () => {
    let error;
    try {
      await parseSettings({
        connectionString: TEST_DATABASE_URL,
        // @ts-ignore Deliberate error - that's what we're testing
        manageGraphileMigrateSchema: "false",
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeTruthy();
    expect(error).toMatchInlineSnapshot(`
      [Error: Errors occurred during settings validation:
      - Setting 'manageGraphileMigrateSchema': Expected boolean, received 'string']
    `);
  });

  it("throws error if schema doesn't exist", async () => {
    const error = await getError();
    expect(error).toBeTruthy();
    expect(error).toMatchInlineSnapshot(
      `[Error: You've set manageGraphileMigrateSchema to false, but have not installed our database schema - we cannot continue.]`,
    );
  });

  it("throws error if schema exists but is empty", async () => {
    const error = await getError(`
      create schema graphile_migrate;
    `);
    expect(error).toBeTruthy();
    expect(error).toMatchInlineSnapshot(
      `[Error: You've set manageGraphileMigrateSchema to false, but the 'graphile_migrate.migrations' table couldn't be found - we cannot continue.]`,
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
      `[Error: You've set manageGraphileMigrateSchema to false, but the 'graphile_migrate.current' table couldn't be found - we cannot continue.]`,
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
      `[Error: You've set manageGraphileMigrateSchema to false, but the 'graphile_migrate.migrations' table has the wrong number of columns (3 != 4) - we cannot continue.]`,
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
