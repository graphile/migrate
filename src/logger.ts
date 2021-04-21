import { Logger, makeConsoleLogFactory } from "@graphile/logger";

export const defaultLogger = new Logger(
  makeConsoleLogFactory({
    format: `%s`,
    formatParameters(_level, message) {
      return [message];
    },
  }),
);
