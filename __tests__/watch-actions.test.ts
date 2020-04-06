jest.mock("child_process");
jest.mock("../src/migration");

import "./helpers"; // Has side-effects; must come first

import { _makeCurrentMigrationRunner, _watch } from "../src/commands/watch";
import { _migrateMigrationSchema } from "../src/migration";
import { parseSettings } from "../src/settings";
import {
  makeActionSpies,
  mockCurrentSqlContentOnce,
  resetDb,
  setup,
  TEST_DATABASE_URL,
} from "./helpers";

beforeEach(resetDb);

it("calls beforeCurrent and afterCurrent when ran once", async () => {
  const { settings, getActionCalls } = makeActionSpies();
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    ...settings,
  });
  await setup(parsedSettings);

  mockCurrentSqlContentOnce(parsedSettings, "SQL");

  await _watch(parsedSettings, true, false);
  expect(getActionCalls()).toEqual(["beforeCurrent", "afterCurrent"]);
});
