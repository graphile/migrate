import * as crypto from "crypto";
import { promises as fsp } from "fs";
import { posix, sep } from "path";
import pgMinify from "pg-minify";

import { isNoTransactionDefined } from "./header";
import { realpathOrNull, walk } from "./lib";
import { getAllMigrations } from "./migration";
import type { ParsedSettings } from "./settings";

interface FileFixture {
  /**
   * The full path to this fixture on disk
   */
  fullPath: string;

  /**
   * The path to this fixture relative to the fixtures folder
   */
  relativePath: string;

  /**
   * A hash of the content of the fixture
   */
  hash: string;

  hasNoTransaction: boolean;

  /**
   * True if the fixture is empty or only comments
   */
  isEmpty: boolean;
}

/**
 * Fixtures in this folder (inside the fixtures folder) that have changed since
 * the last commit are included automatically; creating the folder turns this
 * on. They must be self-contained: no `--!include`.
 *
 * NOTE: only use it for stateless database entities: functions, RLS policies,
 * grants, views, etc - things that can be dropped and recreated almost
 * instantly. Keep stateful entities such as indexes, constraints and
 * materialized views in other fixtures, as dropping and recreating these takes
 * significant time.
 *
 * @experimental
 */
export const AUTO_FIXTURES_FOLDER = "auto";

interface FixturesCache {
  fixtures: {
    [relativePath: string]: Array<{
      filename: string;
      hash: string;
    }>;
  };
}

function hashFixture(fixtureText: string) {
  const minified = pgMinify(fixtureText);
  return crypto
    .createHash("sha1")
    .update(minified.trim() + "\n")
    .digest("hex");
}

const EMPTY_FIXTURE_HASH = hashFixture("");

export async function getLocalFixtures(
  parsedSettings: ParsedSettings,
): Promise<{ [relativePath: string]: FileFixture }> {
  const allFixtures = Object.create(null) as {
    [relativePath: string]: FileFixture;
  };
  const rawAutoPath = `${parsedSettings.migrationsFolder}/fixtures/${AUTO_FIXTURES_FOLDER}`;
  const autoPath = await realpathOrNull(rawAutoPath);
  if (autoPath) {
    await walk(autoPath, async (pathInAuto, ent) => {
      if (ent.name.startsWith(".") || !ent.name.endsWith(".sql")) return;
      const relativePath = `${AUTO_FIXTURES_FOLDER}/${pathInAuto}`;
      const fullPath = ent.parentPath + sep + ent.name;
      const contents = await fsp.readFile(fullPath, "utf8");
      // Nested includes would run shared fixtures more than once.
      if (/^--![ \t]*include\b/m.test(contents)) {
        throw new Error(
          `Automatic fixture '${relativePath}' uses '--!include'; fixtures in '${AUTO_FIXTURES_FOLDER}/' must be self-contained.`,
        );
      }
      const hash = hashFixture(contents);
      allFixtures[relativePath] = {
        fullPath,
        relativePath,
        hash,
        hasNoTransaction: isNoTransactionDefined(contents),
        isEmpty: hash === EMPTY_FIXTURE_HASH,
      };
    });
  }
  return allFixtures;
}

let committedFixturesCache: [ParsedSettings, Promise<FixturesCache>] | null =
  null;
export function clearFixturesCache() {
  committedFixturesCache = null;
}

export function getCommittedFixturesCache(
  parsedSettings: ParsedSettings,
): Promise<FixturesCache> {
  if (committedFixturesCache?.[0] === parsedSettings) {
    return committedFixturesCache[1];
  }
  const promise = _reallyGetCommittedFixturesCache(parsedSettings);
  committedFixturesCache = [parsedSettings, promise];
  return promise;
}

async function _reallyGetCommittedFixturesCache(
  parsedSettings: ParsedSettings,
): Promise<FixturesCache> {
  const cache: FixturesCache = {
    fixtures: Object.create(null) as Record<string, never>,
  };
  const allMigrations = await getAllMigrations(parsedSettings);
  for (const migration of allMigrations) {
    const { filename, body } = migration;
    const re = /(^|\n)--! Included ([^\r\n]+)\r?\n/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) != null) {
      const [, , includePath] = match;
      const i = body.indexOf(`--! EndIncluded ${includePath}`, match.index);
      if (i < 0) throw new Error(`Found Included with no EndIncluded`);
      const content = body.substring(match.index + match[0].length, i).trim();
      // `./auto/x.sql` and `auto/x.sql` are the same fixture.
      const relativePath = posix.normalize(includePath);
      cache.fixtures[relativePath] ??= [];
      const hash = hashFixture(content);
      cache.fixtures[relativePath].push({ filename, hash });
    }
  }
  return cache;
}

export async function getCommittedFixturesState(
  parsedSettings: ParsedSettings,
): Promise<{ [relativePath: string]: string }> {
  const cache = await getCommittedFixturesCache(parsedSettings);
  const state = Object.create(null) as { [relativePath: string]: string };
  for (const relativePath in cache.fixtures) {
    const hash = cache.fixtures[relativePath].at(-1)?.hash;
    if (hash != null) {
      state[relativePath] = hash;
    }
  }
  return state;
}
