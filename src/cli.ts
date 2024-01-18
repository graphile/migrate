#!/usr/bin/env node
import * as yargs from "yargs";

import { commitCommand } from "./commands/commit";
import { compileCommand } from "./commands/compile";
import { initCommand } from "./commands/init";
import { migrateCommand } from "./commands/migrate";
import { resetCommand } from "./commands/reset";
import { runCommand } from "./commands/run";
import { statusCommand } from "./commands/status";
import { uncommitCommand } from "./commands/uncommit";
import { watchCommand } from "./commands/watch";
import { isLoggedError } from "./lib";
import { version } from "./version";

function wrapHandler<T1, T2>(
  input: yargs.CommandModule<T1, T2>,
): yargs.CommandModule<T1, T2> {
  const { handler, ...rest } = input;

  const newHandler: yargs.CommandModule<T1, T2>["handler"] = async (argv) => {
    try {
      return await Promise.resolve(handler(argv));
    } catch (e) {
      if (!isLoggedError(e)) {
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

const f = yargs
  .parserConfiguration({
    "boolean-negation": true,
    "camel-case-expansion": false,
    "combine-arrays": false,
    "dot-notation": false,
    "duplicate-arguments-array": false,
    "flatten-duplicate-arrays": false,
    "halt-at-non-option": false,
    "parse-numbers": false,
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
  .hide("version")
  .help(true)
  .demandCommand(1, 1, "Please select a command to run.")
  .recommendCommands()

  // Commands
  .command(wrapHandler(initCommand))
  .command(wrapHandler(migrateCommand))
  .command(wrapHandler(watchCommand))
  .command(wrapHandler(commitCommand))
  .command(wrapHandler(uncommitCommand))
  .command(wrapHandler(statusCommand))
  .command(wrapHandler(resetCommand))
  .command(wrapHandler(compileCommand))
  .command(wrapHandler(runCommand))

  // Make sure options added here are represented in CommonArgv
  .option("config", {
    alias: "c",
    type: "string",
    description: "Optional path to gmrc file",
    defaultDescription: ".gmrc[.js|.cjs]",
  })

  .completion("completion", "Generate shell completion script.")
  .epilogue(
    process.env.GRAPHILE_SPONSOR
      ? `\
You are running graphile-migrate v${version}.`
      : `\
You are running graphile-migrate v${version}.

  ╔═══════════════════════════════════╗
  ║ Graphile Migrate is crowd-funded, ║
  ║   please consider sponsorship:    ║
  ║                                   ║
  ║ https://www.graphile.org/sponsor/ ║
  ║                                   ║
  ║     🙏 THANK YOU SPONSORS! 🙏     ║
  ╚═══════════════════════════════════╝
`,
  ).argv;

if ("then" in f && typeof f.then === "function") {
  f.then(null, (e: Error) => {
    // eslint-disable-next-line no-console
    console.error(e);
  });
}
