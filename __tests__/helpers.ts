jest.unmock("pg");

import "mock-fs"; // MUST BE BEFORE EVERYTHING

import { exec } from "child_process";
import { createHash } from "crypto";
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
  process.env.TEST_ROOT_DATABASE_URL || "postgres";

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
      max: 1,
      idleTimeoutMillis: 1,
    });
  }
  const { user, password } = parsedTestDatabaseUrl;
  if (!user || !password) {
    throw new Error(
      "TEST_DATABASE_URL does not contain a username and password",
    );
  }
  const client = await rootPgPool.connect();
  try {
    await client.query(
      `DROP DATABASE IF EXISTS ${escapeIdentifier(TEST_DATABASE_NAME)};`,
    );
    await client.query(
      `DROP DATABASE IF EXISTS ${escapeIdentifier(TEST_SHADOW_DATABASE_NAME)};`,
    );
    await client.query(`DROP ROLE IF EXISTS ${escapeIdentifier(user)};`);
    await client.query(
      `CREATE ROLE ${escapeIdentifier(
        user,
      )} WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}';`,
    );
    await client.query(
      `CREATE DATABASE ${escapeIdentifier(
        TEST_DATABASE_NAME,
      )} OWNER ${escapeIdentifier(user)};`,
    );
    await client.query(
      `CREATE DATABASE ${escapeIdentifier(
        TEST_SHADOW_DATABASE_NAME,
      )} OWNER ${escapeIdentifier(user)};`,
    );
  } finally {
    await client.release();
  }
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

export const makeMigrations = (commitMessage?: string) => {
  const MIGRATION_1_TEXT = "create table foo (id serial primary key);";
  const MIGRATION_1_HASH = "bfe32129112f19d4cadd717c1c15ed7ccbca4408";
  const MIGRATION_1_COMMITTED = `--! Previous: -\n--! Hash: sha1:${MIGRATION_1_HASH}${
    commitMessage ? `\n--! Message: ${commitMessage}` : ``
  }\n\n${MIGRATION_1_TEXT.trim()}\n`;

  const MIGRATION_2_TEXT =
    "\n\n\ncreate table bar (id serial primary key);\n\n\n";
  const MIGRATION_2_HASH = createHash("sha1")
    .update(`sha1:${MIGRATION_1_HASH}\n${MIGRATION_2_TEXT.trim()}` + "\n")
    .digest("hex");
  const MIGRATION_2_COMMITTED = `--! Previous: sha1:${MIGRATION_1_HASH}\n--! Hash: sha1:${MIGRATION_2_HASH}${
    commitMessage ? `\n--! Message: ${commitMessage}` : ``
  }\n\n${MIGRATION_2_TEXT.trim()}\n`;

  const MIGRATION_MULTIFILE_FILES = {
    "001.sql": "select 1;",
    "002-two.sql": "select 2;",
    "003.sql": "select 3;",
  };

  const MIGRATION_MULTIFILE_TEXT = `\
--! split: 001.sql
select 1;
--! split: 002-two.sql
select 2;
--! split: 003.sql
select 3;
`;
  const MIGRATION_MULTIFILE_HASH = createHash("sha1")
    .update(
      `sha1:${MIGRATION_1_HASH}\n${MIGRATION_MULTIFILE_TEXT.trim()}` + "\n",
    )
    .digest("hex");
  const MIGRATION_MULTIFILE_COMMITTED = `--! Previous: sha1:${MIGRATION_1_HASH}\n--! Hash: sha1:${MIGRATION_MULTIFILE_HASH}${
    commitMessage ? `\n--! Message: ${commitMessage}` : ``
  }\n\n${MIGRATION_MULTIFILE_TEXT.trim()}\n`;
  return {
    MIGRATION_1_TEXT,
    MIGRATION_1_HASH,
    MIGRATION_1_COMMITTED,
    MIGRATION_2_TEXT,
    MIGRATION_2_HASH,
    MIGRATION_2_COMMITTED,
    MIGRATION_MULTIFILE_TEXT,
    MIGRATION_MULTIFILE_HASH,
    MIGRATION_MULTIFILE_COMMITTED,
    MIGRATION_MULTIFILE_FILES,
  };
};
