import "./helpers"; // Has side-effects; must come first

import mockFs from "mock-fs";

import { migrate } from "../src";
import { withClient } from "../src/pg";
import { ParsedSettings, parseSettings } from "../src/settings";
import { makeMigrations, resetDb, settings } from "./helpers";

beforeEach(resetDb);
beforeEach(async () => {
  mockFs({ migrations: mockFs.directory() });
});
afterEach(() => {
  mockFs.restore();
});
const {
  MIGRATION_1_TEXT,
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
    "migrations/current.sql": MIGRATION_1_TEXT,
  });

  await migrate(settings);

  const parsedSettings = await parseSettings(settings);

  {
    const { migrations, tables, enums } = await getStuff(parsedSettings);
    expect(migrations).toHaveLength(0);
    expect(tables).toHaveLength(0);
    expect(enums).toHaveLength(0);
  }

  mockFs({
    [`migrations/committed/000001.sql`]: MIGRATION_1_COMMITTED,
    [`migrations/committed/000002.sql`]: MIGRATION_ENUM_COMMITTED,
    "migrations/current.sql": MIGRATION_NOTRX_TEXT,
  });

  await migrate(settings);

  {
    const { migrations, tables, enums } = await getStuff(parsedSettings);

    expect(migrations).toHaveLength(2);
    expect(migrations.map(({ date, ...rest }) => rest)).toMatchSnapshot();
    expect(tables).toHaveLength(1);
    expect(tables.map((t) => t.relname)).toMatchSnapshot();
    expect(enums).toHaveLength(1);
    expect(enums).toMatchSnapshot();
  }

  mockFs({
    [`migrations/committed/000001.sql`]: MIGRATION_1_COMMITTED,
    [`migrations/committed/000002.sql`]: MIGRATION_ENUM_COMMITTED,
    [`migrations/committed/000003.sql`]: MIGRATION_NOTRX_COMMITTED,
    "migrations/current.sql": "",
  });

  await migrate(settings);

  {
    const { migrations, tables, enums } = await getStuff(parsedSettings);

    expect(migrations).toHaveLength(3);
    const mappedMigrations = migrations.map(({ date, ...rest }) => rest);
    expect(mappedMigrations).toMatchSnapshot();
    expect(tables).toHaveLength(1);
    const mappedTables = tables.map((t) => t.relname);
    expect(mappedTables).toMatchSnapshot();
    expect(enums).toHaveLength(1);
    expect(enums).toMatchSnapshot();
  }
});

it("refuses to run migration with invalid hash", async () => {
  mockFs({
    [`migrations/committed/000001.sql`]: MIGRATION_1_COMMITTED,
    [`migrations/committed/000002.sql`]:
      MIGRATION_ENUM_COMMITTED +
      "\ncomment on type user_role is 'this invalidates the hash';",
    [`migrations/committed/000003.sql`]: MIGRATION_NOTRX_COMMITTED,
    "migrations/current.sql": "",
  });

  await expect(migrate(settings)).rejects.toThrowErrorMatchingSnapshot();
});

it("will run a migration with invalid hash if told to do so", async () => {
  const parsedSettings = await parseSettings(settings);

  mockFs({
    [`migrations/committed/000001.sql`]: MIGRATION_1_COMMITTED,
    [`migrations/committed/000002.sql`]:
      "--! AllowInvalidHash\n" +
      MIGRATION_ENUM_COMMITTED +
      "\ncomment on type user_role is 'this invalidates the hash';",
    [`migrations/committed/000003.sql`]: MIGRATION_NOTRX_COMMITTED,
    "migrations/current.sql": "",
  });

  await migrate(settings);

  {
    const { migrations, enums } = await getStuff(parsedSettings);

    expect(migrations).toHaveLength(3);
    const mappedMigrations = migrations.map(({ date, ...rest }) => rest);
    expect(mappedMigrations).toMatchSnapshot();
    expect(enums).toHaveLength(1);
    expect(enums).toMatchSnapshot();
  }
});
