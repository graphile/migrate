jest.mock("child_process");
jest.mock("../src/pg");
jest.mock("../src/migration");

import { exec } from "child_process";
import { parseSettings, Settings } from "../src/settings";
import { Context } from "../src/pg";
import {
  generatePlaceholderReplacement,
  getMigrationsAfter,
  FileMigration,
} from "../src/migration";
import { _migrate } from "../src/commands/migrate";

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

interface ActionSpies {
  getActionCalls: () => string[];
  settings: Pick<
    Settings,
    "afterAllMigrations" | "afterReset" | "afterCurrent"
  >;
}
function makeActionSpies(shadow = false): ActionSpies {
  const mockedExec = (exec as unknown) as jest.Mock<typeof exec>;
  mockedExec.mockReset();
  const calls: string[] = [];
  mockedExec.mockImplementation(
    (_cmd, _opts, cb): any => {
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
    }
  );
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
