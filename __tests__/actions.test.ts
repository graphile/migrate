jest.mock("child_process");
jest.mock("../src/pg");
jest.mock("../src/migration");
jest.mock("../src/fsp");

import { parseSettings } from "../src/settings";
import { _migrate } from "../src/commands/migrate";
import { executeActions } from "../src/actions";
import { mockPgClient } from "./helpers";

it("runs SQL actions", async () => {
  const parsedSettings = await parseSettings({
    connectionString: "foo",
    afterAllMigrations: ["sqlfile1.sql", { _: "sql", file: "sqlfile2.sql" }],
  });
  mockPgClient.query.mockClear();
  await executeActions(
    parsedSettings,
    false,
    parsedSettings.afterAllMigrations
  );
  expect(mockPgClient.query).toHaveBeenCalledTimes(2);
  expect(mockPgClient.query).toHaveBeenNthCalledWith(1, {
    text: `[CONTENT:migrations/sqlfile1.sql]`,
  });
  expect(mockPgClient.query).toHaveBeenNthCalledWith(2, {
    text: `[CONTENT:migrations/sqlfile2.sql]`,
  });
});
