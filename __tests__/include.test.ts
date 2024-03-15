import "./helpers";

import mockFs from "mock-fs";

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
    migrationsFolder: "migrations",
  });
});
afterAll(() => {
  process.env.DATABASE_AUTHENTICATOR = old;
});

afterEach(() => {
  mockFs.restore();
});

/** Pretents that our compiled files are 'current.sql' */
const FAKE_VISITED = new Set([`${process.cwd()}/migrations/current.sql`]);

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
      FAKE_VISITED,
    ),
  ).toEqual(`\
--! Include foo.sql
select * from foo;
--! EndInclude foo.sql
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
      FAKE_VISITED,
    ),
  ).toEqual(`\
--! Include dir1/foo.sql
select * from foo;
--! EndInclude dir1/foo.sql
--! Include dir2/bar.sql
select * from bar;
--! EndInclude dir2/bar.sql
--! Include dir3/baz.sql
--! Include dir4/qux.sql
select * from qux;
--! EndInclude dir4/qux.sql
--! EndInclude dir3/baz.sql
`);
});

it("compiles an included file, and won't get stuck in an infinite include loop", async () => {
  mockFs({
    "migrations/fixtures/foo.sql": "select * from foo;\n--!include foo.sql",
  });
  const promise = compileIncludes(
    settings,
    `\
--!include foo.sql
`,
    FAKE_VISITED,
  );
  await expect(promise).rejects.toThrowError(/Circular include/);
  const message = await promise.catch((e) => e.message);
  expect(message.replaceAll(process.cwd(), "~")).toMatchSnapshot();
});

it("disallows calling files outside of the migrations/fixtures folder", async () => {
  mockFs({
    "migrations/fixtures/bar.sql": "",
    "outsideFolder/foo.sql": "select * from foo;",
  });

  const promise = compileIncludes(
    settings,
    `\
--!include ../../outsideFolder/foo.sql
`,
    FAKE_VISITED,
  );
  await expect(promise).rejects.toThrowError(/Forbidden: cannot include/);
  const message = await promise.catch((e) => e.message);
  expect(message.replaceAll(process.cwd(), "~")).toMatchSnapshot();
});

it("compiles an included file that contains escapable things", async () => {
  mockFs({
    "migrations/fixtures/foo.sql": `\
begin;

create or replace function current_user_id() returns uuid as $$
  select nullif(current_setting('user.id', true)::text, '')::uuid;
$$ language sql stable;

comment on function current_user_id is E'The ID of the current user.';

grant all on function current_user_id to :DATABASE_USER;

commit;
`,
  });
  expect(
    await compileIncludes(
      settings,
      `\
--!include foo.sql
`,
      FAKE_VISITED,
    ),
  ).toEqual(`\
--! Include foo.sql
begin;

create or replace function current_user_id() returns uuid as $$
  select nullif(current_setting('user.id', true)::text, '')::uuid;
$$ language sql stable;

comment on function current_user_id is E'The ID of the current user.';

grant all on function current_user_id to :DATABASE_USER;

commit;
--! EndInclude foo.sql
`);
});
