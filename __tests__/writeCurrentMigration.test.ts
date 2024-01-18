import "./helpers"; // Has side-effects; must come first

import { promises as fsp } from "fs";
import mockFs from "mock-fs";

import {
  getCurrentMigrationLocation,
  writeCurrentMigration,
} from "../src/current";
import { ParsedSettings, parseSettings } from "../src/settings";
import { TEST_DATABASE_URL } from "./helpers";

let parsedSettings: ParsedSettings;
beforeEach(async () => {
  mockFs({ migrations: mockFs.directory() });
  parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
  });
});
afterEach(() => {
  mockFs.restore();
});

it("writes to current.sql if current.sql exists", async () => {
  mockFs({
    "migrations/current.sql": "-- TEST",
  });

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);

  await writeCurrentMigration(parsedSettings, currentLocation, "TEST!\n");
  const content = await fsp.readFile("migrations/current.sql", "utf8");
  expect(content).toEqual("TEST!\n");
});

it("writes to current.sql if no current.sql exists", async () => {
  expect(fsp.stat("migrations/current.sql")).rejects.toMatchObject({
    code: "ENOENT",
  });

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);

  await writeCurrentMigration(parsedSettings, currentLocation, "TEST!\n");
  const content = await fsp.readFile("migrations/current.sql", "utf8");
  expect(content).toEqual("TEST!\n");
});

it("writes to current/1-current.sql if current directory exists", async () => {
  mockFs({ "migrations/current": mockFs.directory() });

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);

  await writeCurrentMigration(parsedSettings, currentLocation, "TEST!\n");
  const content = await fsp.readFile(
    "migrations/current/1-current.sql",
    "utf8",
  );
  expect(content).toEqual("TEST!\n");
});

const contentWithSplits = `\
--! split: 100-first.sql
First content

--! split: 200-second.sql
Some more content
With multiple lines
-- and comments

--! split: 300-third.sql


--! split: 400-fourth.sql
Note: 300 was empty
`;

it("writes to current/*.sql with splits", async () => {
  mockFs({ "migrations/current": mockFs.directory() });

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);

  await writeCurrentMigration(
    parsedSettings,
    currentLocation,
    contentWithSplits,
  );
  const contents = await fsp.readdir("migrations/current");
  expect(contents.sort()).toEqual([
    "100-first.sql",
    "200-second.sql",
    "300-third.sql",
    "400-fourth.sql",
  ]);
  expect(
    await fsp.readFile("migrations/current/100-first.sql", "utf8"),
  ).toEqual("First content\n");
  expect(await fsp.readFile("migrations/current/200-second.sql", "utf8"))
    .toEqual(`\
Some more content
With multiple lines
-- and comments
`);
  expect(
    await fsp.readFile("migrations/current/300-third.sql", "utf8"),
  ).toEqual("\n");
  expect(
    await fsp.readFile("migrations/current/400-fourth.sql", "utf8"),
  ).toEqual("Note: 300 was empty\n");
});

it("writes to current/*.sql and deletes previous content", async () => {
  mockFs({
    "migrations/current": {
      "001-placeholder.sql": "-- Comment",
      "300-third.sql": "NOT EMPTY",
      "500-fifth.sql": "DELETE ME",
    },
  });

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);

  await writeCurrentMigration(
    parsedSettings,
    currentLocation,
    contentWithSplits,
  );
  const contents = await fsp.readdir("migrations/current");
  expect(contents.sort()).toEqual([
    "100-first.sql",
    "200-second.sql",
    "300-third.sql",
    "400-fourth.sql",
  ]);
  expect(
    await fsp.readFile("migrations/current/100-first.sql", "utf8"),
  ).toEqual("First content\n");
  expect(await fsp.readFile("migrations/current/200-second.sql", "utf8"))
    .toEqual(`\
Some more content
With multiple lines
-- and comments
`);
  expect(
    await fsp.readFile("migrations/current/300-third.sql", "utf8"),
  ).toEqual("\n");
  expect(
    await fsp.readFile("migrations/current/400-fourth.sql", "utf8"),
  ).toEqual("Note: 300 was empty\n");
});

it("merges to first file if there's no initial split", async () => {
  mockFs({
    "migrations/current": {
      "001-placeholder.sql": "-- Comment",
      "300-third.sql": "NOT EMPTY",
      "500-fifth.sql": "DELETE ME",
    },
  });

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);

  await writeCurrentMigration(
    parsedSettings,
    currentLocation,
    "-- HELLO WORLD\n" + contentWithSplits,
  );
  const contents = await fsp.readdir("migrations/current");
  expect(contents.sort()).toEqual([
    "100-first.sql",
    "200-second.sql",
    "300-third.sql",
    "400-fourth.sql",
  ]);
  await expect(
    fsp.stat("migrations/current/1-current.sql"),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    await fsp.readFile("migrations/current/100-first.sql", "utf8"),
  ).toEqual("-- HELLO WORLD\nFirst content\n");
  expect(await fsp.readFile("migrations/current/200-second.sql", "utf8"))
    .toEqual(`\
Some more content
With multiple lines
-- and comments
`);
  expect(
    await fsp.readFile("migrations/current/300-third.sql", "utf8"),
  ).toEqual("\n");
  expect(
    await fsp.readFile("migrations/current/400-fourth.sql", "utf8"),
  ).toEqual("Note: 300 was empty\n");
});

it("writes to current/1-current.sql only if there's no splits", async () => {
  mockFs({
    "migrations/current": {
      "001-placeholder.sql": "-- Comment",
      "300-third.sql": "NOT EMPTY",
      "500-fifth.sql": "DELETE ME",
    },
  });

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);

  await writeCurrentMigration(
    parsedSettings,
    currentLocation,
    "-- HELLO WORLD\n",
  );
  const contents = await fsp.readdir("migrations/current");
  expect(contents.sort()).toEqual(["1-current.sql"]);
  expect(
    await fsp.readFile("migrations/current/1-current.sql", "utf8"),
  ).toEqual("-- HELLO WORLD\n");
});
