import { parseSettings, ParsedSettings } from "../src/settings";
import * as path from "path";

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
          - Setting 'connectionString': Expected a string, or for DATABASE_URL envvar to be set]
        `);
});

it("throws if shadow attempted but no shadow DB", async () => {
  await expect(
    parseSettings(
      {
        connectionString: exampleConnectionString,
      },
      true
    )
  ).rejects.toMatchInlineSnapshot(`
          [Error: Errors occurred during settings validation:
          - Setting 'shadowConnectionString': Expected a string, or for TEST_DATABASE_URL to be set
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
    expect(parsedSettings).toMatchInlineSnapshot(`
      Object {
        "afterAllMigrations": Array [
          Object {
            "_": "sql",
            "file": "bar.sql",
          },
          Object {
            "_": "sql",
            "file": "baz.sql",
          },
        ],
        "afterReset": Array [
          Object {
            "_": "sql",
            "file": "foo.sql",
          },
        ],
        "connectionString": "postgres://localhost:5432/dbname?ssl=1",
        "databaseName": "dbname",
        "databaseOwner": "dbname",
        "migrationsFolder": "./migrations",
        "placeholders": undefined,
        "rootConnectionString": "template1",
        "shadowConnectionString": undefined,
        "shadowDatabaseName": undefined,
      }
    `);
  });
});
