import "./helpers"; // Has side-effects; must come first

import { parseMigrationText } from "../src/migration";

const committed = [
  "--! Previous: -",
  "--! Hash: sha1:0123456789abcdef0123456789abcdef01234567",
  "--! Message: initial",
  "",
  "select 1;",
  "",
].join("\n");

it("parses a committed migration with LF line endings", () => {
  expect(parseMigrationText("000001.sql", committed)).toEqual({
    headers: {
      Previous: "-",
      Hash: "sha1:0123456789abcdef0123456789abcdef01234567",
      Message: "initial",
    },
    body: "select 1;\n",
  });
});

it("explains CRLF line endings in a committed migration", () => {
  expect(() =>
    parseMigrationText("000001.sql", committed.replace(/\n/g, "\r\n")),
  ).toThrow("it looks like the line endings have been corrupted");
});

it("still asks for a blank line after LF headers", () => {
  expect(() =>
    parseMigrationText("000001.sql", committed.replace("\n\n", "\n")),
  ).toThrow("there should be two newlines after the headers section");
});
