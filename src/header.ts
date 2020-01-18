export function isNoTransactionDefined(sql: string): boolean {
  const i = sql.indexOf("\n");
  const firstLine = sql.substring(0, i);
  return /^--!\s*no-transaction\b/.exec(firstLine) != null;
}
