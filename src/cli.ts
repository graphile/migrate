#!/usr/bin/env node
import * as fs from "fs";
import { migrate, watch, reset } from "./index";

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
    await migrate(getSettings());
  } else if (cmd === "watch") {
    await watch(getSettings());
  } else if (cmd === "reset") {
    await reset(getSettings());
  } else {
    // tslint:disable-next-line no-console
    console.error(`Command '${cmd || ""}' not understood`);
    process.exit(1);
  }
}

main().catch(e => {
  // tslint:disable-next-line no-console
  console.error(e);
  process.exit(1);
});
