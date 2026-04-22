import "./helpers";

import mockFs from "mock-fs";

import { compile } from "../src";
let old: string | undefined;
const settings = {
  connectionString: "postgres://dbowner:dbpassword@dbhost:1221/dbname",
  placeholders: {
    ":DATABASE_AUTHENTICATOR": "!ENV",
  },
};
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
      settings,
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

it("will compile included files", async () => {
  mockFs({
    "migrations/fixtures/foo.sql": "select * from foo;",
  });
  expect(
    await compile(
      settings,
      `\
select 1;
--!include foo.sql
select 2;
`,
      { filename: `${process.cwd()}/migrations/current.sql` },
    ),
  ).toEqual(`\
select 1;
select * from foo;
select 2;
`);
});
