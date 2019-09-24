jest.mock("child_process");

import {
  makeActionSpies,
  TEST_DATABASE_URL,
  mockCurrentSqlContentOnce,
  resetDb,
  setup,
} from "./helpers";
import { parseSettings } from "../src/settings";
import { _watch, _makeCurrentMigrationRunner } from "../src/commands/watch";

beforeEach(resetDb);

it("doesn't run current.sql if it's already up to date", async () => {
  const { settings, getActionCalls } = makeActionSpies();
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    ...settings,
  });
  await setup(parsedSettings);
  const migrationRunner = _makeCurrentMigrationRunner(
    parsedSettings,
    false,
    false
  );

  expect(getActionCalls()).toEqual([]);
  mockCurrentSqlContentOnce(
    parsedSettings,
    `\
-- First migration
SELECT ':DATABASE_NAME';
`
  );
  await migrationRunner();
  expect(getActionCalls()).toEqual(["afterCurrent"]);

  // This one is identical
  mockCurrentSqlContentOnce(
    parsedSettings,
    `\
-- Second migration; identical except for this comment
SELECT ':DATABASE_NAME';
`
  );
  await migrationRunner();
  expect(getActionCalls()).toEqual(["afterCurrent"]);

  mockCurrentSqlContentOnce(
    parsedSettings,
    `\
-- Third migration; DIFFERENT!
SELECT ':DATABASE_NAME', 2 * 2;
`
  );
  await migrationRunner();
  expect(getActionCalls()).toEqual(["afterCurrent", "afterCurrent"]);
});
