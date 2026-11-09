import {
  buildSplitSourceSegments,
  resolveSqlPosition,
} from "../src/sqlSplitSourceMap";

const folderBody = `\
--! Message: test

--! split: 100-first.sql
select 1;

--! split: 200-second.sql
-- line 1 of second
-- line 2 of second
select 1/0;

--! split: 300-third.sql
select 3;
`;

it("maps positions before the first split to the default filename", () => {
  const segments = buildSplitSourceSegments(folderBody, {
    defaultFilename: "current.sql",
    splitBasePath: "migrations/current",
  });
  expect(segments[0]).toMatchObject({
    filename: "current.sql",
    start: 0,
  });
});

it("maps positions in later split files with folder paths", () => {
  const errorChar = folderBody.indexOf("1/0");
  const resolved = resolveSqlPosition(folderBody, errorChar + 1, {
    defaultFilename: "current.sql",
    splitBasePath: "migrations/current",
  });
  expect(resolved.filename).toBe("migrations/current/200-second.sql");
  expect(resolved.line).toBe(3);
  expect(resolved.column).toBe(8);
});

it("falls back to a single segment when there are no split markers", () => {
  const body = "select 1;\nselect 2;\n";
  const segments = buildSplitSourceSegments(body, {
    defaultFilename: "migrations/current.sql",
  });
  expect(segments).toEqual([
    { start: 0, end: body.length, filename: "migrations/current.sql" },
  ]);
});
