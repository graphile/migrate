jest.unmock("pg");

import "mock-fs"; // MUST BE BEFORE EVERYTHING

import { exec } from "child_process";
import * as mockFs from "mock-fs";
import { Pool } from "pg";
import { parse } from "pg-connection-string";

import { _migrateMigrationSchema } from "../src/migration";
import { escapeIdentifier } from "../src/pg";
import { ParsedSettings, Settings } from "../src/settings";

export const TEST_DATABASE_URL: string =
  process.env.TEST_DATABASE_URL ||
  "postgres://gmtestuser:gmtestpass@localhost/graphile_migrate_test";
export const TEST_SHADOW_DATABASE_URL = TEST_DATABASE_URL + "_shadow";

const parsedTestDatabaseUrl = parse(TEST_DATABASE_URL);
export const TEST_DATABASE_NAME =
  parsedTestDatabaseUrl.database || "graphile_migrate_test";
export const TEST_SHADOW_DATABASE_NAME =
  parse(TEST_SHADOW_DATABASE_URL).database || "graphile_migrate_test_shadow";

if (!/^[a-zA-Z0-9_-]+$/.test(TEST_DATABASE_NAME)) {
  throw new Error("Invalid database name " + TEST_DATABASE_NAME);
}

const TEST_ROOT_DATABASE_URL: string =
  process.env.TEST_ROOT_DATABASE_URL || "template1";

beforeAll(() => {
  // eslint-disable-next-line no-console
  console.log("[mock-fs callsites hack]"); // Without this, jest fails due to 'callsites'
  mockFs({});
});
afterAll(() => {
  mockFs.restore();
});

let rootPgPool: Pool | null = null;
afterAll(() => {
  if (rootPgPool) {
    rootPgPool.end();
  }
  rootPgPool = null;
});

export async function resetDb() {
  if (!rootPgPool) {
    rootPgPool = new Pool({
      connectionString: TEST_ROOT_DATABASE_URL,
    });
  }
  const { user, password } = parsedTestDatabaseUrl;
  if (!user || !password) {
    throw new Error(
      "TEST_DATABASE_URL does not contain a username and password",
    );
  }
  await rootPgPool.query(
    `DROP DATABASE IF EXISTS ${escapeIdentifier(TEST_DATABASE_NAME)};`,
  );
  await rootPgPool.query(
    `DROP DATABASE IF EXISTS ${escapeIdentifier(TEST_SHADOW_DATABASE_NAME)};`,
  );
  await rootPgPool.query(`DROP ROLE IF EXISTS ${escapeIdentifier(user)};`);
  await rootPgPool.query(
    `CREATE ROLE ${escapeIdentifier(
      user,
    )} WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}';`,
  );
  await rootPgPool.query(
    `CREATE DATABASE ${escapeIdentifier(
      TEST_DATABASE_NAME,
    )} OWNER ${escapeIdentifier(user)};`,
  );
  await rootPgPool.query(
    `CREATE DATABASE ${escapeIdentifier(
      TEST_SHADOW_DATABASE_NAME,
    )} OWNER ${escapeIdentifier(user)};`,
  );
}

interface ActionSpies {
  getActionCalls: () => string[];
  settings: Pick<
    Settings,
    "afterAllMigrations" | "afterReset" | "afterCurrent"
  >;
}
export function makeActionSpies(shadow = false): ActionSpies {
  const mockedExec = (exec as unknown) as jest.Mock<typeof exec>;
  if (!mockedExec.mock) {
    throw new Error("Must mock child_process");
  }
  mockedExec.mockReset();
  const calls: string[] = [];
  mockedExec.mockImplementation((_cmd, _opts, cb): any => {
    expect(_opts.env.PATH).toBe(process.env.PATH);
    expect(typeof _opts.env.GM_DBURL).toBe("string");
    if (shadow) {
      expect(_opts.env.GM_SHADOW).toBe("1");
    } else {
      expect(typeof _opts.env.GM_SHADOW).toBe("undefined");
    }
    calls.push(_cmd.replace(/^touch /, ""));
    cb(null, {
      error: null,
      stdout: "",
      stderr: "",
    });
  });
  function getActionCalls() {
    return calls;
  }
  return {
    getActionCalls,
    settings: {
      afterAllMigrations: [
        { _: "command", command: "touch afterAllMigrations" },
      ],
      afterReset: [{ _: "command", command: "touch afterReset" }],
      afterCurrent: [{ _: "command", command: "touch afterCurrent" }],
    },
  };
}

function makePgClientMock() {
  return { query: jest.fn(async () => {}) };
}

export const mockPgClient = makePgClientMock();

export function mockCurrentSqlContentOnce(
  parsedSettings: ParsedSettings,
  content: string,
) {
  mockFs({
    [parsedSettings.migrationsFolder + "/current.sql"]: content,
  });
}

export async function setup(parsedSettings: ParsedSettings) {
  const pool = new Pool({
    connectionString: parsedSettings.connectionString,
    max: 1,
  });
  try {
    const client = await pool.connect();
    try {
      await _migrateMigrationSchema(client, parsedSettings);
    } finally {
      client.release();
    }
  } finally {
    pool.end();
  }
}
