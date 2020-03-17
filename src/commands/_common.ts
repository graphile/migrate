import { promises as fsp } from "fs";

import { Settings } from "../settings";

export async function getSettings(): Promise<Settings> {
  let data;
  try {
    data = await fsp.readFile(`${process.cwd()}/.gmrc`, "utf8");
  } catch (e) {
    throw new Error(
      "No .gmrc file found; please run `graphile-migrate init` first.",
    );
  }
  try {
    return JSON.parse(data);
  } catch (e) {
    throw new Error("Failed to parse .gmrc file: " + e.message);
  }
}
