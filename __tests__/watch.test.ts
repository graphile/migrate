jest.mock("child_process");
jest.mock("../src/pg");
jest.mock("../src/migration");
jest.mock("../src/fsp");

import { parseSettings } from "../src/settings";
import { _watch } from "../src/commands/watch";
import { makeActionSpies } from "./helpers";
import * as fsp from "../src/fsp";

it("calls afterCurrent when ran once", async () => {
  const { settings, getActionCalls } = makeActionSpies();
  const parsedSettings = await parseSettings({
    connectionString: "foo",
    ...settings,
  });
  // @ts-ignore
  fsp.stat.mockImplementationOnce(async (filename, _options) => {
    expect(filename).toEqual(parsedSettings.migrationsFolder + "/current.sql");
    return {};
  });
  // @ts-ignore
  fsp.readFile.mockImplementationOnce(async (filename, encoding) => {
    expect(encoding).toEqual("utf8");
    expect(filename).toEqual(parsedSettings.migrationsFolder + "/current.sql");
    return "SQL";
  });
  await _watch(parsedSettings, true, false);
  expect(getActionCalls()).toEqual(["afterCurrent"]);
});
