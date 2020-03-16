#!/usr/bin/env node
import * as yargs from "yargs";

// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import { version } from "../package.json";
import { migrateCommand } from "./commands/migrate";
import { resetCommand } from "./commands/reset.js";
import { watchCommand } from "./commands/watch";

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
  .recommendCommands()

  // Commands
  .command(migrateCommand)
  .command(watchCommand)
  .command(resetCommand)

  .epilogue(
    `\
You are running graphile-migrate v${version}.

Please consider supporting Graphile Migrate development: 

  https://www.graphile.org/sponsor/
`,
  )
  .demandCommand(1, 1, "Please select a command to run.").argv;
