import { promises as fsp, Stats } from "fs";

export function mergeWithoutClobbering(
  original: { [key: string]: string | undefined },
  newStuff: { [key: string]: string | undefined },
  message: string,
): { [key: string]: string | undefined } {
  const result = { ...original };
  for (const key in newStuff) {
    if (typeof result[key] === "undefined" || result[key] === newStuff[key]) {
      result[key] = newStuff[key];
    } else {
      throw new Error(
        `Refusing to clobber '${key}' (from '${original[key]}' to '${newStuff[key]}'): ${message}`,
      );
    }
  }

  return result;
}

export function isLoggedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "_gmlogged" in error &&
    error._gmlogged === true
  );
}

export function errorCode(e: unknown): string | null {
  return typeof e === "object" &&
    e !== null &&
    "code" in e &&
    typeof e.code === "string"
    ? e.code
    : null;
}

export async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await fsp.stat(path);
  } catch (e) {
    if (errorCode(e) === "ENOENT") {
      return null;
    }
    throw e;
  }
}

export async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await fsp.readFile(path, "utf8");
  } catch (e) {
    if (errorCode(e) === "ENOENT") {
      return null;
    }
    throw e;
  }
}

export async function readFileOrError(path: string): Promise<string> {
  try {
    return await fsp.readFile(path, "utf8");
  } catch (e) {
    throw new Error(
      `Failed to read file at '${path}': ${
        e instanceof Error ? e.message : String(e)
      }`,
      { cause: e },
    );
  }
}

export async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await fsp.realpath(path);
  } catch {
    return null;
  }
}
