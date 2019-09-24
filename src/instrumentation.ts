import chalk from "chalk";
import indent from "./indent";
import { Client } from "./pg";

export async function runQueryWithErrorInstrumentation(
  pgClient: Client,
  body: string,
  filename: string
) {
  try {
    await pgClient.query({
      text: body,
    });
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
          `🛑 Error occurred at line ${line}, column ${column} of "${filename}":`
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

export const logDbError = (e: Error) => {
  // tslint:disable no-console
  console.error("");
  if (e["_gmMessageOverride"]) {
    console.error(e["_gmMessageOverride"]);
  } else {
    console.error(
      chalk.red.bold(`🛑 Error occurred whilst processing migration`)
    );
    console.error(indent(e.stack ? e.stack : e.message, 4));
  }
  console.error("");
  // tslint:enable no-console
};
