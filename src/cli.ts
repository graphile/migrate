#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type,no-console */
import * as fs from "fs";
import { migrate, watch, reset, commit, status } from "./index";

function getSettings() {
  let data;
  try {
    data = fs.readFileSync(`${process.cwd()}/.gmrc`, "utf8");
  } catch (e) {
    throw new Error(
      "No .gmrc file found; please run `graphile-migrate init` first."
    );
  }
  try {
    return JSON.parse(data);
  } catch (e) {
    throw new Error("Failed to parse .gmrc file: " + e.message);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const [cmd] = argv;
  if (argv.length === 0 || cmd === "migrate") {
    const shadow = argv.includes("--shadow");
    const force = argv.includes("--force");
    await migrate(getSettings(), shadow, force);
  } else if (cmd === "watch") {
    const once = argv.includes("--once");
    const shadow = argv.includes("--shadow");
    await watch(getSettings(), once, shadow);
  } else if (cmd === "reset") {
    const shadow = argv.includes("--shadow");
    await reset(getSettings(), shadow);
  } else if (cmd === "commit") {
    await commit(getSettings());
  } else if (cmd === "status") {
    let exitCode = 0;
    const details = await status(getSettings());
    const remainingCount = details.remainingMigrations.length;
    if (remainingCount) {
      console.log(
        `There are ${remainingCount} committed migrations pending:\n\n  ${details.remainingMigrations.join(
          "\n  "
        )}`
      );
      exitCode += 1;
    }
    if (details.hasCurrentMigration) {
      if (exitCode) {
        console.log();
      }
      console.log(
        "The current.sql migration is not empty and has not been committed."
      );
      exitCode += 2;
    }

    // ESLint false positive.
    // eslint-disable-next-line require-atomic-updates
    process.exitCode = exitCode;

    if (exitCode === 0) {
      console.log("Up to date.");
    }
  } else {
    // eslint-disable-next-line no-console
    console.error(`Command '${cmd || ""}' not understood`);
    process.exit(1);
  }
}

main().catch(e => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
