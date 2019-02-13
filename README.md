# graphile-migrate

Opinionated SQL-powered migration tool for PostgreSQL.

## Status

**HIGHLY EXPERIMENTAL** Do not use in production... yet!

## Opinions

- Migrations should be written in familiar SQL
- Iteration should be easy
- Migrating should be _fast_
- Once deployed, databases should be identical (including column order)
- Roll-forward only (production issues should be fixed via additional migrations, development can iterate current migration)
- Once a migration is signed off (deployable) it should never be edited
- Use PostgreSQL
- Development databases are cheap; can run multiple
- Resetting development database is acceptable if necessary (but data preservation should be attempted)
- Production databases are critical - NEVER RESET
- Migrating data (as well as DDL) is acceptable, but should be kept to fast operations (or trigger a background job)
- Migrations should automatically be wrapped in transactions
- Migrations should not pollute PostgreSQL global settings (e.g. use `SET LOCAL` rather than `SET`)
- Migrations that require execution outside of a transaction (e.g. to enable augmenting non-DDL-safe things, such as `ENUM`s in PostgreSQL) should be explicitly marked

## Setup

`graphile-migrations` requires two databases: the first is your main database
against which you perform development, the second is a "shadow" database
which is used by the system to apply migrations. You should never interact
with the "shadow" database manually. Further all members of your team should
run the same PostgreSQL version to ensure that the shadow dump matches for
everyone.

## Usage

`graphile-migrate init` will ask you some questions and set up the relevant
files for running graphile-migrate.

`graphile-migrate import` can be used after init but before running any other
commands in order to import the existing database as if it were the first
migration.

`graphile-migrate watch` will watch the new migration file,
re-running it's SQL on any change. This file should be idempotent (this is
your responsibility); i.e. it should be able to be ran multiple times and
have the same result. Further, they should use `CASCADE` so that if other
migrations are worked on in parallel no additional `rollback` step is
required. Examples of idempotent operations:

```
-- Create a schema
DROP SCHEMA IF EXISTS app CASCADE;
CREATE SCHEMA app;

-- Create a table
DROP TABLE IF EXISTS foo CASCADE;
CREATE TABLE foo ...;

-- Add a column to the end of the table
ALTER TABLE foo DROP COLUMN IF EXISTS bar CASCADE;
ALTER TABLE foo ADD COLUMN foo ...;

-- Make a column NOT NULL
ALTER TABLE foo ALTER COLUMN foo SET NOT NULL;

-- Alter a column type
ALTER TABLE foo ALTER COLUMN foo TYPE int USING foo::int;

-- Change the body or flags of a function
CREATE OR REPLACE FUNCTION ...;

-- Change a function signature (arguments, return type, etc)
DROP FUNCTION IF EXISTS ... CASCADE;
CREATE OR REPLACE FUNCTION ...
```

`graphile-migrate check` will:

- reset the shadow database to the latest dump
- apply the current migration to the shadow database, and output a SQL schema diff you can use to ensure no accidental changes have been made

When you're happy, `graphile-migrate commit` will:

- reset the shadow database to the latest dump
- apply the current migration to the shadow database, and replace the dump
- move the current migration to committed migrations (adding a hash to prevent tampering)

## Collaboration

Developers can work on different migrations in parallel, and can switch
between branches - idempotent migrations using `CASCADE`
when dropping should make it possible to do this with little issue (other
than the implicit data loss of dropping tables/columns/etc).

Migration commit, on the other hand, should be linear - one way to approach
this is to only commit a migration immediately before it is merged to
`master`. Another approach is to do the commit on `master` itself. Non-linear
migration commits will result in errors, and may lead to you resetting your
development database.
