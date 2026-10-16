import "./helpers"; // Has side-effects; must come first

import { promises as fsp } from "fs";
import mockFs from "mock-fs";

import { commit, current, status, uncommit } from "../src";
import {
  getCurrentMigrationLocation,
  readCurrentMigration,
} from "../src/current";
import { calculateHash } from "../src/hash";
import { isNoTransactionDefined } from "../src/header";
import * as migration from "../src/migration";
import {
  compileIncludes,
  parseMigrationText,
  serializeMigration,
} from "../src/migration";
import { withClient } from "../src/pg";
import { parseSettings } from "../src/settings";
import { resetDb, settings } from "./helpers";

beforeEach(() => {
  mockFs({
    "migrations/current.sql": "-- current\n",
    "migrations/fixtures/auto/example.sql": "select '--literal'; -- comment\n",
  });
});
afterEach(() => mockFs.restore());

/** Write a committed migration that includes `paths`, as an earlier commit would have. */
async function recordCommit(
  paths = ["auto/example.sql"],
  number = 1,
  previous: string | null = null,
) {
  const parsed = await parseSettings(settings);
  const body = await compileIncludes(
    parsed,
    paths.map((path) => `--!include ${path}`).join("\n"),
    new Set(),
  );
  const hash = calculateHash(body, previous);
  await fsp.mkdir("migrations/committed", { recursive: true });
  await fsp.writeFile(
    `migrations/committed/${String(number).padStart(6, "0")}.sql`,
    serializeMigration(body, { Previous: previous || "-", Hash: hash }),
  );
  return hash;
}

/** Read the current migration, listing the fixtures it includes automatically. */
async function read() {
  const parsed = await parseSettings(settings);
  const location = await getCurrentMigrationLocation(parsed);
  const { raw, compiled } = await readCurrentMigration(parsed, location);
  const end = compiled.indexOf("--!endAuto");
  const auto =
    end < 0
      ? []
      : [...compiled.slice(0, end).matchAll(/^--! Included (.+)$/gm)].map(
          (match) => match[1],
        );
  return { raw, compiled, auto };
}

async function useCurrentDirectory(content = "-- current\n") {
  await fsp.rm("migrations/current.sql");
  await fsp.mkdir("migrations/current");
  await fsp.writeFile("migrations/current/001.sql", content);
}

it("does nothing, without reading history, if there is no fixtures/auto", async () => {
  await fsp.rename(
    "migrations/fixtures/auto/example.sql",
    "migrations/fixtures/example.sql",
  );
  await fsp.rmdir("migrations/fixtures/auto");
  const history = jest.spyOn(migration, "getAllMigrations");
  try {
    const { auto, compiled } = await read();
    expect(auto).toEqual([]);
    expect(compiled).toBe("-- current\n");
    expect(history).not.toHaveBeenCalled();
  } finally {
    history.mockRestore();
  }
});

it("includes new fixtures from fixtures/auto only, in path order", async () => {
  await fsp.mkdir("migrations/fixtures/auto/policies", { recursive: true });
  await fsp.mkdir("migrations/fixtures/auto/.drafts", { recursive: true });
  await fsp.writeFile("migrations/fixtures/auto/policies/p.sql", "select 2;");
  await fsp.writeFile("migrations/fixtures/auto/.drafts/d.sql", "select 3;");
  await fsp.writeFile("migrations/fixtures/auto/.hidden.sql", "select 4;");
  await fsp.writeFile("migrations/fixtures/manual.sql", "select 5;");
  expect((await read()).auto).toEqual([
    "auto/example.sql",
    "auto/policies/p.sql",
  ]);
});

it("ignores comment-only changes and follows the latest committed version", async () => {
  const first = await recordCommit();
  expect((await read()).auto).toEqual([]);
  await fsp.writeFile(
    "migrations/fixtures/auto/example.sql",
    "select '--literal'; -- another comment\n",
  );
  expect((await read()).auto).toEqual([]);
  await fsp.writeFile("migrations/fixtures/auto/example.sql", "select 2;");
  expect((await read()).auto).toEqual(["auto/example.sql"]);
  await recordCommit(["auto/example.sql"], 2, first);
  expect((await read()).auto).toEqual([]);
  // Removing that migration, as uncommit does, makes the change pending again.
  await fsp.unlink("migrations/committed/000002.sql");
  expect((await read()).auto).toEqual(["auto/example.sql"]);
});

it("ignores new fixtures that are empty or only comments", async () => {
  await fsp.writeFile("migrations/fixtures/auto/empty.sql", "-- todo\n");
  expect((await read()).auto).toEqual(["auto/example.sql"]);
});

it("treats a fixture moved into fixtures/auto as new", async () => {
  await fsp.rename(
    "migrations/fixtures/auto/example.sql",
    "migrations/fixtures/example.sql",
  );
  await recordCommit(["example.sql"]);
  expect((await read()).auto).toEqual([]);
  await fsp.rename(
    "migrations/fixtures/example.sql",
    "migrations/fixtures/auto/example.sql",
  );
  expect((await read()).auto).toEqual(["auto/example.sql"]);
});

