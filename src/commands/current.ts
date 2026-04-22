import { CommandModule } from "yargs";

import { getCurrentMigrationLocation, writeCurrentMigration } from "../current";
import { makeCurrentMigrationRunner } from "../currentRunner";
import { parseSettings, Settings } from "../settings";
import type { CommonArgv } from "./_common";
import { getSettings } from "./_common";
import { _migrate } from "./migrate";

interface CurrentArgv extends CommonArgv {
  shadow?: boolean;
  forceActions?: boolean;
}

export async function current(
  settings: Settings,
  options: Partial<CurrentArgv> = {},
): Promise<void> {
  const { shadow = false, forceActions = false } = options;
  const parsedSettings = await parseSettings(settings, shadow);
  await _migrate(parsedSettings, shadow);

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);
  if (!currentLocation.exists) {
    await writeCurrentMigration(
      parsedSettings,
      currentLocation,
      parsedSettings.blankMigrationContent.trim() + "\n",
    );
  }

  const run = makeCurrentMigrationRunner(parsedSettings, {
    once: true,
    shadow,
    forceActions,
  });
  return run();
}

export const currentCommand: CommandModule<
  Record<string, never>,
  CurrentArgv
> = {
  command: "current",
  aliases: [],
  describe:
    "Runs any un-executed committed migrations, as well as the current migration. For development.",
  builder: {
    shadow: {
      type: "boolean",
      default: false,
      description: "Apply migrations to the shadow DB (for development).",
    },
    forceActions: {
      type: "boolean",
      default: false,
      description:
        "Run beforeAllMigrations and afterAllMigrations actions even if no migration was necessary.",
    },
  },
  handler: async (argv) => {
    const settings = await getSettings({ configFile: argv.config });
    await current(settings, argv);
  },
};
