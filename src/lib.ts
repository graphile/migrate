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
