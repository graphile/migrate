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
    expect(migrations.map(({ date, ...rest }) => rest)).toMatchInlineSnapshot(`
      Array [
        Object {
          "filename": "000001.sql",
          "hash": "sha1:e00ec93314a423ee5cc68d1182ad52f16442d7df",
          "previous_hash": null,
        },
        Object {
          "filename": "000002.sql",
          "hash": "sha1:bddc1ead3310dc1c42cdc7f63537ebdff2e9fd7b",
          "previous_hash": "sha1:e00ec93314a423ee5cc68d1182ad52f16442d7df",
        },
      ]
    `);
    expect(tables).toHaveLength(1);
    expect(tables.map((t) => t.relname)).toMatchInlineSnapshot(`
      Array [
        "foo",
      ]
    `);
    expect(enums).toHaveLength(1);
    expect(enums).toMatchInlineSnapshot(`
Array [
  Object {
    "typname": "user_role",
    "value_count": "1",
  },
]
`);
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
    expect(migrations.map(({ date, ...rest }) => rest)).toMatchInlineSnapshot(`
      Array [
        Object {
          "filename": "000001.sql",
          "hash": "sha1:e00ec93314a423ee5cc68d1182ad52f16442d7df",
          "previous_hash": null,
        },
        Object {
          "filename": "000002.sql",
          "hash": "sha1:bddc1ead3310dc1c42cdc7f63537ebdff2e9fd7b",
          "previous_hash": "sha1:e00ec93314a423ee5cc68d1182ad52f16442d7df",
        },
        Object {
          "filename": "000003.sql",
          "hash": "sha1:2d248344ac299ebbad2aeba5bfec2ae3c3cb0a4f",
          "previous_hash": "sha1:bddc1ead3310dc1c42cdc7f63537ebdff2e9fd7b",
        },
      ]
    `);
    expect(tables).toHaveLength(1);
    expect(tables.map((t) => t.relname)).toMatchInlineSnapshot(`
      Array [
        "foo",
      ]
    `);
    expect(enums).toHaveLength(1);
    expect(enums).toMatchInlineSnapshot(`
Array [
  Object {
    "typname": "user_role",
    "value_count": "2",
  },
]
`);
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

  await expect(migrate(settings)).rejects.toThrowErrorMatchingInlineSnapshot(
    `"Hash for 000002.sql does not match - sha1:cbed240dda7dfa510ff785783bbe6af7743b3a11 !== sha1:bddc1ead3310dc1c42cdc7f63537ebdff2e9fd7b; has the file been tampered with?"`,
  );
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
    expect(migrations.map(({ date, ...rest }) => rest)).toMatchInlineSnapshot(`
Array [
  Object {
    "filename": "000001.sql",
    "hash": "sha1:e00ec93314a423ee5cc68d1182ad52f16442d7df",
    "previous_hash": null,
  },
  Object {
    "filename": "000002.sql",
    "hash": "sha1:bddc1ead3310dc1c42cdc7f63537ebdff2e9fd7b",
    "previous_hash": "sha1:e00ec93314a423ee5cc68d1182ad52f16442d7df",
  },
  Object {
    "filename": "000003.sql",
    "hash": "sha1:2d248344ac299ebbad2aeba5bfec2ae3c3cb0a4f",
    "previous_hash": "sha1:bddc1ead3310dc1c42cdc7f63537ebdff2e9fd7b",
  },
]
`);
    expect(enums).toHaveLength(1);
    expect(enums).toMatchInlineSnapshot(`
Array [
  Object {
    "typname": "user_role",
    "value_count": "2",
  },
]
`);
  }
});