it.each([
  ["directly", "--!include auto/example.sql\n", {}],
  ["with another spelling", "--! include ./auto/example.sql\n", {}],
  [
    "through another fixture",
    "--!include wrapper.sql\n",
    { "migrations/fixtures/wrapper.sql": "--!include auto/example.sql\n" },
  ],
])(
  "rejects including an automatic fixture %s",
  async (_, content, files: Record<string, string>) => {
    for (const [path, fileContent] of Object.entries(files)) {
      await fsp.writeFile(path, fileContent);
    }
    await fsp.writeFile("migrations/current.sql", content);
    await expect(read()).rejects.toThrow("only included automatically");
  },
);

it("rejects --!include inside fixtures/auto", async () => {
  await fsp.writeFile("migrations/fixtures/shared.sql", "select 2;");
  await fsp.writeFile(
    "migrations/fixtures/auto/wrapper.sql",
    "--!include shared.sql\n",
  );
  await expect(read()).rejects.toThrow("must be self-contained");
});

it.each([
  ["on the first line", "--! no-transaction\nselect 1;\n"],
  ["on a later line", "select 1;\n--! no-transaction\n"],
])(
  "rejects --! no-transaction inside fixtures/auto (%s)",
  async (_, content) => {
    await fsp.writeFile("migrations/fixtures/auto/concurrently.sql", content);
    await expect(read()).rejects.toThrow("include it manually");
  },
);

it.each(["current.sql", "current/"])(
  "keeps headers before the automatic fixtures (%s)",
  async (mode) => {
    const content = "--! Message: add example\n\nselect 1;\n";
    if (mode === "current/") {
      await useCurrentDirectory(content);
    } else {
      await fsp.writeFile("migrations/current.sql", content);
    }
    const { compiled, auto } = await read();
    expect(auto).toEqual(["auto/example.sql"]);
    const { headers } = parseMigrationText("current.sql", compiled, false);
    expect(headers).toEqual({ Message: "add example" });
  },
);

it("keeps --! no-transaction on the first line", async () => {
  await fsp.writeFile(
    "migrations/current.sql",
    "--! no-transaction\nselect 1;\n",
  );
  const { compiled, auto } = await read();
  expect(auto).toEqual(["auto/example.sql"]);
  expect(isNoTransactionDefined(compiled)).toBe(true);
});

describe("database lifecycle", () => {
  beforeEach(resetDb);

  it.each(["current.sql", "current/"])(
    "runs, commits, uncommits and recommits fixtures (%s)",
    async (mode) => {
      if (mode === "current/") await useCurrentDirectory();
      await fsp.writeFile(
        "migrations/fixtures/auto/example.sql",
        "create table if not exists fixture_test (id integer);\ntruncate fixture_test;\ninsert into fixture_test values (42);",
      );
      expect(await status(settings, { skipDatabase: true })).toMatchObject({
        hasCurrentMigration: true,
      });
      await current(settings);
      const parsed = await parseSettings(settings);
      const rows = await withClient(
        parsed.connectionString,
        parsed,
        async (client) =>
          (await client.query("select * from fixture_test")).rows,
      );
      expect(rows).toEqual([{ id: 42 }]);
      expect((await read()).auto).toEqual(["auto/example.sql"]);

      await commit(settings);
      const committed = await fsp.readFile(
        "migrations/committed/000001.sql",
        "utf8",
      );
      expect(committed).toContain("--! Included auto/example.sql");
      expect((await read()).auto).toEqual([]);
      expect(await status(settings, { skipDatabase: true })).toMatchObject({
        hasCurrentMigration: false,
      });

      await uncommit(settings);
      const { raw, auto } = await read();
      // The automatic includes are derived again, not restored as manual ones.
      expect(raw).not.toContain("auto/example.sql");
      expect(raw).not.toContain("--!endAuto");
      expect(auto).toEqual(["auto/example.sql"]);

      await commit(settings);
      expect(
        await fsp.readFile("migrations/committed/000001.sql", "utf8"),
      ).toBe(committed);
    },
  );

  it("keeps the commit message through commit and uncommit", async () => {
    const content = "--! Message: add example\n\nselect 1;\n";
    await fsp.writeFile("migrations/current.sql", content);
    await commit(settings);
    expect(await fsp.readdir("migrations/committed")).toEqual([
      "000001-add-example.sql",
    ]);
    await uncommit(settings);
    expect(await fsp.readFile("migrations/current.sql", "utf8")).toBe(content);
  });

  it("refuses to uncommit while a fixture has pending changes", async () => {
    const path = "migrations/fixtures/auto/example.sql";
    await commit(settings);
    const original = await fsp.readFile(path, "utf8");
    await fsp.writeFile(path, "select 2;");
    await expect(uncommit(settings)).rejects.toThrow(
      "current migration is not blank",
    );
    // Once the edit is committed or reverted, uncommit works again.
    await fsp.writeFile(path, original);
    await uncommit(settings);
    expect((await read()).auto).toEqual(["auto/example.sql"]);
  });

  it("restores what the user wrote after a failed commit", async () => {
    await fsp.writeFile(
      "migrations/fixtures/auto/example.sql",
      "select * from missing_fixture_table;",
    );
    await expect(commit(settings)).rejects.toThrow("does not exist");
    expect(await fsp.readFile("migrations/current.sql", "utf8")).toBe(
      "-- current\n",
    );
    expect(await fsp.readdir("migrations/committed")).toEqual([]);
  });
});
