import * as path from "path";

export const readFile = jest.fn(filepath =>
  Promise.resolve(`[CONTENT:${path.relative(process.cwd(), filepath)}]`)
);

const { writeFile, stat, readdir, mkdir, unlink } = jest.genMockFromModule(
  "../fsp"
);
export { writeFile, stat, readdir, mkdir, unlink };
