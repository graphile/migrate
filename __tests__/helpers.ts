jest.unmock("pg");

import "mock-fs"; // MUST BE BEFORE EVERYTHING

import { exec } from "child_process";
import { createHash } from "crypto";
import mockFs from "mock-fs";
import { Pool } from "pg";
import { parse } from "pg-connection-string";

import { _migrateMigrationSchema } from "../src/migration";
import { clearAllPools, escapeIdentifier, withClient } from "../src/pgReal";
import { ParsedSettings, parseSettings, Settings } from "../src/settings";

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

export const TEST_ROOT_DATABASE_URL: string =
  process.env.TEST_ROOT_DATABASE_URL || "postgres:///postgres";

export const settings: Settings = {
  connectionString: TEST_DATABASE_URL,
  shadowConnectionString: TEST_SHADOW_DATABASE_URL,
  rootConnectionString: TEST_ROOT_DATABASE_URL,
};

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
afterAll(() => {
  clearAllPools();
});

const parsedSettingsPromise = parseSettings(settings);
const ROOT_DB = TEST_ROOT_DATABASE_URL + "?max=1&idleTimeoutMillis=1";

async function createDatabases() {
  const { user, password } = parsedTestDatabaseUrl;
  if (!user || !password) {
    throw new Error(
      "TEST_DATABASE_URL does not contain a username and password",
    );
  }
  const parsedSettings = await parsedSettingsPromise;
  await withClient(ROOT_DB, parsedSettings, async (client) => {
    const result = await client.query(
      `select
        exists(select 1 from pg_database where datname = $1) as "hasMain",
        exists(select 1 from pg_database where datname = $2) as "hasShadow",
        exists(select 1 from pg_roles where rolname = $3) as "hasRole"
      `,
      [TEST_DATABASE_NAME, TEST_SHADOW_DATABASE_NAME, user],
    );
    if (!result) {
      // eslint-disable-next-line no-console
      console.dir(client.query);
      // eslint-disable-next-line no-console
      console.dir(result);
      throw new Error("No result?!");
    }
    const {
      rows: [{ hasMain, hasShadow, hasRole }],
    } = result;
    if (!hasRole) {
      await client.query(
        `CREATE ROLE ${escapeIdentifier(
          user,
        )} WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}';`,
      );
    }
    if (!hasMain) {
      await client.query(
        `CREATE DATABASE ${escapeIdentifier(
          TEST_DATABASE_NAME,
        )} OWNER ${escapeIdentifier(user)};`,
      );
    }
    if (!hasShadow) {
      await client.query(
        `CREATE DATABASE ${escapeIdentifier(
          TEST_SHADOW_DATABASE_NAME,
        )} OWNER ${escapeIdentifier(user)};`,
      );
    }
  });
}
beforeAll(createDatabases);

export async function resetDb() {
  const parsedSettings = await parsedSettingsPromise;
  await withClient(TEST_DATABASE_URL, parsedSettings, async (client) => {
    await client.query("drop schema if exists graphile_migrate cascade;");
    {
      const { rows } = await client.query(
        `select relname from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace`,
      );
      for (const row of rows) {
        await client.query(
          `drop table if exists ${escapeIdentifier(row.relname)} cascade;`,
        );
      }
    }
    {
      const { rows } = await client.query(
        `select typname from pg_type where typtype = 'e' and typnamespace = 'public'::regnamespace`,
      );
      for (const row of rows) {
        await client.query(
          `drop type if exists ${escapeIdentifier(row.typname)} cascade;`,
        );
      }
    }
  });
}

interface ActionSpies {
  getActionCalls: () => string[];
  settings: Pick<
    Settings,
    | "beforeReset"
    | "afterReset"
    | "beforeAllMigrations"
    | "afterAllMigrations"
    | "beforeCurrent"
    | "afterCurrent"
  >;
}
export function makeActionSpies(shadow = false): ActionSpies {
  const mockedExec = exec as unknown as jest.Mock<typeof exec>;
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
      beforeAllMigrations: [
        { _: "command", command: "touch beforeAllMigrations" },
      ],
      afterAllMigrations: [
        { _: "command", command: "touch afterAllMigrations" },
      ],
      beforeReset: [{ _: "command", command: "touch beforeReset" }],
      afterReset: [{ _: "command", command: "touch afterReset" }],
      beforeCurrent: [{ _: "command", command: "touch beforeCurrent" }],
      afterCurrent: [{ _: "command", command: "touch afterCurrent" }],
    },
  };
}

