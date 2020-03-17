import "../../__tests__/helpers"; // Has side-effects, must come first

import { parse } from "pg-connection-string";

import { mockPgClient } from "../../__tests__/helpers";

export const withClient = jest.fn(
  (connectionString, _parsedSettings, callback) => {
    const { database } = parse(connectionString);
    const mockContext = {
      database,
    };
    return callback(mockPgClient, mockContext);
  },
);

const { withTransaction: originalWithTransaction } = jest.requireActual(
  "../migration",
);

export const withTransaction = jest.fn(originalWithTransaction);
export const withAdvisoryLock = jest.fn((pgClient, callback) =>
  callback(pgClient),
);
