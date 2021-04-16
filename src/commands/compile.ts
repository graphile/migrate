import { promises as fsp } from "fs";
import { CommandModule } from "yargs";

import { compilePlaceholders } from "../migration";
import { parseSettings, Settings } from "../settings";
import { CommonOptions, getSettings, readStdin } from "./_common";

interface CompileOptions extends CommonOptions {
  shadow?: boolean;
}

export async function compile(
  settings: Settings,
  content: string,
  shadow = false,
): Promise<string> {
  const parsedSettings = await parseSettings(settings, shadow);
  return compilePlaceholders(parsedSettings, content, shadow);
}

export const compileCommand: CommandModule<{}, CompileOptions> = {
  command: "compile [file]",
  aliases: [],
  describe: `\
Compiles a SQL file, inserting all the placeholders and returning the result to STDOUT`,
  builder: {
    shadow: {
      type: "boolean",
      default: false,
      description: "Apply shadow DB placeholders (for development).",
    },
  },
  handler: async argv => {
    const settings = await getSettings({ configFile: argv.config });
    const content =
      typeof argv.file === "string"
        ? await fsp.readFile(argv.file, "utf8")
        : await readStdin();

    const compiled = await compile(settings, content, argv.shadow);

    // eslint-disable-next-line no-console
    console.log(compiled);
  },
};
