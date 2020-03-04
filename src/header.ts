export function isNoTransactionDefined(sql: string): boolean {
  const i = sql.indexOf("\n");
  const firstLine = i > 0 ? sql.substring(0, i) : sql;
  return /^--!\s*no-transaction\b/.test(firstLine);
}
