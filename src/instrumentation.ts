import chalk from "chalk";
import { QueryResultRow } from "pg";

import indent from "./indent";
import { Client } from "./pg";
import { ParsedSettings } from "./settings";
import { resolveSqlPosition } from "./sqlSplitSourceMap";

export interface InstrumentationError extends Error {
  severity?: string;
  code?: string;
  detail?: string;
  hint?: string;
  _gmlogged?: boolean;
  _gmMessageOverride?: string;
}

export interface RunQueryInstrumentationOptions {
  /** When the SQL was assembled from a `current/` folder, the path to that directory. */
  splitBasePath?: string;
}

export async function runQueryWithErrorInstrumentation<
  T extends QueryResultRow = QueryResultRow,
>(
  pgClient: Client,
  body: string,
  filename: string,
  options?: RunQueryInstrumentationOptions,
): Promise<T[] | undefined> {
  try {
    const { rows } = await pgClient.query<T>({
      text: body,
    });
    return rows;
  } catch (e) {
    if (
      e instanceof Error &&
      "position" in e &&
      (typeof e.position === "string" || typeof e.position === "number")
    ) {
      const p = parseInt(String(e.position), 10);
      const hasSplits = /^--! split: /m.test(body);
      const resolved = hasSplits
        ? resolveSqlPosition(body, p, {
            defaultFilename: filename,
            splitBasePath: options?.splitBasePath,
          })
        : null;

      const sourceBody = resolved
        ? body.substring(resolved.segment.start, resolved.segment.end)
        : body;
      const position0 = resolved
        ? resolved.position0 - resolved.segment.start
        : p - 1;

      let line = 1;
      let column = 0;
      let idx = 0;
      while (idx <= position0) {
        column++;
        const char = sourceBody[idx];
        if (char === "\n") {
          line++;
          column = 0;
        }
        idx++;
      }

      const endOfLine = sourceBody.indexOf("\n", position0);
      const end = endOfLine === -1 ? sourceBody.length : endOfLine;
      const previousNewline = sourceBody.lastIndexOf("\n", position0);
      const previousNewline2 =
        sourceBody.lastIndexOf("\n", previousNewline - 1) || previousNewline;
      const previousNewline3 =
        sourceBody.lastIndexOf("\n", previousNewline2 - 1) || previousNewline2;
      const previousNewline4 =
        sourceBody.lastIndexOf("\n", previousNewline3 - 1) || previousNewline3;
      const startOfLine = previousNewline + 1;
      const positionWithinLine = position0 - startOfLine;
      const snippet = sourceBody.substring(previousNewline4 + 1, end);
      const displayFilename = resolved?.filename ?? filename;
      const indentString = chalk.red("| ");
      const codeIndent = 2;
      const lines = [
        chalk.bold.red(
          `🛑 Error occurred at line ${line}, column ${column} of "${displayFilename}":`,
        ),
        chalk.reset(indent(indent(snippet, codeIndent), indentString)),
        indentString +
          chalk.red("-".repeat(positionWithinLine + codeIndent) + "^"),
        indentString +
          chalk.red.bold((e as InstrumentationError).code) +
          chalk.red(": " + e.message),
      ];
      (e as InstrumentationError)["_gmMessageOverride"] = lines.join("\n");
    }
    throw e;
  }
}

export const logDbError = ({ logger }: ParsedSettings, error: Error): void => {
  const e = error as InstrumentationError;
  e._gmlogged = true;
  const messages = [""];
  if (e["_gmMessageOverride"]) {
    messages.push(e["_gmMessageOverride"]);
  } else {
    messages.push(
      chalk.red.bold(`🛑 Error occurred whilst processing migration`),
    );
  }
  const { severity, code, detail, hint } = e;
  messages.push(indent(e.stack ? e.stack : e.message, 4));
  messages.push("");
  if (severity) {
    messages.push(indent(`Severity:\t${severity}`, 4));
  }
  if (code) {
    messages.push(indent(`Code:    \t${code}`, 4));
  }
  if (detail) {
    messages.push(indent(`Detail:  \t${detail}`, 4));
  }
  if (hint) {
    messages.push(indent(`Hint:    \t${hint}`, 4));
  }
  messages.push("");
  logger.error(messages.join("\n"), { error: e });
};
