jest.mock("child_process");
import "./helpers"; // Has side-effects; must come first

import { exec } from "child_process";
import mockFs from "mock-fs";

import { current } from "../src";
import { withClient } from "../src/pg";
import { ParsedSettings, parseSettings, Settings } from "../src/settings";
import { makeMigrations, resetDb, settings } from "./helpers";

beforeEach(resetDb);
beforeEach(async () => {
  mockFs({ migrations: mockFs.directory() });
});
afterEach(() => {
  mockFs.restore();
});
const {
  MIGRATION_1_COMMITTED,
  MIGRATION_ENUM_COMMITTED,
  MIGRATION_NOTRX_TEXT,
  MIGRATION_NOTRX_COMMITTED,
} = makeMigrations();

function getStuff(parsedSettings: ParsedSettings) {
  return withClient(
    parsedSettings.connectionString,
    parsedSettings,
    async (pgClient, _context) => {
      const { rows: migrations } = await pgClient.query(
        "select * from graphile_migrate.migrations",
      );
      const { rows: tables } = await pgClient.query(
        "select * from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
      );
      const { rows: enums } = await pgClient.query(
        "select typname, (select count(*) from pg_enum where enumtypid = pg_type.oid) as value_count from pg_type where typnamespace = 'public'::regnamespace and typtype = 'e'",
      );
      return { migrations, tables, enums };
    },
  );
}

it("runs migrations", async () => {
  mockFs({
    "migrations/current.sql": "",
  });

  await current(settings);
  const parsedSettings = await parseSettings(settings);

  {
    const { migrations, tables, enums } = await getStuff(parsedSettings);
    expect(migrations).toHaveLength(0);
    expect(tables).toHaveLength(0);
    expect(enums).toHaveLength(0);
  }

  mockFs({
    [`migrations/committed/000001.sql`]: MIGRATION_1_COMMITTED,
    [`migrations/committed/000002.sql`]: MIGRATION_ENUM_COMMITTED, // Creates enum with 1 value
    "migrations/current.sql": MIGRATION_NOTRX_TEXT, // Adds a value to the enum - total = 2
  });

  await current(settings);

  const { migrations, tables, enums } = await getStuff(parsedSettings);

  expect(migrations).toHaveLength(2);
  expect(migrations.map(({ date, ...rest }) => rest)).toMatchInlineSnapshot(`
    [
      {
        "filename": "000001.sql",
        "hash": "sha1:e00ec93314a423ee5cc68d1182ad52f16442d7df",
        "previous_hash": null,
      },
      {
        "filename": "000002.sql",
        "hash": "sha1:bddc1ead3310dc1c42cdc7f63537ebdff2e9fd7b",
        "previous_hash": "sha1:e00ec93314a423ee5cc68d1182ad52f16442d7df",
      },
    ]
  `);
  expect(tables).toHaveLength(1);
  expect(tables.map((t) => t.relname)).toMatchInlineSnapshot(`
    [
      "foo",
    ]
  `);
  expect(enums).toHaveLength(1);
  expect(enums).toMatchInlineSnapshot(`
    [
      {
        "typname": "user_role",
        "value_count": "2",
      },
    ]
  `);

  mockFs({
    [`migrations/committed/000001.sql`]: MIGRATION_1_COMMITTED,
    [`migrations/committed/000002.sql`]: MIGRATION_ENUM_COMMITTED,
    [`migrations/committed/000003.sql`]: MIGRATION_NOTRX_COMMITTED,
    "migrations/current.sql": "",
  });

  await current(settings);

  const {
    migrations: newMigrations,
    tables: newTables,
    enums: newEnums,
  } = await getStuff(parsedSettings);

  expect(newMigrations).toHaveLength(3);
  expect(newMigrations.map(({ date, ...rest }) => rest)).toMatchInlineSnapshot(`
    [
      {
        "filename": "000001.sql",
        "hash": "sha1:e00ec93314a423ee5cc68d1182ad52f16442d7df",
        "previous_hash": null,
      },
      {
        "filename": "000002.sql",
        "hash": "sha1:bddc1ead3310dc1c42cdc7f63537ebdff2e9fd7b",
        "previous_hash": "sha1:e00ec93314a423ee5cc68d1182ad52f16442d7df",
      },
      {
        "filename": "000003.sql",
        "hash": "sha1:2d248344ac299ebbad2aeba5bfec2ae3c3cb0a4f",
        "previous_hash": "sha1:bddc1ead3310dc1c42cdc7f63537ebdff2e9fd7b",
      },
    ]
  `);
  expect(newTables).toEqual(tables);
  expect(newEnums).toEqual(enums);
});

it("runs actions when forceActions is set", async () => {
  const ACTIONS = {
    initial: {
      forceActions: false,
      currentSql: "",
      expectedActions: [
        "beforeAllMigrations",
        "afterAllMigrations",
        "beforeCurrent",
        "afterCurrent",
      ],
    },
    currentChange: {
      forceActions: false,
      currentSql: MIGRATION_NOTRX_TEXT,
      expectedActions: ["beforeCurrent", "afterCurrent"],
    },
    noop: {
      forceActions: false,
      currentSql: MIGRATION_NOTRX_TEXT,
      expectedActions: [],
    },
    forceActions: {
      forceActions: true,
      currentSql: MIGRATION_NOTRX_TEXT,
      expectedActions: [
        "beforeAllMigrations",
        "afterAllMigrations",
        "beforeCurrent",
        "afterCurrent",
      ],
    },
  } as const;
  const settingsWithHooks: Settings = {
    ...settings,
    beforeAllMigrations: [
      { _: "command", command: "echo did_beforeAllMigrations" },
    ],
    afterAllMigrations: [
      { _: "command", command: "echo did_afterAllMigrations" },
    ],
    beforeCurrent: [{ _: "command", command: "echo did_beforeCurrent" }],
    afterCurrent: [{ _: "command", command: "echo did_afterCurrent" }],
  };
  for (const mode of Object.keys(ACTIONS) as Array<keyof typeof ACTIONS>) {
    const { forceActions, currentSql, expectedActions } = ACTIONS[mode];

    mockFs({
      [`migrations/committed/000001.sql`]: MIGRATION_1_COMMITTED,
      [`migrations/committed/000002.sql`]: MIGRATION_ENUM_COMMITTED, // Creates enum with 1 value
      "migrations/current.sql": currentSql,
    });

    const mockedExec: jest.Mock<typeof exec> = exec as any;
    mockedExec.mockClear();
    mockedExec.mockImplementation((_cmd, _options, callback) =>
      callback(null, { stdout: "", stderr: "" }),
    );
    await current(settingsWithHooks, { forceActions });
    const calledActions = mockedExec.mock.calls.map((c) =>
      c[0].substring("echo did_".length),
    );
    expect(calledActions).toEqual(expectedActions);
  }
});
