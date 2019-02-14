import * as fs from "fs";
import { promisify } from "util";

export const readFile = promisify(fs.readFile);
export const writeFile = promisify(fs.writeFile);
export const stat = promisify(fs.stat);
export const readdir = promisify(fs.readdir);
export const mkdir = promisify(fs.mkdir);
