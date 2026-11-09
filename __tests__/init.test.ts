jest.unmock("pg");

import "mock-fs"; // MUST BE BEFORE EVERYTHING

import * as fsp from "fs/promises";
import mockFs from "mock-fs";

import { init } from "../src/commands/init";
import { statOrNull } from "../src/lib";

beforeAll(() => {
  // eslint-disable-next-line no-console
  console.log("[mock-fs callsites hack]");
  mockFs({});
});
afterAll(() => {
  mockFs.restore();
});

beforeEach(() => {
  mockFs({});
});
afterEach(() => {
  mockFs.restore();
});

it("creates a current/ folder by default", async () => {
  await init({});

  const dirStats = await statOrNull("migrations/current");
  expect(dirStats?.isDirectory()).toBe(true);

  const fileStats = await statOrNull("migrations/current.sql");
  expect(fileStats).toBeNull();

  const content = await fsp.readFile(
    "migrations/current/1-current.sql",
    "utf8",
  );
  expect(content).toEqual("-- Enter migration here\n");
});

it("creates current.sql when folder is false", async () => {
  await init({ folder: false });

  const dirStats = await statOrNull("migrations/current");
  expect(dirStats).toBeNull();

  const fileStats = await statOrNull("migrations/current.sql");
  expect(fileStats?.isFile()).toBe(true);

  const content = await fsp.readFile("migrations/current.sql", "utf8");
  expect(content).toEqual("-- Enter migration here\n");
});
