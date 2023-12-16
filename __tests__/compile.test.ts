import "./helpers";

import * as mockFs from "mock-fs";

import { compile } from "../src";
let old: string | undefined;
beforeAll(() => {
  old = process.env.DATABASE_AUTHENTICATOR;
  process.env.DATABASE_AUTHENTICATOR = "dbauth";
});
afterAll(() => {
  process.env.DATABASE_AUTHENTICATOR = old;
});

afterEach(() => {
  mockFs.restore();
});

it("compiles SQL with settings", async () => {
  expect(
    await compile(
      {
        connectionString: "postgres://dbowner:dbpassword@dbhost:1221/dbname",
        placeholders: {
          ":DATABASE_AUTHENTICATOR": "!ENV",
        },
      },
      `\
BEGIN;
GRANT CONNECT ON DATABASE :DATABASE_NAME TO :DATABASE_OWNER;
GRANT CONNECT ON DATABASE :DATABASE_NAME TO :DATABASE_AUTHENTICATOR;
GRANT ALL ON DATABASE :DATABASE_NAME TO :DATABASE_OWNER;

-- Some extensions require superuser privileges, so we create them before migration time.
CREATE EXTENSION IF NOT EXISTS plpgsql WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
COMMIT;
`,
    ),
  ).toEqual(`\
BEGIN;
GRANT CONNECT ON DATABASE dbname TO dbowner;
GRANT CONNECT ON DATABASE dbname TO dbauth;
GRANT ALL ON DATABASE dbname TO dbowner;

-- Some extensions require superuser privileges, so we create them before migration time.
CREATE EXTENSION IF NOT EXISTS plpgsql WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
COMMIT;
`);
});

it("compiles an included file", async () => {
  mockFs({
    "foo.sql": "select * from foo;",
  });
  expect(
    await compile(
      {
        connectionString: "postgres://dbowner:dbpassword@dbhost:1221/dbname",
        placeholders: {
          ":DATABASE_AUTHENTICATOR": "!ENV",
        },
      },
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
    "foo.sql": "select * from foo;",
    "bar.sql": "select * from bar;",
    "baz.sql": "select * from baz;",
  });
  expect(
    await compile(
      {
        connectionString: "postgres://dbowner:dbpassword@dbhost:1221/dbname",
        placeholders: {
          ":DATABASE_AUTHENTICATOR": "!ENV",
        },
      },
      `\
--!include foo.sql
--!include bar.sql
--!include baz.sql
`,
    ),
  ).toEqual(`\
select * from foo;
select * from bar;
select * from baz;
`);
});
