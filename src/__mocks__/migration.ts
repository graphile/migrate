const {
  slowGeneratePlaceholderReplacement: originalGeneratePlaceholderReplacement,
  _migrateMigrationSchema: realMigrateMigrationSchema,
  runStringMigration: realRunStringMigration,
} = jest.requireActual("../migration");

export const generatePlaceholderReplacement = jest.fn(
  originalGeneratePlaceholderReplacement
);

export const _migrateMigrationSchema = jest.fn(realMigrateMigrationSchema);

export const getLastMigration = jest.fn((_client, _settings) =>
  Promise.resolve(null)
);

export const getAllMigrations = jest.fn(_settings => Promise.resolve([]));

export const getMigrationsAfter = jest.fn((_settings, _previousMigration) =>
  Promise.resolve([])
);

export const runStringMigration = jest.fn(
  (_client, _settings, _context, _body, _filename, _committedMigration) =>
    realRunStringMigration(
      _client,
      _settings,
      _context,
      _body,
      _filename,
      _committedMigration,
      true
    )
);

export const runCommittedMigration = jest.fn(
  (_client, _settings, _context, _committedMigration, _logSuffix) => {}
);
