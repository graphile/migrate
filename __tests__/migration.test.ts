jest.mock("child_process");
jest.mock("../src/pg");
jest.mock("../src/migration");

import "./helpers"; // Has side-effects; must come first

import { _migrate } from "../src/commands/migrate";
import {
  FileMigration,
  generatePlaceholderReplacement,
  getMigrationsAfter,
} from "../src/migration";
import { Context } from "../src/pg";
import { parseSettings } from "../src/settings";
import {
  makeActionSpies,
  TEST_DATABASE_NAME,
  TEST_DATABASE_URL,
} from "./helpers";

it("doesn't mind about placeholder order", async () => {
  const context: Context = {
    database: TEST_DATABASE_NAME,
  };
  const parsedSettings = await parseSettings({
    connectionString: "[connectionString]",
    rootConnectionString: "[rootConnectionString]",

    placeholders: {
      ":DATABASE_AUTHENTICATOR": "[DATABASE_AUTHENTICATOR]",
      ":DATABASE_AUTHENTICATOR_PASSWORD": "[DATABASE_AUTHENTICATOR_PASSWORD]",
    },
    beforeReset: [],
    beforeAllMigrations: [],
    beforeCurrent: [],
    afterReset: [],
    afterAllMigrations: [],
    afterCurrent: [],
  });
  const placeholderReplacement = generatePlaceholderReplacement(
    parsedSettings,
    context,
  );
  const body = placeholderReplacement(
    `CREATE ROLE :DATABASE_AUTHENTICATOR WITH LOGIN PASSWORD ':DATABASE_AUTHENTICATOR_PASSWORD';`,
  );

  expect(body).toEqual(
    `CREATE ROLE [DATABASE_AUTHENTICATOR] WITH LOGIN PASSWORD '[DATABASE_AUTHENTICATOR_PASSWORD]';`,
  );
});

it("calls no actions if no migrations", async () => {
  const { settings, getActionCalls } = makeActionSpies();
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_NAME,
    ...settings,
  });
  await _migrate(parsedSettings, false, false);
  expect(getActionCalls()).toEqual([]);
});

it("calls afterAllMigrations action (only) if force is true", async () => {
  const { settings, getActionCalls } = makeActionSpies();
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    ...settings,
  });
  await _migrate(parsedSettings, false, true);
  expect(getActionCalls()).toEqual([
    "beforeAllMigrations",
    "afterAllMigrations",
  ]);
});

it("calls beforeAllMigrations and afterAllMigrations action (only) if we did some migrations", async () => {
  (getMigrationsAfter as any).mockImplementationOnce(
    async (): Promise<FileMigration[]> => {
      return [
        {
          filename: "000001.sql",
          realFilename: "000001-test-message.sql",
          hash: "TEST_HASH",
          previousHash: null,
          body: "TEST_BODY",
          fullPath: "TEST_PATH",
          previous: null,
          message: "TEST MESSAGE",
          messageSlug: "test-message",
          allowInvalidHash: false,
        },
      ];
    },
  );
  const { settings, getActionCalls } = makeActionSpies();
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    ...settings,
  });
  await _migrate(parsedSettings, false, false);
  expect(getActionCalls()).toEqual([
    "beforeAllMigrations",
    "afterAllMigrations",
  ]);
});
