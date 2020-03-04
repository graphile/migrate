import "mock-fs";
import * as mockFs from "mock-fs";
import {
  getCurrentMigrationLocation,
  readCurrentMigration,
} from "../src/current";
import { parseSettings, ParsedSettings } from "../src/settings";
import { TEST_ROOT_DATABASE_URL } from "./helpers";

let parsedSettings: ParsedSettings;
beforeEach(async () => {
  mockFs({ migrations: mockFs.directory() });
  parsedSettings = await parseSettings({
    connectionString: TEST_ROOT_DATABASE_URL,
  });
});
afterEach(() => {
  mockFs.restore();
});

it("reads from current.sql", async () => {
  mockFs({
    "migrations/current.sql": "-- TEST",
  });

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);

  const content = await readCurrentMigration(parsedSettings, currentLocation);
  expect(content).toEqual("-- TEST");
});

it("returns empty if there's no current.sql", async () => {
  const currentLocation = await getCurrentMigrationLocation(parsedSettings);

  const content = await readCurrentMigration(parsedSettings, currentLocation);
  expect(content).toEqual("");
});

it("returns empty if there's an empty current/", async () => {
  mockFs({
    "migrations/current": mockFs.directory(),
  });
  const currentLocation = await getCurrentMigrationLocation(parsedSettings);

  const content = await readCurrentMigration(parsedSettings, currentLocation);
  expect(content).toEqual("");
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
Note: 300 was empty\
`;

it("reads multiple files", async () => {
  mockFs({
    "migrations/current": {
      "100-first.sql": "First content\n",
      "200-second.sql": `\
Some more content
With multiple lines
-- and comments
`,
      "300-third.sql": "",
      "400-fourth.sql": "Note: 300 was empty",
    },
  });

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);
  const content = await readCurrentMigration(parsedSettings, currentLocation);
  expect(content).toEqual(contentWithSplits);
});

it("ignores extraneous files", async () => {
  mockFs({
    "migrations/current": {
      "README.md": "Blah blah\nEtc etc\nFoo bar baz",
      "100-first.sql": "First content\n",
      "200-second.sql": `\
Some more content
With multiple lines
-- and comments
`,
      "300-third.sql": "",
      "400-fourth.sql": "Note: 300 was empty",
    },
  });

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);
  const content = await readCurrentMigration(parsedSettings, currentLocation);
  expect(content).toEqual(contentWithSplits);
});
