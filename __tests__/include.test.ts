import "./helpers";

import * as mockFs from "mock-fs";

import { compileIncludes } from "../src/migration";
import { ParsedSettings, parseSettings } from "../src/settings";

let old: string | undefined;
let settings: ParsedSettings;
beforeAll(async () => {
  old = process.env.DATABASE_AUTHENTICATOR;
  process.env.DATABASE_AUTHENTICATOR = "dbauth";
  settings = await parseSettings({
    connectionString: "postgres://dbowner:dbpassword@dbhost:1221/dbname",
    placeholders: {
      ":DATABASE_AUTHENTICATOR": "!ENV",
    },
    migrationsFolder: 'migrations'
  });
});
afterAll(() => {
  process.env.DATABASE_AUTHENTICATOR = old;
});

afterEach(() => {
  mockFs.restore();
});


it("compiles an included file", async () => {
  mockFs({
    "migrations/fixtures/foo.sql": "select * from foo;",
  });
  expect(
    await compileIncludes(
      settings,
      `\
--!include foo.sql
`,
    ),
  ).toEqual(`\
select * from foo;
`);
});

it("compiles multiple included files", async () => {
  mockFs({
    "migrations/fixtures/dir1/foo.sql": "select * from foo;",
    "migrations/fixtures/dir2/bar.sql": "select * from bar;",
    "migrations/fixtures/dir3/baz.sql": "--!include dir4/qux.sql",
    "migrations/fixtures/dir4/qux.sql": "select * from qux;",
  });
  expect(
    await compileIncludes(
      settings,
      `\
--!include dir1/foo.sql
--!include dir2/bar.sql
--!include dir3/baz.sql
`,
    ),
  ).toEqual(`\
select * from foo;
select * from bar;
select * from qux;
`);
});

it("compiles an included file, and won't get stuck in an infinite include loop", async () => {
  mockFs({
    "migrations/fixtures/foo.sql": "select * from foo;--!include foo.sql",
  });
  expect(
    await compileIncludes(
      settings,
      `\
--!include foo.sql
`,
    ),
  ).toEqual(`\
select * from foo;
`);
});

/*it("disallows calling files outside of the migrations/fixtures folder", async () => {
  mockFs({
    "migrations/fixtures/bar.sql": "",
    "outsideFolder/foo.sql": "select * from foo;",
  });
  expect(() => {
    compileIncludes(
      settings,
      `\
--!include ../../outsideFolder/foo.sql
`,
    )},
  ).toThrow();
});*/