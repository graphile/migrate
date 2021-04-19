import { LogFunctionFactory, LogLevel, LogMeta } from "@graphile/logger";

export { LogLevel as MigrateLogLevel } from "@graphile/logger";
export type MigrateLogFactory = LogFunctionFactory<Record<string, unknown>>;
export interface MigrateLogMeta extends LogMeta {
  error?: Error;
}

export const migrateLogFactory: MigrateLogFactory = () => {
  return (level: LogLevel, message: string, meta?: MigrateLogMeta): void => {
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
    meta ? console[method](message, meta) : console[method](message);
  };
};
