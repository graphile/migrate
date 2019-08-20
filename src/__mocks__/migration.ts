const {
  slowGeneratePlaceholderReplacement: originalGeneratePlaceholderReplacement,
} = jest.requireActual("../migration");

export const generatePlaceholderReplacement = jest.fn(
  originalGeneratePlaceholderReplacement
);

export const migrateMigrationSchema = jest.fn(async (_client, _settings) => {});

export const getLastMigration = jest.fn(async (_client, _settings) => {
  return null;
});

export const getAllMigrations = jest.fn(async _settings => {
  return [];
});

export const getMigrationsAfter = jest.fn(
  async (_settings, _previousMigration) => {
    return [];
  }
);

export const runStringMigration = jest.fn(
  (_client, _settings, _context, _body, _filename, _committedMigration) => {}
);

export const runCommittedMigration = jest.fn(
  (_client, _settings, _context, _committedMigration, _logSuffix) => {}
);
