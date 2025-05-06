import { reset } from "../src/commands/reset";
import { withClient } from "../src/pgReal";

jest.mock("../src/commands/migrate");

jest.mock("../src/pgReal", () => {
  const actual = jest.requireActual("../src/pgReal");
  const allAutoMocked = jest.createMockFromModule<any>("../src/pgReal");

  return {
    ...allAutoMocked,
    withClient: jest.fn(),
    escapeIdentifier: actual.escapeIdentifier,
  };
});

let mockPgClient: {
  query: jest.Mock<any, any, any>;
};

describe("reset", () => {
  beforeEach(async () => {
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
    await reset(
      {
        connectionString: "test_db",
      },
      false,
      false,
    );

    expect(mockPgClient.query).toHaveBeenNthCalledWith(
      1,
      'DROP DATABASE IF EXISTS "test_db";',
    );
  });

  it("calls DROP DATABASE with FORCE when force is true", async () => {
    await reset(
      {
        connectionString: "test_db",
      },
      false,
      true,
    );

    expect(mockPgClient.query).toHaveBeenNthCalledWith(
      1,
      'DROP DATABASE IF EXISTS "test_db" WITH (FORCE);',
    );
  });
});
