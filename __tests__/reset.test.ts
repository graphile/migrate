import { _reset } from "../src/commands/reset";
import { ParsedSettings, parseSettings } from "../src/settings";
import { withClient } from "../src/pgReal";

jest.mock("../src/commands/migrate");

jest.mock("../src/pgReal", () => ({
  withClient: jest.fn(),
  escapeIdentifier: (id: string) => `"${id}"`,
}));

let parsedSettings: ParsedSettings;

let mockPgClient: {
  query: jest.Mock<any, any, any>;
};

describe("_reset", () => {
  beforeEach(async () => {
    parsedSettings = await parseSettings({
      connectionString: "test_db",
      rootConnectionString: "[rootConnectionString]",

      placeholders: {
        ":DATABASE_AUTHENTICATOR": "[DATABASE_AUTHENTICATOR]",
        ":DATABASE_AUTHENTICATOR_PASSWORD": "[DATABASE_AUTHENTICATOR_PASSWORD]",
      },
      beforeReset: [],
      beforeAllMigrations: [],
      beforeCurrent: [],
      afterReset: [],
      afterAllMigrations: [],
      afterCurrent: [],
    });

    mockPgClient = {
      query: jest.fn(),
    };

    (withClient as any).mockImplementation(
      async (_connString: any, _settings: any, callback: any) => {
        await callback(mockPgClient);
      },
    );
  });

  it("calls DROP DATABASE without FORCE when force is false", async () => {
    await _reset(parsedSettings, false, false);

    expect(mockPgClient.query).toHaveBeenCalledWith(
      'DROP DATABASE IF EXISTS "test_db";',
    );
  });

  it("calls DROP DATABASE with FORCE when force is true", async () => {
    await _reset(parsedSettings, false, true);

    expect(mockPgClient.query).toHaveBeenCalledWith(
      'DROP DATABASE IF EXISTS "test_db" WITH (FORCE);',
    );
  });
});
