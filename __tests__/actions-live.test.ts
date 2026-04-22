import "./helpers"; // Has side-effects; must come first

import { Logger, LogLevel, LogMeta } from "@graphile/logger";
import mockFs from "mock-fs";

import { executeActions } from "../src/actions";
import { _migrate } from "../src/commands/migrate";
import { parseSettings } from "../src/settings";
import { mockPgClient, TEST_DATABASE_URL } from "./helpers";

beforeAll(() => {
  // eslint-disable-next-line no-console
  console.log("[mock-fs callsites hack]"); // Without this, jest fails due to 'callsites'
  mockFs({});
});

afterAll(() => {
  mockFs.restore();
});

it("logs output from command actions on success", async () => {
  const logs: Array<{
    scope: any;
    level: LogLevel;
    message: string;
    meta?: LogMeta;
  }> = [];
  const logger = new Logger((scope) => (level, message, meta) => {
    logs.push({ scope, level, message, meta });
  });
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    afterAllMigrations: [
      { _: "command", command: "echo 'success' && echo 'err' >&2" },
    ],
    logger,
  });
  mockPgClient.query.mockClear();
  await executeActions(
    parsedSettings,
    false,
    parsedSettings.afterAllMigrations,
  );
  expect(mockPgClient.query).toHaveBeenCalledTimes(0);
  expect(logs).toHaveLength(2);
  expect(logs[0]).toMatchObject({
    level: "info",
    message: "success\n",
  });
  expect(logs[1]).toMatchObject({
    level: "error",
    message: "err\n",
  });
});

it("logs output from command actions on failure", async () => {
  const logs: Array<{
    scope: any;
    level: LogLevel;
    message: string;
    meta?: LogMeta;
  }> = [];
  const logger = new Logger((scope) => (level, message, meta) => {
    logs.push({ scope, level, message, meta });
  });
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    afterAllMigrations: [
      { _: "command", command: "echo 'success' && echo 'err' >&2 && false" },
    ],
    logger,
  });
  mockPgClient.query.mockClear();
  let err;
  try {
    await executeActions(
      parsedSettings,
      false,
      parsedSettings.afterAllMigrations,
    );
  } catch (e) {
    err = e;
  }
  expect(err).toBeTruthy();
  expect(mockPgClient.query).toHaveBeenCalledTimes(0);
  expect(logs).toHaveLength(2);
  expect(logs[0]).toMatchObject({
    level: "info",
    message: "success\n",
  });
  expect(logs[1]).toMatchObject({
    level: "error",
    message: "err\n",
  });
});
