const VALID_FILE_REGEX = /^([0-9]+)(-[-_a-zA-Z0-9]*)?\.sql$/;

export const migrationFilenameMatches = (
  filename: string,
): RegExpMatchArray | null => VALID_FILE_REGEX.exec(filename);

export const isMigrationFilename = (filename: string): boolean =>
  VALID_FILE_REGEX.test(filename);

export function idFromFilename(file: string): number {
  const matches = migrationFilenameMatches(file);
  if (!matches) {
    throw new Error(
      `Invalid current migration filename: '${file}'. File must follow the naming 001.sql or 001-message.sql, where 001 is a unique number (with optional zero padding) and message is an optional alphanumeric string.`,
    );
  }
  const [, rawId, _message] = matches;
  const id = parseInt(rawId, 10);

  if (!id || !isFinite(id) || id < 1) {
    throw new Error(
      `Invalid current migration filename: '${file}'. File must start with a (positive) number, could not coerce '${rawId}' to int.`,
    );
  }
  return id;
}
