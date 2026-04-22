import { CommandModule } from "yargs";

import { compileIncludes, compilePlaceholders } from "../migration";
import { parseSettings, Settings } from "../settings";
import { CommonArgv, getSettings, readFileOrStdin } from "./_common";

interface CompileArgv extends CommonArgv {
  shadow?: boolean;
}

interface CompileOptions {
  shadow?: boolean;
  filename?: string;
}

function resolveOptions(options: CompileOptions | boolean) {
  return typeof options === "boolean" ? { shadow: options } : options;
}

export async function compile(
  settings: Settings,
  rawContent: string,
  options: boolean | CompileOptions = false,
): Promise<string> {
  const { shadow = false, filename = "unknown" } = resolveOptions(options);
  const parsedSettings = await parseSettings(settings, shadow);
  const content = await compileIncludes(
    parsedSettings,
    rawContent,
    new Set([filename]),
  );
  return compilePlaceholders(parsedSettings, content, shadow);
}

export const compileCommand: CommandModule<
  Record<string, never>,
  CompileArgv
> = {
  command: "compile [file]",
  aliases: [],
  describe: `\
Compiles a SQL file (resolving \`--!includes\`, replacing :PLACEHOLDERs, etc) and outputs the result to STDOUT`,
  builder: {
    shadow: {
      type: "boolean",
      default: false,
      description: "Apply shadow DB placeholders (for development).",
    },
  },
  handler: async (argv) => {
    const settings = await getSettings({ configFile: argv.config });
    const { content, filename } = await readFileOrStdin(argv.file);
    const compiled = await compile(settings, content, {
      shadow: argv.shadow,
      filename,
    });
    // eslint-disable-next-line no-console
    console.log(compiled);
  },
};
