jest.mock("child_process");
jest.mock("../src/pg");
jest.mock("../src/migration");

import * as mockFs from "mock-fs";
import { parseSettings } from "../src/settings";
import { _migrate } from "../src/commands/migrate";
import { executeActions } from "../src/actions";
import { mockPgClient, TEST_DATABASE_URL } from "./helpers";
import { exec } from "child_process";

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
  const mockedExec: jest.Mock<typeof exec> = exec as any;
  mockedExec.mockClear();
  mockPgClient.query.mockClear();
  await executeActions(
    parsedSettings,
    false,
    parsedSettings.afterAllMigrations
  );
  expect(mockedExec).toHaveBeenCalledTimes(0);
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
  const mockedExec: jest.Mock<typeof exec> = exec as any;
  mockedExec.mockClear();
  mockedExec.mockImplementationOnce((_cmd, _options, callback) =>
    callback(null, { stdout: "", stderr: "" })
  );

  mockPgClient.query.mockClear();
  await executeActions(
    parsedSettings,
    false,
    parsedSettings.afterAllMigrations
  );
  expect(mockPgClient.query).toHaveBeenCalledTimes(0);
  expect(mockedExec).toHaveBeenCalledTimes(1);
  expect(mockedExec.mock.calls[0][0]).toBe("touch testCommandAction");
  expect(mockedExec.mock.calls[0][1].env.PATH).toBe(process.env.PATH);
  expect(mockedExec.mock.calls[0][1].env.GM_SHADOW).toBe(undefined);
  expect(typeof mockedExec.mock.calls[0][1].env.GM_DBURL).toBe("string");
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
  const mockedExec: jest.Mock<typeof exec> = exec as any;
  mockedExec.mockClear();
  mockPgClient.query.mockClear();
  await executeActions(
    parsedSettings,
    false,
    parsedSettings.afterAllMigrations
  );
  expect(mockedExec).toHaveBeenCalledTimes(0);
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
    true
  );
  const mockedExec: jest.Mock<typeof exec> = exec as any;
  mockedExec.mockClear();
  mockPgClient.query.mockClear();
  await executeActions(parsedSettings, true, parsedSettings.afterAllMigrations);
  expect(mockedExec).toHaveBeenCalledTimes(0);
  expect(mockPgClient.query).toHaveBeenCalledTimes(2);
  expect(mockPgClient.query).toHaveBeenNthCalledWith(1, {
    text: `[CONTENT:migrations/shadow-only.sql]`,
  });
  expect(mockPgClient.query).toHaveBeenNthCalledWith(2, {
    text: `[CONTENT:migrations/everywhere.sql]`,
  });
});
