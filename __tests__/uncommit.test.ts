import "./helpers"; // Has side-effects; must come first

import * as fsp from "fs/promises";
import mockFs from "mock-fs";

import { commit, migrate, uncommit } from "../src";
import { sluggify } from "../src/sluggify";
import { makeMigrations, resetDb, settings } from "./helpers";

beforeEach(resetDb);
beforeEach(async () => {
  mockFs({ migrations: mockFs.directory() });
});
afterEach(() => {
  mockFs.restore();
});

it("aborts if there is no previous migration", async () => {
  mockFs({
    "migrations/current.sql": "-- JUST A COMMENT\n",
  });

  const promise = uncommit(settings);
  await promise.catch(() => {});

  mockFs.restore();
  expect(promise).rejects.toMatchInlineSnapshot(
    `[Error: There's no committed migration to uncommit]`,
  );
});
it("aborts if current migration is not empty", async () => {
  const { MIGRATION_1_COMMITTED } = makeMigrations();
  mockFs({
    "migrations/committed/000001.sql": MIGRATION_1_COMMITTED,
    "migrations/current.sql": "SELECT 1;",
  });

  await migrate(settings);

  const promise = uncommit(settings);
  await promise.catch(() => {});

  mockFs.restore();
  await expect(promise).rejects.toMatchInlineSnapshot(
    `[Error: Cannot uncommit - current migration is not blank.]`,
  );
});

describe.each([[undefined], ["My Commit Message"]])(
  "uncommit message '%s'",
  (commitMessage) => {
    const commitMessageSlug = commitMessage
      ? `-${sluggify(commitMessage)}`
      : ``;
    const {
      MIGRATION_1_TEXT,
      MIGRATION_1_COMMITTED,
      MIGRATION_INCLUDE_TEXT,
      MIGRATION_INCLUDE_COMMITTED,
      MIGRATION_MULTIFILE_COMMITTED,
      MIGRATION_MULTIFILE_FILES,
      MIGRATION_INCLUDED_FIXTURE,
    } = makeMigrations(commitMessage);

    it("rolls back migration", async () => {
      mockFs({
        [`migrations/committed/000001${commitMessageSlug}.sql`]:
          MIGRATION_1_COMMITTED,
        "migrations/current.sql": "-- JUST A COMMENT\n",
      });
      await migrate(settings);
      await uncommit(settings);

      await expect(
        fsp.stat("migrations/committed/000001.sql"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await fsp.readFile("migrations/current.sql", "utf8")).toEqual(
        (commitMessage ? `--! Message: ${commitMessage}\n\n` : "") +
          MIGRATION_1_TEXT.trim() +
          "\n",
      );

      await commit(settings);
      expect(
        await fsp.readFile(
          `migrations/committed/000001${commitMessageSlug}.sql`,
          "utf8",
        ),
      ).toEqual(MIGRATION_1_COMMITTED);
    });

    it("rolls back a migration that has included another file", async () => {
      mockFs({
        [`migrations/committed/000001${commitMessageSlug}.sql`]:
          MIGRATION_INCLUDE_COMMITTED,
        "migrations/current.sql": "-- JUST A COMMENT\n",
        "migrations/fixtures/foo.sql": MIGRATION_INCLUDED_FIXTURE,
      });
      await migrate(settings);
      await uncommit(settings);

      await expect(
        fsp.stat("migrations/committed/000001.sql"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await fsp.readFile("migrations/current.sql", "utf8")).toEqual(
        (commitMessage ? `--! Message: ${commitMessage}\n\n` : "") +
          MIGRATION_INCLUDE_TEXT.trim() +
          "\n",
      );

      await commit(settings);
      expect(
        await fsp.readFile(
          `migrations/committed/000001${commitMessageSlug}.sql`,
          "utf8",
        ),
      ).toEqual(MIGRATION_INCLUDE_COMMITTED);
    });

    it("rolls back multifile migration", async () => {
      mockFs({
        [`migrations/committed/000001${commitMessageSlug}.sql`]:
          MIGRATION_1_COMMITTED,
        [`migrations/committed/000002${commitMessageSlug}.sql`]:
          MIGRATION_MULTIFILE_COMMITTED,
        "migrations/current/1.sql": "-- COMMENT",
      });
      await migrate(settings);
      await uncommit(settings);

      expect(
        await fsp.readFile(
          `migrations/committed/000001${commitMessageSlug}.sql`,
          "utf8",
        ),
      ).toEqual(MIGRATION_1_COMMITTED);
      await expect(
        fsp.stat("migrations/committed/000002.sql"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await fsp.readFile("migrations/current/001.sql", "utf8")).toEqual(
        (commitMessage ? `--! Message: ${commitMessage}\n\n` : "") +
          MIGRATION_MULTIFILE_FILES["migrations/current"]["001.sql"].trim() +
          "\n",
      );
      expect(
        await fsp.readFile("migrations/current/002-two.sql", "utf8"),
      ).toEqual(
        MIGRATION_MULTIFILE_FILES["migrations/links/two.sql"].trim() + "\n",
      );
      expect(await fsp.readFile("migrations/current/003.sql", "utf8")).toEqual(
        MIGRATION_MULTIFILE_FILES["migrations/current"]["003.sql"].trim() +
          "\n",
      );

      await commit(settings);
      expect(
        await fsp.readFile(
          `migrations/committed/000001${commitMessageSlug}.sql`,
          "utf8",
        ),
      ).toEqual(MIGRATION_1_COMMITTED);
      expect(
        await fsp.readFile(
          `migrations/committed/000002${commitMessageSlug}.sql`,
          "utf8",
        ),
      ).toEqual(MIGRATION_MULTIFILE_COMMITTED);
    });

    it("supports the same fixture twice", async () => {
      const current = `\
--!include fixture2.sql
select 22;
--!include fixture2.sql
`;
      mockFs({
        "migrations/fixtures/fixture1.sql": "select 'fixture1';",
        "migrations/fixtures/fixture2.sql":
          "select 1;\n--!include fixture1.sql\nselect 2;",
        [`migrations/committed/000001${commitMessageSlug}.sql`]:
          MIGRATION_1_COMMITTED,
        [`migrations/committed/000002${commitMessageSlug}.sql`]:
          MIGRATION_MULTIFILE_COMMITTED,
        "migrations/current/1.sql": current,
      });
      await migrate(settings);
      await commit(settings, commitMessage);
      expect(
        await fsp.readFile(
          `migrations/committed/000003${commitMessageSlug}.sql`,
          "utf8",
        ),
      ).toContain(
        `\
--! Included fixture2.sql
select 1;
--! Included fixture1.sql
select 'fixture1';
--! EndIncluded fixture1.sql
select 2;
--! EndIncluded fixture2.sql
select 22;
--! Included fixture2.sql
select 1;
--! Included fixture1.sql
select 'fixture1';
--! EndIncluded fixture1.sql
select 2;
--! EndIncluded fixture2.sql
`,
      );
      await uncommit(settings);

      expect(await fsp.readFile(`migrations/current/1.sql`, "utf8")).toEqual(
        (commitMessage ? `--! Message: ${commitMessage}\n\n` : "") + current,
      );
    });
  },
);
