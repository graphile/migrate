import * as crypto from "crypto";
import { promises as fsp } from "fs";
import { posix, sep } from "path";
import pgMinify from "pg-minify";

import { isNoTransactionDefined } from "./header";
import { realpathOrNull, walk } from "./lib";
import { compileIncludes, getAllMigrations } from "./migration";
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
}

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

export async function getLocalFixtures(
  parsedSettings: ParsedSettings,
): Promise<{ [relativePath: string]: FileFixture }> {
  const allFixtures = Object.create(null) as {
    [relativePath: string]: FileFixture;
  };
  const rawFixturesPath = `${parsedSettings.migrationsFolder}/fixtures`;
  const fixturesPath = await realpathOrNull(rawFixturesPath);
  if (fixturesPath) {
    await walk(fixturesPath, async (relativePath, ent) => {
      if (ent.name.startsWith(".") || !ent.name.endsWith(".sql")) return;
      const fullPath = ent.parentPath + sep + ent.name;
      const contents = await fsp.readFile(fullPath, "utf8");
      const compiled = await compileIncludes(
        parsedSettings,
        contents,
        new Set([fullPath]),
      );
      allFixtures[relativePath] = {
        fullPath,
        relativePath,
        hash: hashFixture(compiled),
        hasNoTransaction: isNoTransactionDefined(compiled),
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
