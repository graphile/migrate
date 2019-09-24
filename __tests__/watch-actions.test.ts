jest.mock("child_process");
jest.mock("../src/migration");

import {
  makeActionSpies,
  mockCurrentSqlContentOnce,
  TEST_DATABASE_URL,
  resetDb,
  setup,
} from "./helpers";
import { parseSettings } from "../src/settings";
import { _watch, _makeCurrentMigrationRunner } from "../src/commands/watch";
import { _migrateMigrationSchema } from "../src/migration";

beforeEach(resetDb);

it("calls afterCurrent when ran once", async () => {
  const { settings, getActionCalls } = makeActionSpies();
  const parsedSettings = await parseSettings({
    connectionString: TEST_DATABASE_URL,
    ...settings,
  });
  await setup(parsedSettings);

  mockCurrentSqlContentOnce(parsedSettings, "SQL");

  await _watch(parsedSettings, true, false);
  expect(getActionCalls()).toEqual(["afterCurrent"]);
});
