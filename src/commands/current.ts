import { CommandModule } from "yargs";

import { getCurrentMigrationLocation, writeCurrentMigration } from "../current";
import { ParsedSettings, parseSettings, Settings } from "../settings";
import { CommonArgv, getSettings } from "./_common";
import { _migrate } from "./migrate";
import { _makeCurrentMigrationRunner } from "./watch";

interface CurrentArgv extends CommonArgv {
  shadow: boolean;
  forceActions: boolean;
}

export async function _current(
  parsedSettings: ParsedSettings,
  shadow = false,
  forceActions = false,
): Promise<void> {
  await _migrate(parsedSettings, shadow);

  const currentLocation = await getCurrentMigrationLocation(parsedSettings);
  if (!currentLocation.exists) {
    await writeCurrentMigration(
      parsedSettings,
      currentLocation,
      parsedSettings.blankMigrationContent.trim() + "\n",
    );
  }

  const run = _makeCurrentMigrationRunner(
    parsedSettings,
    false,
    shadow,
    forceActions,
  );
  return run();
}

export async function current(
  settings: Settings,
  shadow = false,
  forceActions = false,
): Promise<void> {
  const parsedSettings = await parseSettings(settings, shadow);
  return _current(parsedSettings, shadow, forceActions);
}

export const currentCommand: CommandModule<never, CurrentArgv> = {
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
  handler: async argv => {
    await current(
      await getSettings({ configFile: argv.config }),
      argv.shadow,
      argv.forceActions,
    );
  },
};
