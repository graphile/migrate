export interface Settings {
  connectionString: string;
  shadowConnectionString: string;
  pgSettings?: {
    [key: string]: string;
  };
}

export interface ParsedSettings extends Settings {
  migrationsFolder: string;
}

export function parseSettings(settings: Settings): ParsedSettings {
  const migrationsFolder = `${process.cwd()}/migrations`;
  if (!settings) {
    throw new Error("Expected settings object");
  }
  if (typeof settings !== "object") {
    throw new Error("Expected settings object, received " + typeof settings);
  }
  // tslint:disable no-string-literal
  if (typeof settings.connectionString !== "string") {
    throw new Error("Expected settings.connectionString to be a string");
  }
  if (typeof settings.shadowConnectionString !== "string") {
    throw new Error("Expected settings.shadowConnectionString to be a string");
  }
  const pgSettings = settings!["pgSettings"];
  if (pgSettings) {
    if (typeof pgSettings !== "object") {
      throw new Error("Expected settings.pgSettings to be an object");
    }
    const badKeys = Object.keys(pgSettings).filter(key => {
      const value = pgSettings[key];
      return typeof value !== "string" && typeof value !== "number";
    });
    if (badKeys.length) {
      throw new Error(
        `Invalid pgSettings for keys '${badKeys.join(
          ", "
        )}' - expected string` /* Number is acceptable, but prefer string. Boolean not acceptable. */
      );
    }
  }
  // tslint:enable no-string-literal
  return {
    ...settings,
    migrationsFolder,
  };
}
