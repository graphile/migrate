jest.unmock("pg");
jest.mock("../src/fsp");

import { Settings, ParsedSettings } from "../src/settings";
import { exec } from "child_process";
import * as fsp from "../src/fsp";
import { parse } from "pg-connection-string";
import { Pool } from "pg";
import { _migrateMigrationSchema } from "../src/migration";

export const TEST_DATABASE_URL: string =
  process.env.TEST_DATABASE_URL || "graphile_migrate_test";

export const TEST_DATABASE_NAME =
  parse(TEST_DATABASE_URL).database || "graphile_migrate_test";

if (!/^[a-zA-Z0-9_-]+$/.test(TEST_DATABASE_NAME)) {
  throw new Error("Invalid database name " + TEST_DATABASE_NAME);
}

export const TEST_ROOT_DATABASE_URL: string =
  process.env.TEST_ROOT_DATABASE_URL || "template1";

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
  await rootPgPool.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE_NAME};`);
  await rootPgPool.query(`CREATE DATABASE ${TEST_DATABASE_NAME};`);
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
  content: string
) {
  // @ts-ignore
  fsp.stat.mockImplementationOnce(async (filename, _options) => {
    expect(filename).toEqual(parsedSettings.migrationsFolder + "/current.sql");
    return {};
  });
  // @ts-ignore
  fsp.readFile.mockImplementationOnce(async (filename, encoding) => {
    expect(encoding).toEqual("utf8");
    expect(filename).toEqual(parsedSettings.migrationsFolder + "/current.sql");
    return content;
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
