import * as chalk from "chalk";

import indent from "./indent";
import { Client } from "./pg";
import { ParsedSettings } from "./settings";

interface InstrumentationError extends Error {
  severity: string;
  code: string;
  detail: string;
  hint: string;
}

export async function runQueryWithErrorInstrumentation<T = void>(
  pgClient: Client,
  body: string,
  filename: string,
): Promise<T[] | undefined> {
  try {
    const { rows } = await pgClient.query({
      text: body,
    });
    return rows;
  } catch (e) {
    if (e.position) {
      const p = parseInt(e.position, 10);
      let line = 1;
      let column = 0;
      let idx = 0;
      while (idx < p) {
        column++;
        const char = body[idx];
        if (char === "\n") {
          line++;
          column = 0;
        } else {
          // ...
        }
        idx++;
      }
      const endOfLine = body.indexOf("\n", p);
      const previousNewline = body.lastIndexOf("\n", p);
      const previousNewline2 =
        body.lastIndexOf("\n", previousNewline - 1) || previousNewline;
      const previousNewline3 =
        body.lastIndexOf("\n", previousNewline2 - 1) || previousNewline2;
      const previousNewline4 =
        body.lastIndexOf("\n", previousNewline3 - 1) || previousNewline3;
      const startOfLine = previousNewline + 1;
      const positionWithinLine = p - startOfLine;
      const snippet = body.substring(previousNewline4 + 1, endOfLine);
      const indentString = chalk.red("| ");
      const codeIndent = 2;
      const lines = [
        chalk.bold.red(
          `🛑 Error occurred at line ${line}, column ${column} of "${filename}":`,
        ),
        chalk.reset(indent(indent(snippet, codeIndent), indentString)),
        indentString +
          chalk.red("-".repeat(positionWithinLine - 1 + codeIndent) + "^"),
        indentString + chalk.red.bold(e.code) + chalk.red(": " + e.message),
      ];
      e["_gmMessageOverride"] = lines.join("\n");
    }
    throw e;
  }
}

export const logDbError = ({ logger }: ParsedSettings, e: Error): void => {
  e["_gmlogged"] = true;
  const messages = [""];
  if (e["_gmMessageOverride"]) {
    messages.push(e["_gmMessageOverride"]);
  } else {
    messages.push(
      chalk.red.bold(`🛑 Error occurred whilst processing migration`),
    );
  }
  const { severity, code, detail, hint } = e as InstrumentationError;
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
  /* eslint-enable */
};
