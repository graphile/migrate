import * as chokidar from "chokidar";
import { withClient } from "../pg";
import {
  Settings,
  ParsedSettings,
  parseSettings,
  getCurrentMigrationPath,
  BLANK_MIGRATION_CONTENT,
} from "../settings";
import * as fsp from "../fsp";
import { runStringMigration } from "../migration";
import { executeActions } from "../actions";
import { _migrate } from "./migrate";
import { logDbError } from "../instrumentation";

export async function watch(settings: Settings, once = false, shadow = false) {
  const parsedSettings = await parseSettings(settings, shadow);
  return _watch(parsedSettings, once, shadow);
}

export async function _watch(
  parsedSettings: ParsedSettings,
  once = false,
  shadow = false
) {
  await _migrate(parsedSettings, shadow);
  // Watch the file
  const currentMigrationPath = getCurrentMigrationPath(parsedSettings);
  try {
    await fsp.stat(currentMigrationPath);
  } catch (e) {
    if (e.code === "ENOENT") {
      await fsp.writeFile(currentMigrationPath, BLANK_MIGRATION_CONTENT);
    } else {
      throw e;
    }
  }
  async function run() {
    try {
      const body = await fsp.readFile(currentMigrationPath, "utf8");
      // tslint:disable-next-line no-console
      console.log(`[${new Date().toISOString()}]: Running current.sql`);
      const start = process.hrtime();
      const connectionString = shadow
        ? parsedSettings.shadowConnectionString
        : parsedSettings.connectionString;
      if (!connectionString) {
        throw new Error(
          "Could not determine connection string for running commands"
        );
      }
      await withClient(connectionString, parsedSettings, (pgClient, context) =>
        runStringMigration(
          pgClient,
          parsedSettings,
          context,
          body,
          "current.sql"
        )
      );
      const interval = process.hrtime(start);
      const duration = interval[0] * 1e3 + interval[1] * 1e-6;
      await executeActions(parsedSettings, shadow, parsedSettings.afterCurrent);
      const interval2 = process.hrtime(start);
      const duration2 = interval2[0] * 1e3 + interval2[1] * 1e-6;
      // tslint:disable-next-line no-console
      console.log(
        `[${new Date().toISOString()}]: Finished (${duration2.toFixed(0)}ms${
          duration2 - duration >= 5
            ? `; excluding actions: ${duration.toFixed(0)}ms`
            : ""
        })`
      );
    } catch (e) {
      logDbError(e);
    }
  }
  if (once) {
    return run();
  } else {
    let running = false;
    let runAgain = false;
    const queue = () => {
      if (running) {
        runAgain = true;
      }
      running = true;

      return run().finally(() => {
        running = false;
        if (runAgain) {
          runAgain = false;
          queue();
        }
      });
    };
    const watcher = chokidar.watch(currentMigrationPath);
    watcher.on("change", queue);
    queue();
    return Promise.resolve();
  }
}
