jest.mock("child_process");
jest.mock("../src/pg");
jest.mock("../src/migration");

import "./helpers"; // Has side-effects; must come first

import { spawn } from "child_process";
import { EventEmitter } from "events";
import * as mockFs from "mock-fs";
import { parse } from "pg-connection-string";

import { executeActions } from "../src/actions";
import { withClient } from "../src/pg";
import { parseSettings } from "../src/settings";
import {
  mockPgClient,
  TEST_DATABASE_NAME,
  TEST_DATABASE_URL,
  TEST_ROOT_DATABASE_URL,
} from "./helpers";

beforeAll(() => {
  // eslint-disable-next-line no-console
  console.log("[mock-fs callsites hack]"); // Without this, jest fails due to 'callsites'
  mockFs({});
});

afterAll(() => {
  mockFs.restore();
});

it("runs SQL actions", async () => {
  mockFs({
    "migrations/sqlfile1.sql": `[CONTENT:migrations/sqlfile1.sql]`,
    "migrations/sqlfile2.sql": `[CONTENT:migrations/sqlfile2.sql]`,
  });
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    afterAllMigrations: ["sqlfile1.sql", { _: "sql", file: "sqlfile2.sql" }],
  });
  const mockedSpawn: jest.Mock<typeof spawn> = spawn as any;
  mockedSpawn.mockClear();
  mockPgClient.query.mockClear();
  await executeActions(
    parsedSettings,
    false,
    parsedSettings.afterAllMigrations,
  );
  expect(mockedSpawn).toHaveBeenCalledTimes(0);
  expect(mockPgClient.query).toHaveBeenCalledTimes(2);
  expect(mockPgClient.query).toHaveBeenNthCalledWith(1, {
    text: `[CONTENT:migrations/sqlfile1.sql]`,
  });
  expect(mockPgClient.query).toHaveBeenNthCalledWith(2, {
    text: `[CONTENT:migrations/sqlfile2.sql]`,
  });
});

it("runs command actions", async () => {
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    afterAllMigrations: [{ _: "command", command: "touch testCommandAction" }],
  });
  const mockedSpawn: jest.Mock<typeof spawn> = spawn as any;
  mockedSpawn.mockClear();
  mockedSpawn.mockImplementationOnce((_cmd, _args, _opts): any => {
    const child = new EventEmitter();

    setImmediate(() => {
      child.emit("close", 0);
    });

    return child;
  });

  mockPgClient.query.mockClear();
  const promise = executeActions(
    parsedSettings,
    false,
    parsedSettings.afterAllMigrations,
  );

  await promise;

  expect(mockPgClient.query).toHaveBeenCalledTimes(0);
  expect(mockedSpawn).toHaveBeenCalledTimes(1);
  expect(mockedSpawn.mock.calls[0][0]).toBe("touch testCommandAction");
  expect(mockedSpawn.mock.calls[0][2].env.PATH).toBe(process.env.PATH);
  expect(mockedSpawn.mock.calls[0][2].env.GM_SHADOW).toBe(undefined);
  expect(typeof mockedSpawn.mock.calls[0][2].env.GM_DBURL).toBe("string");
});

it("runs sql afterReset action with correct connection string when root", async () => {
  mockFs({
    "migrations/sqlfile1.sql": `[CONTENT:migrations/sqlfile1.sql]`,
  });
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    afterReset: [{ _: "sql", file: "sqlfile1.sql", root: true }],
  });
  const mockedWithClient: jest.Mock<typeof withClient> = withClient as any;
  mockedWithClient.mockClear();
  await executeActions(parsedSettings, false, parsedSettings.afterReset);
  expect(mockedWithClient).toHaveBeenCalledTimes(1);
  expect(mockedWithClient.mock.calls[0][0]).toBe(TEST_DATABASE_NAME);
});

