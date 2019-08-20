jest.mock("child_process");
jest.mock("../src/pg");
jest.mock("../src/migration");

import { parseSettings } from "../src/settings";
import { Context } from "../src/pg";
import {
  generatePlaceholderReplacement,
  getMigrationsAfter,
  FileMigration,
} from "../src/migration";
import { _migrate } from "../src/commands/migrate";
import { makeActionSpies } from "./helpers";

it("doesn't mind about placeholder order", async () => {
  const context: Context = {
    database: "foo",
  };
  const parsedSettings = await parseSettings({
    connectionString: "[connectionString]",
    rootConnectionString: "[rootConnectionString]",

    placeholders: {
      ":DATABASE_AUTHENTICATOR": "[DATABASE_AUTHENTICATOR]",
      ":DATABASE_AUTHENTICATOR_PASSWORD": "[DATABASE_AUTHENTICATOR_PASSWORD]",
    },
    afterReset: [],
    afterAllMigrations: [],
    afterCurrent: [],
  });
  const placeholderReplacement = generatePlaceholderReplacement(
    parsedSettings,
    context
  );
  const body = placeholderReplacement(
    `CREATE ROLE :DATABASE_AUTHENTICATOR WITH LOGIN PASSWORD ':DATABASE_AUTHENTICATOR_PASSWORD';`
  );

  expect(body).toEqual(
    `CREATE ROLE [DATABASE_AUTHENTICATOR] WITH LOGIN PASSWORD '[DATABASE_AUTHENTICATOR_PASSWORD]';`
  );
});

it("calls no actions if no migrations", async () => {
  const { settings, getActionCalls } = makeActionSpies();
  const parsedSettings = await parseSettings({
    connectionString: "foo",
    ...settings,
  });
  await _migrate(parsedSettings, false, false);
  expect(getActionCalls()).toEqual([]);
});

it("calls afterAllMigrations action (only) if force is true", async () => {
  const { settings, getActionCalls } = makeActionSpies();
  const parsedSettings = await parseSettings({
    connectionString: "foo",
    ...settings,
  });
  await _migrate(parsedSettings, false, true);
  expect(getActionCalls()).toEqual(["afterAllMigrations"]);
});

it("calls afterAllMigrations action (only) if we did some migrations", async () => {
  (getMigrationsAfter as any).mockImplementationOnce(
    async (): Promise<FileMigration[]> => {
      return [
        {
          filename: "TEST_FILENAME",
          hash: "TEST_HASH",
          previousHash: null,
          body: "TEST_BODY",
          fullPath: "TEST_PATH",
          previous: null,
        },
      ];
    }
  );
  const { settings, getActionCalls } = makeActionSpies();
  const parsedSettings = await parseSettings({
    connectionString: "foo",
    ...settings,
  });
  await _migrate(parsedSettings, false, false);
  expect(getActionCalls()).toEqual(["afterAllMigrations"]);
});
