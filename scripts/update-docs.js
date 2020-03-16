#!/usr/bin/env node
const { promises: fsp } = require("fs");
const { spawnSync } = require("child_process");

async function main() {
  const readmePath = `${__dirname}/../README.md`;
  const readme = await fsp.readFile(readmePath, "utf8");
  const { stdout: usage } = await spawnSync("bash", [`${__dirname}/usage`], {
    encoding: "utf8",
  });
  await fsp.writeFile(
    readmePath,
    readme.replace(
      /(<!-- CLI_USAGE_BEGIN -->)[\s\S]*(<!-- CLI_USAGE_END -->)/,
      (_, start, fin) => `${start}\n${usage.trim()}\n${fin}`,
    ),
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