it("runs command afterReset action with correct env vars when root", async () => {
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    rootConnectionString: TEST_ROOT_DATABASE_URL,
    afterReset: [
      { _: "command", command: "touch testCommandAction", root: true },
    ],
  });
  const mockedSpawn: jest.Mock<typeof spawn> = spawn as any;
  mockedSpawn.mockClear();
  mockedSpawn.mockImplementationOnce((_cmd, _args, _opts): any => {
    const child = new EventEmitter();

    setImmediate(() => {
      child.emit("close", 0);
    });

    return child;
  });

  await executeActions(parsedSettings, false, parsedSettings.afterReset);
  // When `root: true`, GM_DBUSER may be perceived as ambiguous, so we must not set it.
  expect(mockedSpawn.mock.calls[0][2].env.GM_DBUSER).toBe(undefined);
  const connectionStringParts = parse(TEST_DATABASE_URL);
  const rootConnectionStringParts = parse(TEST_ROOT_DATABASE_URL);
  expect(rootConnectionStringParts.database).not.toBe(
    connectionStringParts.database,
  );
  const execUrlParts = parse(mockedSpawn.mock.calls[0][2].env.GM_DBURL);
  expect(execUrlParts.host).toBe(rootConnectionStringParts.host);
  expect(execUrlParts.port).toBe(rootConnectionStringParts.port);
  expect(execUrlParts.user).toBe(rootConnectionStringParts.user);
  expect(execUrlParts.password).toBe(rootConnectionStringParts.password);
  expect(execUrlParts.database).toBe(connectionStringParts.database);
});

it("run normal and non-shadow actions in non-shadow mode", async () => {
  mockFs({
    "migrations/non-shadow-only.sql": `[CONTENT:migrations/non-shadow-only.sql]`,
    "migrations/shadow-only.sql": `[CONTENT:migrations/shadow-only.sql]`,
    "migrations/everywhere.sql": `[CONTENT:migrations/everywhere.sql]`,
  });
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    afterAllMigrations: [
      { _: "sql", file: "non-shadow-only.sql", shadow: false },
      { _: "sql", file: "shadow-only.sql", shadow: true },
      { _: "sql", file: "everywhere.sql" },
    ],
  });
  const mockedSpawn: jest.Mock<typeof spawn> = spawn as any;
  mockedSpawn.mockClear();
  mockPgClient.query.mockClear();
  await executeActions(
    parsedSettings,
    false,
    parsedSettings.afterAllMigrations,
  );
  expect(mockedSpawn).toHaveBeenCalledTimes(0);
  expect(mockPgClient.query).toHaveBeenCalledTimes(2);
  expect(mockPgClient.query).toHaveBeenNthCalledWith(1, {
    text: `[CONTENT:migrations/non-shadow-only.sql]`,
  });
  expect(mockPgClient.query).toHaveBeenNthCalledWith(2, {
    text: `[CONTENT:migrations/everywhere.sql]`,
  });
});

it("run normal and shadow actions in shadow mode", async () => {
  const parsedSettings = await parseSettings(
    {
      connectionString: TEST_DATABASE_URL,
      shadowConnectionString: "foo_shadow",
      afterAllMigrations: [
        { _: "sql", file: "non-shadow-only.sql", shadow: false },
        { _: "sql", file: "shadow-only.sql", shadow: true },
        { _: "sql", file: "everywhere.sql" },
      ],
    },
    true,
  );
  const mockedSpawn: jest.Mock<typeof spawn> = spawn as any;
  mockedSpawn.mockClear();
  mockPgClient.query.mockClear();
  await executeActions(parsedSettings, true, parsedSettings.afterAllMigrations);
  expect(mockedSpawn).toHaveBeenCalledTimes(0);
  expect(mockPgClient.query).toHaveBeenCalledTimes(2);
  expect(mockPgClient.query).toHaveBeenNthCalledWith(1, {
    text: `[CONTENT:migrations/shadow-only.sql]`,
  });
  expect(mockPgClient.query).toHaveBeenNthCalledWith(2, {
    text: `[CONTENT:migrations/everywhere.sql]`,
  });
});
