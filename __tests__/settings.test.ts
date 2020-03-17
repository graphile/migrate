import "./helpers"; // Side effects - must come first

import * as mockFs from "mock-fs";
import * as path from "path";

import { ParsedSettings, parseSettings } from "../src/settings";

function sanitise(parsedSettings: ParsedSettings) {
  parsedSettings.migrationsFolder =
    "./" + path.relative(process.cwd(), parsedSettings.migrationsFolder);
}

const exampleConnectionString = "postgres://localhost:5432/dbname?ssl=1";
it("parses basic config", async () => {
  await parseSettings({
    connectionString: exampleConnectionString,
  });
});

it("throws error for missing connection string", async () => {
  await expect(parseSettings({})).rejects.toMatchInlineSnapshot(`
          [Error: Errors occurred during settings validation:
          - Setting 'connectionString': Expected a string, or for DATABASE_URL envvar to be set
          - Setting 'databaseOwner': Expected a string or for user or database name to be specified in connectionString]
        `);
});

it("throws if shadow attempted but no shadow DB", async () => {
  await expect(
    parseSettings(
      {
        connectionString: exampleConnectionString,
      },
      true,
    ),
  ).rejects.toMatchInlineSnapshot(`
          [Error: Errors occurred during settings validation:
          - Setting 'shadowConnectionString': Expected \`shadowConnectionString\` to be a string, or for SHADOW_DATABASE_URL to be set
          - Could not determine the shadow database name, please ensure shadowConnectionString includes the database name.]
        `);
});

describe("actions", () => {
  it("parses string values into SQL actions", async () => {
    const parsedSettings = await parseSettings({
      connectionString: exampleConnectionString,
      afterReset: "foo.sql",
      afterAllMigrations: ["bar.sql", "baz.sql"],
    });
    expect(parsedSettings.afterReset).toEqual([{ _: "sql", file: "foo.sql" }]);
    expect(parsedSettings.afterAllMigrations).toEqual([
      { _: "sql", file: "bar.sql" },
      { _: "sql", file: "baz.sql" },
    ]);
    sanitise(parsedSettings);
    mockFs.restore();
    expect(parsedSettings).toMatchSnapshot();
  });

  it("parses SQL actions", async () => {
    const parsedSettings = await parseSettings({
      connectionString: exampleConnectionString,
      afterReset: "foo.sql",
      afterAllMigrations: [
        { _: "sql", file: "bar.sql" },
        { _: "sql", file: "baz.sql" },
      ],
    });
    expect(parsedSettings.afterReset).toEqual([{ _: "sql", file: "foo.sql" }]);
    expect(parsedSettings.afterAllMigrations).toEqual([
      { _: "sql", file: "bar.sql" },
      { _: "sql", file: "baz.sql" },
    ]);
    sanitise(parsedSettings);
    mockFs.restore();
    expect(parsedSettings).toMatchSnapshot();
  });

  it("parses command actions", async () => {
    const parsedSettings = await parseSettings({
      connectionString: exampleConnectionString,
      afterAllMigrations: [
        { _: "command", command: "pg_dump --schema-only" },
        { _: "command", command: "graphile-worker --once" },
      ],
    });
    expect(parsedSettings.afterReset).toEqual([]);
    expect(parsedSettings.afterAllMigrations).toEqual([
      { _: "command", command: "pg_dump --schema-only" },
      { _: "command", command: "graphile-worker --once" },
    ]);
    sanitise(parsedSettings);
    mockFs.restore();
    expect(parsedSettings).toMatchSnapshot();
  });

  it("parses mixed actions", async () => {
    const parsedSettings = await parseSettings({
      connectionString: exampleConnectionString,
      afterAllMigrations: [
        "foo.sql",
        { _: "sql", file: "bar.sql" },
        { _: "command", command: "pg_dump --schema-only" },
        { _: "command", command: "graphile-worker --once" },
      ],
    });
    expect(parsedSettings.afterReset).toEqual([]);
    expect(parsedSettings.afterAllMigrations).toEqual([
      { _: "sql", file: "foo.sql" },
      { _: "sql", file: "bar.sql" },
      { _: "command", command: "pg_dump --schema-only" },
      { _: "command", command: "graphile-worker --once" },
    ]);
    sanitise(parsedSettings);
    mockFs.restore();
    expect(parsedSettings).toMatchSnapshot();
  });

  it("is backwards-compatible with untagged command specs", async () => {
    const parsedSettings = await parseSettings({
      connectionString: exampleConnectionString,
      afterAllMigrations: [
        "foo.sql",
        { _: "sql", file: "bar.sql" },
        { command: "pg_dump --schema-only" } as any,
        { _: "command", command: "graphile-worker --once" },
      ],
    });
    expect(parsedSettings.afterReset).toEqual([]);
    expect(parsedSettings.afterAllMigrations).toEqual([
      { _: "sql", file: "foo.sql" },
      { _: "sql", file: "bar.sql" },
      { _: "command", command: "pg_dump --schema-only" },
      { _: "command", command: "graphile-worker --once" },
    ]);
    sanitise(parsedSettings);
    mockFs.restore();
    expect(parsedSettings).toMatchSnapshot();
  });

  it("throws on unknown action type", async () => {
    await expect(
      parseSettings({
        connectionString: exampleConnectionString,
        afterAllMigrations: [
          "foo.sql",
          { _: "sql", file: "bar.sql" },
          { _: "unknown_value", command: "pg_dump --schema-only" } as any,
          { _: "command", command: "graphile-worker --once" },
        ],
      }),
    ).rejects.toMatchInlineSnapshot(`
            [Error: Errors occurred during settings validation:
            - Setting 'afterAllMigrations': Action spec of type 'unknown_value' not supported; perhaps you need to upgrade?]
          `);
  });
});
