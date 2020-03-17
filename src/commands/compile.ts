import { promises as fsp } from "fs";
import { CommandModule } from "yargs";

import { compilePlaceholders } from "../migration";
import { parseSettings, Settings } from "../settings";
import { getSettings, readStdin } from "./_common";

export async function compile(
  settings: Settings,
  content: string,
  shadow = false,
): Promise<string> {
  const parsedSettings = await parseSettings(settings, shadow);
  return compilePlaceholders(parsedSettings, content, shadow);
}

export const compileCommand: CommandModule<{}, {}> = {
  command: "compile [file]",
  aliases: [],
  describe: `\
Compiles a SQL file, inserting all the placeholders and returning the result to STDOUT`,
  builder: {},
  handler: async argv => {
    const settings = await getSettings();
    const content =
      typeof argv.file === "string"
        ? await fsp.readFile(argv.file, "utf8")
        : await readStdin();

    const compiled = await compile(settings, content);

    // eslint-disable-next-line no-console
    console.log(compiled);
  },
};
