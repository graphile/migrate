import { parse } from "pg-connection-string";

function makePgClientMock() {
  return {};
}

export const withClient = jest.fn(
  (connectionString, _parsedSettings, callback) => {
    const { database } = parse(connectionString);
    const mockPgClient = makePgClientMock();
    const mockContext = {
      database,
    };
    return callback(mockPgClient, mockContext);
  }
);
