jest.mock("child_process");
jest.mock("../src/pg");
jest.mock("../src/migration");
jest.mock("../src/fsp");

import { parseSettings } from "../src/settings";
import { _migrate } from "../src/commands/migrate";
import { executeActions } from "../src/actions";
import { mockPgClient } from "./helpers";
import { exec } from "child_process";

it("runs SQL actions", async () => {
  const parsedSettings = await parseSettings({
    connectionString: "foo",
    afterAllMigrations: ["sqlfile1.sql", { _: "sql", file: "sqlfile2.sql" }],
  });
  const mockedExec: jest.Mock<typeof exec> = exec as any;
  mockedExec.mockClear();
  mockPgClient.query.mockClear();
  await executeActions(
    parsedSettings,
    false,
    parsedSettings.afterAllMigrations
  );
  expect(mockedExec).toHaveBeenCalledTimes(0);
  expect(mockPgClient.query).toHaveBeenCalledTimes(2);
  expect(mockPgClient.query).toHaveBeenNthCalledWith(1, {
    text: `[CONTENT:migrations/sqlfile1.sql]`,
  });
  expect(mockPgClient.query).toHaveBeenNthCalledWith(2, {
    text: `[CONTENT:migrations/sqlfile2.sql]`,
  });
});

it("runs command actions", async () => {
  const parsedSettings = await parseSettings({
    connectionString: "foo",
    afterAllMigrations: [{ _: "command", command: "touch testCommandAction" }],
  });
  const mockedExec: jest.Mock<typeof exec> = exec as any;
  mockedExec.mockClear();
  mockedExec.mockImplementationOnce((_cmd, _options, callback) =>
    callback(null, { stdout: "", stderr: "" })
  );

  mockPgClient.query.mockClear();
  await executeActions(
    parsedSettings,
    false,
    parsedSettings.afterAllMigrations
  );
  expect(mockPgClient.query).toHaveBeenCalledTimes(0);
  expect(mockedExec).toHaveBeenCalledTimes(1);
  expect(mockedExec.mock.calls[0][0]).toBe("touch testCommandAction");
  expect(mockedExec.mock.calls[0][1].env.PATH).toBe(process.env.PATH);
  expect(mockedExec.mock.calls[0][1].env.GM_SHADOW).toBe(undefined);
  expect(typeof mockedExec.mock.calls[0][1].env.GM_DBURL).toBe("string");
});
