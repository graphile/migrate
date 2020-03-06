import "./helpers"; // Has side-effects; must come first

import { promises as fsp } from "fs";
import * as mockFs from "mock-fs";

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
  commitMessage => {
    const commitMessageSlug = commitMessage
      ? `-${sluggify(commitMessage)}`
      : ``;
    const {
      MIGRATION_1_TEXT,
      MIGRATION_1_COMMITTED,
      MIGRATION_MULTIFILE_COMMITTED,
      MIGRATION_MULTIFILE_FILES,
    } = makeMigrations(commitMessage);

    it("rolls back migration", async () => {
      mockFs({
        [`migrations/committed/000001${commitMessageSlug}.sql`]: MIGRATION_1_COMMITTED,
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

    it("rolls back multifile migration", async () => {
      mockFs({
        [`migrations/committed/000001${commitMessageSlug}.sql`]: MIGRATION_1_COMMITTED,
        [`migrations/committed/000002${commitMessageSlug}.sql`]: MIGRATION_MULTIFILE_COMMITTED,
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
          MIGRATION_MULTIFILE_FILES["001.sql"].trim() +
          "\n",
      );
      expect(
        await fsp.readFile("migrations/current/002-two.sql", "utf8"),
      ).toEqual(MIGRATION_MULTIFILE_FILES["002-two.sql"].trim() + "\n");
      expect(await fsp.readFile("migrations/current/003.sql", "utf8")).toEqual(
        MIGRATION_MULTIFILE_FILES["003.sql"].trim() + "\n",
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
  },
);
