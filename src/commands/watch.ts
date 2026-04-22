import * as chokidar from "chokidar";
import { CommandModule } from "yargs";

import {
  getCurrentMigrationLocation,
  makeCurrentMigrationRunner,
  writeCurrentMigration,
} from "../current";
import { isLoggedError } from "../lib";
import { ParsedSettings, parseSettings, Settings } from "../settings";
import { CommonArgv, getSettings } from "./_common";
import { _migrate } from "./migrate";

interface WatchArgv extends CommonArgv {
  once: boolean;
  shadow: boolean;
}

export async function _watch(
  parsedSettings: ParsedSettings,
  once = false,
  shadow = false,
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

  const run = makeCurrentMigrationRunner(parsedSettings, { once, shadow });
  if (once) {
    return run();
  } else {
    let running = false;
    let runAgain = false;
    const queue = (): void => {
      if (running) {
        runAgain = true;
      }
      running = true;

      run()
        .catch((error: unknown) => {
          if (!isLoggedError(error)) {
            parsedSettings.logger.error(
              `Error occurred whilst processing migration: ${error instanceof Error ? error.message : String(error)}`,
              { error },
            );
          }
        })
        .finally(() => {
          running = false;
          if (runAgain) {
            runAgain = false;
            queue();
          }
        });
    };
    const watcher = chokidar.watch(
      [currentLocation.path, `${parsedSettings.migrationsFolder}/fixtures`],
      {
        /*
         * Without `usePolling`, on Linux, you can prevent the watching from
         * working by issuing `git stash && sleep 2 && git stash pop`. This is
         * annoying.
         */
        usePolling: true,

        /*
         * Some editors stream the writes out a little at a time, we want to wait
         * for the write to finish before triggering.
         */
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100,
        },

        /*
         * We don't want to run the queue too many times during startup; so we
         * call it once on the 'ready' event.
         */
        ignoreInitial: true,
      },
    );
    watcher.on("add", queue);
    watcher.on("change", queue);
    watcher.on("unlink", queue);
    watcher.once("ready", queue);
    return Promise.resolve();
  }
}

export async function watch(
  settings: Settings,
  once = false,
  shadow = false,
): Promise<void> {
  const parsedSettings = await parseSettings(settings, shadow);
  return _watch(parsedSettings, once, shadow);
}

export const watchCommand: CommandModule<Record<string, never>, WatchArgv> = {
  command: "watch",
  aliases: [],
  describe:
    "Runs any un-executed committed migrations and then runs and watches the current migration, re-running it on any change. For development.",
  builder: {
    once: {
      type: "boolean",
      default: false,
      description: "Runs the current migration and then exits.",
    },
    shadow: {
      type: "boolean",
      default: false,
      description: "Applies changes to shadow DB.",
    },
  },
  handler: async (argv) => {
    await watch(
      await getSettings({ configFile: argv.config }),
      argv.once,
      argv.shadow,
    );
  },
};
