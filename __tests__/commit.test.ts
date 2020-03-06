import "./helpers"; // Has side-effects; must come first

import { promises as fsp } from "fs";
import * as mockFs from "mock-fs";

import { commit } from "../src";
import { sluggify } from "../src/sluggify";
import { makeMigrations, resetDb, settings } from "./helpers";

beforeEach(resetDb);
beforeEach(async () => {
  mockFs({ migrations: mockFs.directory() });
});
afterEach(() => {
  mockFs.restore();
});

it("aborts if current.sql is empty", async () => {
  mockFs({
    "migrations/current.sql": "-- JUST A COMMENT\n",
  });

  const promise = commit(settings);
  await promise.catch(() => {});

  mockFs.restore();
  expect(promise).rejects.toMatchInlineSnapshot(
    `[Error: Current migration is blank.]`,
  );
});

describe.each([[undefined], ["My Commit Message"]])(
  "commit message '%s'",
  commitMessage => {
    const commitMessageSlug = commitMessage
      ? `-${sluggify(commitMessage)}`
      : ``;
    const {
      MIGRATION_1_TEXT,
      MIGRATION_1_COMMITTED,
      MIGRATION_2_TEXT,
      MIGRATION_2_COMMITTED,
      MIGRATION_MULTIFILE_COMMITTED,
      MIGRATION_MULTIFILE_FILES,
    } = makeMigrations(commitMessage);

    it("can commit the first migration", async () => {
      mockFs({
        "migrations/current.sql": MIGRATION_1_TEXT,
      });

      await commit(settings, commitMessage);
      expect(
        await fsp.readFile(
          `migrations/committed/000001${commitMessageSlug}.sql`,
          "utf8",
        ),
      ).toEqual(MIGRATION_1_COMMITTED);
    });

    it("can commit the second migration", async () => {
      mockFs({
        [`migrations/committed/000001${commitMessageSlug}.sql`]: MIGRATION_1_COMMITTED,
        "migrations/current.sql": MIGRATION_2_TEXT,
      });

      await commit(settings, commitMessage);
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
      ).toEqual(MIGRATION_2_COMMITTED);
    });

    it("can commit multi-file migration", async () => {
      mockFs({
        [`migrations/committed/000001${commitMessageSlug}.sql`]: MIGRATION_1_COMMITTED,
        "migrations/current": MIGRATION_MULTIFILE_FILES,
      });

      await commit(settings, commitMessage);
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
