import "./helpers";

import { compile } from "../src";

let old: string | undefined;
beforeAll(() => {
  old = process.env.DATABASE_AUTHENTICATOR;
  process.env.DATABASE_AUTHENTICATOR = "dbauth";
});
afterAll(() => {
  process.env.DATABASE_AUTHENTICATOR = old;
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
