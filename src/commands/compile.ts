import * as fsp from "fs/promises";
import { resolve } from "path";
import { ArgumentsCamelCase, CommandModule } from "yargs";

import { compileIncludes, compilePlaceholders } from "../migration";
import { parseSettings, Settings } from "../settings";
import { CommonArgv, getSettings, readStdin } from "./_common";

interface CompileArgv extends CommonArgv {
  shadow?: boolean;
}

export async function compile(
  settings: Settings,
  content: string,
  filename: string,
  shadow = false,
): Promise<string> {
  const parsedSettings = await parseSettings(settings, shadow);
  const parsedContent = await compileIncludes(
    parsedSettings,
    content,
    new Set([filename]),
  );
  return compilePlaceholders(parsedSettings, parsedContent, shadow);
}

async function readInput(argv: ArgumentsCamelCase<CompileArgv>) {
  if (argv.file != null) {
    if (typeof argv.file === "string") {
      const filename = resolve(argv.file);
      const content = await fsp.readFile(filename, "utf8");
      return { filename, content };
    } else {
      throw new Error(`Unexpected value for "file" flag`);
    }
  } else {
    return { filename: "stdin", content: await readStdin() };
  }
}

export const compileCommand: CommandModule<
  Record<string, never>,
  CompileArgv
> = {
  command: "compile [file]",
  aliases: [],
  describe: `\
Compiles a SQL file, resolving includes, inserting all the placeholders and returning the result to STDOUT`,
  builder: {
    shadow: {
      type: "boolean",
      default: false,
      description: "Apply shadow DB placeholders (for development).",
    },
  },
  handler: async (argv) => {
    const settings = await getSettings({ configFile: argv.config });
    const { content, filename } = await readInput(argv);
    const compiled = await compile(settings, content, filename, argv.shadow);

    // eslint-disable-next-line no-console
    console.log(compiled);
  },
};