function makePgClientMock() {
  return {
    __isMockClient: true,
    query: jest.fn(async () => {
      return { rows: [] };
    }),
  };
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
  const MIGRATION_1_TEXT =
    "create table if not exists foo (id serial primary key);";
  const MIGRATION_1_HASH = "e00ec93314a423ee5cc68d1182ad52f16442d7df";
  const MIGRATION_1_COMMITTED = `--! Previous: -\n--! Hash: sha1:${MIGRATION_1_HASH}${
    commitMessage ? `\n--! Message: ${commitMessage}` : ``
  }\n\n${MIGRATION_1_TEXT.trim()}\n`;

  const MIGRATION_2_TEXT =
    "\n\n\ncreate table if not exists bar (id serial primary key);\n\n\n";
  const MIGRATION_2_HASH = createHash("sha1")
    .update(`sha1:${MIGRATION_1_HASH}\n${MIGRATION_2_TEXT.trim()}` + "\n")
    .digest("hex");
  const MIGRATION_2_COMMITTED = `--! Previous: sha1:${MIGRATION_1_HASH}\n--! Hash: sha1:${MIGRATION_2_HASH}${
    commitMessage ? `\n--! Message: ${commitMessage}` : ``
  }\n\n${MIGRATION_2_TEXT.trim()}\n`;

  const MIGRATION_ENUM_TEXT =
    "drop type if exists user_role;\ncreate type user_role as enum ('User');";
  const MIGRATION_ENUM_HASH = createHash("sha1")
    .update(`sha1:${MIGRATION_1_HASH}\n${MIGRATION_ENUM_TEXT.trim()}` + "\n")
    .digest("hex");
  const MIGRATION_ENUM_COMMITTED = `--! Previous: sha1:${MIGRATION_1_HASH}\n--! Hash: sha1:${MIGRATION_ENUM_HASH}${
    commitMessage ? `\n--! Message: ${commitMessage}` : ``
  }\n\n${MIGRATION_ENUM_TEXT.trim()}\n`;

  const MIGRATION_NOTRX_TEXT =
    "--! no-transaction\nALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Admin';";
  const MIGRATION_NOTRX_HASH = createHash("sha1")
    .update(
      `sha1:${MIGRATION_ENUM_HASH}\n${MIGRATION_NOTRX_TEXT.trim()}` + "\n",
    )
    .digest("hex");
  const MIGRATION_NOTRX_COMMITTED = `--! Previous: sha1:${MIGRATION_ENUM_HASH}\n--! Hash: sha1:${MIGRATION_NOTRX_HASH}${
    commitMessage ? `\n--! Message: ${commitMessage}` : ``
  }\n\n${MIGRATION_NOTRX_TEXT.trim()}\n`;

  const MIGRATION_MULTIFILE_FILES = {
    "migrations/links/two.sql": "select 2;",
    "migrations/current": {
      "001.sql": "select 1;",
      "002-two.sql": mockFs.symlink({
        path: "../links/two.sql",
      }),
      "003.sql": "select 3;",
    },
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
    MIGRATION_ENUM_TEXT,
    MIGRATION_ENUM_HASH,
    MIGRATION_ENUM_COMMITTED,
    MIGRATION_NOTRX_TEXT,
    MIGRATION_NOTRX_HASH,
    MIGRATION_NOTRX_COMMITTED,
    MIGRATION_MULTIFILE_TEXT,
    MIGRATION_MULTIFILE_HASH,
    MIGRATION_MULTIFILE_COMMITTED,
    MIGRATION_MULTIFILE_FILES,
  };
};
