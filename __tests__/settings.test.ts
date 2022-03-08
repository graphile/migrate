import "./helpers"; // Side effects - must come first

import * as mockFs from "mock-fs";
import * as path from "path";

import { DEFAULT_GMRC_PATH, getSettings } from "../src/commands/_common";
import {
  makeRootDatabaseConnectionString,
  ParsedSettings,
  parseSettings,
} from "../src/settings";

function sanitise(parsedSettings: ParsedSettings) {
  parsedSettings.migrationsFolder =
    "./" + path.relative(process.cwd(), parsedSettings.migrationsFolder);
}

const exampleConnectionString = "postgres://localhost:5432/dbname?ssl=true";
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

it("throws error if connection string is the same as root connection string", async () => {
  await expect(
    parseSettings(
      {
        connectionString: exampleConnectionString,
        rootConnectionString: exampleConnectionString,
        shadowConnectionString: "notthesamestring",
      },
      true,
    ),
  ).rejects.toMatchInlineSnapshot(`
          [Error: Errors occurred during settings validation:
          - connectionString cannot be the same value as rootConnectionString or shadowConnectionString.]
    `);
});

it("throws error if connection string is the same as shadow connection string", async () => {
  await expect(
    parseSettings(
      {
        connectionString: exampleConnectionString,
        rootConnectionString: "notthesamestring",
        shadowConnectionString: exampleConnectionString,
      },
      true,
    ),
  ).rejects.toMatchInlineSnapshot(`
          [Error: Errors occurred during settings validation:
          - connectionString cannot be the same value as rootConnectionString or shadowConnectionString.]
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

it.each([[[]], [{}], ["test"]])(
  "throws error for invalid logger",
  async invalidLogger => {
    await expect(
      parseSettings({
        connectionString: exampleConnectionString,
        rootConnectionString: "notthesamestring1",
        shadowConnectionString: "notthesamestring2",
        logger: invalidLogger as any,
      }),
    ).rejects.toMatchInlineSnapshot(`
          [Error: Errors occurred during settings validation:
          - Setting 'logger': Expected 'logger' to be a @graphile/logger Logger instance]
        `);
  },
);

describe("makeRootDatabaseConnectionString", () => {
  it("modifies the database name", async () => {
    const parsedSettings = await parseSettings({
      connectionString: exampleConnectionString,
      rootConnectionString:
        "postgres://root:pass@localhost:5432/dbname?ssl=true",
    });
    const connectionString = makeRootDatabaseConnectionString(
      parsedSettings,
      "modified",
    );
    expect(connectionString).toBe(
      "postgres://root:pass@localhost:5432/modified?ssl=true",
    );
  });

  it("handles socket URLs", async () => {
    const parsedSettings = await parseSettings({
      connectionString: exampleConnectionString,
      rootConnectionString: "socket:/var/run/pgsql",
    });
    const connectionString = makeRootDatabaseConnectionString(
      parsedSettings,
      "modified",
    );
    expect(connectionString).toBe("socket:/var/run/pgsql?db=modified");
  });

  it("handles socket URLs with auth", async () => {
    const parsedSettings = await parseSettings({
      connectionString: exampleConnectionString,
      rootConnectionString: "socket://user:pass@/var/run/pgsql",
    });
    const connectionString = makeRootDatabaseConnectionString(
      parsedSettings,
      "modified",
    );
    expect(connectionString).toBe(
      "socket://user:pass@/var/run/pgsql?db=modified",
    );
  });

  it("handles socket URLs with existing database", async () => {
    const parsedSettings = await parseSettings({
      connectionString: exampleConnectionString,
      rootConnectionString: "socket://user:pass@/var/run/pgsql?db=dbname",
    });
    const connectionString = makeRootDatabaseConnectionString(
      parsedSettings,
      "modified",
    );
    expect(connectionString).toBe(
      "socket://user:pass@/var/run/pgsql?db=modified",
    );
  });

  it("handles socket URLs with existing encoding", async () => {
    const parsedSettings = await parseSettings({
      connectionString: exampleConnectionString,
      rootConnectionString: "socket://user:pass@/var/run/pgsql?encoding=utf8",
    });
    const connectionString = makeRootDatabaseConnectionString(
      parsedSettings,
      "modified",
    );
    expect(connectionString).toBe(
      "socket://user:pass@/var/run/pgsql?encoding=utf8&db=modified",
    );
  });

  it("preserves complex arguments", async () => {
    mockFs.restore();
    const parsedSettings = await parseSettings({
      connectionString: exampleConnectionString,
      rootConnectionString:
        "postgres://root:pass@localhost:5432/dbname?ssl=true&sslrootcert=./__tests__/data/amazon-rds-ca-cert.pem",
    });
    const connectionString = makeRootDatabaseConnectionString(
      parsedSettings,
      "modified",
    );
    expect(connectionString).toBe(
      "postgres://root:pass@localhost:5432/modified?ssl=true&sslrootcert=./__tests__/data/amazon-rds-ca-cert.pem",
    );
  });

  it("handles a standalone DB name that is not a valid URL", async () => {
    mockFs.restore();
    const parsedSettings = await parseSettings({
      connectionString: exampleConnectionString,
      rootConnectionString: "just_a_db",
    });
    const connectionString = makeRootDatabaseConnectionString(
      parsedSettings,
      "modified",
    );
    expect(connectionString).toBe("modified");
  });
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

describe("gmrc path", () => {
  it("defaults to .gmrc", async () => {
    mockFs.restore();
    mockFs({
      [DEFAULT_GMRC_PATH]: `
        { "connectionString": "postgres://appuser:apppassword@host:5432/defaultdb" }
      `,
    });
    const settings = await getSettings();
    expect(settings.connectionString).toEqual(
      "postgres://appuser:apppassword@host:5432/defaultdb",
    );
    mockFs.restore();
  });

  it("accepts an override and follows it", async () => {
    mockFs.restore();
    mockFs({
      [DEFAULT_GMRC_PATH]: `
        { "connectionString": "postgres://appuser:apppassword@host:5432/defaultdb" }
      `,
      ".other-gmrc": `
        { "connectionString": "postgres://appuser:apppassword@host:5432/otherdb" }
      `,
    });
    const settings = await getSettings({ configFile: ".other-gmrc" });
    expect(settings.connectionString).toEqual(
      "postgres://appuser:apppassword@host:5432/otherdb",
    );
    mockFs.restore();
  });
});
