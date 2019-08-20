import * as path from "path";

export const readFile = jest.fn(
  async filepath => `[CONTENT:${path.relative(process.cwd(), filepath)}]`
);
