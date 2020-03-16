#!/usr/bin/env node
import * as yargs from "yargs";

// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import { version } from "../package.json";
import { commitCommand } from "./commands/commit";
import { migrateCommand } from "./commands/migrate";
import { resetCommand } from "./commands/reset";
import { statusCommand } from "./commands/status";
import { uncommitCommand } from "./commands/uncommit";
import { watchCommand } from "./commands/watch";

function wrapHandler(
  input: yargs.CommandModule<unknown, unknown>,
): yargs.CommandModule<unknown, unknown> {
  const { handler, ...rest } = input;

  const newHandler: yargs.CommandModule<
    unknown,
    unknown
  >["handler"] = async argv => {
    try {
      return await Promise.resolve(handler(argv));
    } catch (e) {
      if (!e["_gmlogged"]) {
        // eslint-disable-next-line no-console
        console.error(e);
      }
      process.exit(1);
    }
  };

  return {
    ...rest,
    handler: newHandler,
  };
}

yargs
  .parserConfiguration({
    "boolean-negation": true,
    "camel-case-expansion": false,
    "combine-arrays": false,
    "dot-notation": false,
    "duplicate-arguments-array": false,
    "flatten-duplicate-arrays": false,
    "halt-at-non-option": false,
    "parse-numbers": true,
    "populate--": false,
    "set-placeholder-key": false,
    "short-option-groups": true,
    "sort-commands": false,
    "strip-aliased": true,
    "strip-dashed": false,
    "unknown-options-as-args": false,
  })
  .scriptName("graphile-migrate")

  .strict(true)
  .version(version)
  .help(true)
  .completion("completion", "Generate shell completion script.")
  .demandCommand(1, 1, "Please select a command to run.")
  .recommendCommands()

  // Commands
  .command(wrapHandler(migrateCommand))
  .command(wrapHandler(watchCommand))
  .command(wrapHandler(commitCommand))
  .command(wrapHandler(uncommitCommand))
  .command(wrapHandler(statusCommand))
  .command(wrapHandler(resetCommand))

  .epilogue(
    `\
You are running graphile-migrate v${version}.

Please consider supporting Graphile Migrate development: 

  https://www.graphile.org/sponsor/
`,
  ).argv;
