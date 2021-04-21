import { Logger, makeConsoleLogFactory } from "@graphile/logger";

export { LogLevel as MigrateLogLevel } from "@graphile/logger";
export { Logger as MigrateLogger } from "@graphile/logger";
export { LogFunctionFactory as MigrateLogFactory } from "@graphile/logger";
export interface MigrateLogMeta {
  error?: Error;
}

export const defaultMigrateLogger = new Logger(
  makeConsoleLogFactory({
    format: `%s`,
    formatParameters(_level, message) {
      return [message];
    },
  }),
);
