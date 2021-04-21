import { LogFunctionFactory, Logger, LogLevel } from "@graphile/logger";

export { LogLevel as MigrateLogLevel } from "@graphile/logger";
export { Logger as MigrateLogger } from "@graphile/logger";
export type MigrateLogFactory = LogFunctionFactory<Record<string, unknown>>;
export interface MigrateLogMeta {
  error?: Error;
}

const migrateLogFactory: MigrateLogFactory = () => {
  return (level: LogLevel, message: string): void => {
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const method = (() => {
      switch (level) {
        case LogLevel.ERROR:
          return "error" as const;
        case LogLevel.WARNING:
          return "warn" as const;
        case LogLevel.INFO:
        default:
          return "log" as const;
      }
    })();

    // eslint-disable-next-line no-console
    console[method](message);
  };
};

export const defaultMigrateLogger = new Logger(migrateLogFactory);
