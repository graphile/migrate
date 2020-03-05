import "./helpers"; // Has side-effects; must come first

import { createHash } from "crypto";
import { promises as fsp } from "fs";
import * as mockFs from "mock-fs";

import { commit } from "../src";
import { TEST_DATABASE_URL, TEST_SHADOW_DATABASE_URL } from "./helpers";

const MIGRATION_1_TEXT = "create table foo (id serial primary key);";
const MIGRATION_1_HASH = "bfe32129112f19d4cadd717c1c15ed7ccbca4408";
const MIGRATION_1_COMMITTED = `--! Previous: -\n--! Hash: sha1:${MIGRATION_1_HASH}\n\n${MIGRATION_1_TEXT.trim()}\n`;

const MIGRATION_2_TEXT =
  "\n\n\ncreate table bar (id serial primary key);\n\n\n";
const MIGRATION_2_HASH = createHash("sha1")
  .update(`sha1:${MIGRATION_1_HASH}\n${MIGRATION_2_TEXT.trim()}` + "\n")
  .digest("hex");
const MIGRATION_2_COMMITTED = `--! Previous: sha1:${MIGRATION_1_HASH}\n--! Hash: sha1:${MIGRATION_2_HASH}\n\n${MIGRATION_2_TEXT.trim()}\n`;

const MIGRATION_MULTIFILE_FILES = {
  "001.sql": "select 1;",
  "002-two.sql": "select 2;",
  "003.sql": "select 3;",
};

const MIGRATION_MULTIFILE_TEXT = `\
--! split: 001.sql
select 1;
--! split: 002-two.sql
select 2;
--! split: 003.sql
select 3;
`;
const MIGRATION_MULTIFILE_HASH = createHash("sha1")
  .update(`sha1:${MIGRATION_1_HASH}\n${MIGRATION_MULTIFILE_TEXT.trim()}` + "\n")
  .digest("hex");
const MIGRATION_MULTIFILE_COMMITTED = `--! Previous: sha1:${MIGRATION_1_HASH}\n--! Hash: sha1:${MIGRATION_MULTIFILE_HASH}\n\n${MIGRATION_MULTIFILE_TEXT.trim()}\n`;

beforeEach(async () => {
  mockFs({ migrations: mockFs.directory() });
});
afterEach(() => {
  mockFs.restore();
});

it("can commit the first migration", async () => {
  mockFs({
    "migrations/current.sql": MIGRATION_1_TEXT,
  });

  await commit({
    connectionString: TEST_DATABASE_URL,
    shadowConnectionString: TEST_SHADOW_DATABASE_URL,
  });
  expect(await fsp.readFile("migrations/committed/000001.sql", "utf8")).toEqual(
    MIGRATION_1_COMMITTED,
  );
});

it("can commit the second migration", async () => {
  mockFs({
    "migrations/committed/000001.sql": MIGRATION_1_COMMITTED,
    "migrations/current.sql": MIGRATION_2_TEXT,
  });

  await commit({
    connectionString: TEST_DATABASE_URL,
    shadowConnectionString: TEST_SHADOW_DATABASE_URL,
  });
  expect(await fsp.readFile("migrations/committed/000001.sql", "utf8")).toEqual(
    MIGRATION_1_COMMITTED,
  );
  expect(await fsp.readFile("migrations/committed/000002.sql", "utf8")).toEqual(
    MIGRATION_2_COMMITTED,
  );
});

it("aborts if current.sql is empty", async () => {
  mockFs({
    "migrations/committed/000001.sql": MIGRATION_1_COMMITTED,
    "migrations/current.sql": "-- JUST A COMMENT\n",
  });

  const promise = commit({
    connectionString: TEST_DATABASE_URL,
    shadowConnectionString: TEST_SHADOW_DATABASE_URL,
  });
  await promise.catch(() => {});

  mockFs.restore();
  expect(promise).rejects.toMatchInlineSnapshot(
    `[Error: Current migration is blank.]`,
  );
});

it("can commit multi-file migration", async () => {
  mockFs({
    "migrations/committed/000001.sql": MIGRATION_1_COMMITTED,
    "migrations/current": MIGRATION_MULTIFILE_FILES,
  });

  await commit({
    connectionString: TEST_DATABASE_URL,
    shadowConnectionString: TEST_SHADOW_DATABASE_URL,
  });
  expect(await fsp.readFile("migrations/committed/000001.sql", "utf8")).toEqual(
    MIGRATION_1_COMMITTED,
  );
  expect(await fsp.readFile("migrations/committed/000002.sql", "utf8")).toEqual(
    MIGRATION_MULTIFILE_COMMITTED,
  );
});
