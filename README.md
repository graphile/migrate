# graphile-migrate

[![Discord chat room](https://img.shields.io/discord/489127045289476126.svg)](http://discord.gg/graphile)
[![Package on npm](https://img.shields.io/npm/v/graphile-migrate.svg?style=flat)](https://www.npmjs.com/package/graphile-migrate)
![MIT license](https://img.shields.io/npm/l/graphile-migrate.svg)
[![Follow](https://img.shields.io/badge/twitter-@GraphileHQ-blue.svg)](https://twitter.com/GraphileHQ)

Opinionated SQL-powered productive roll-forward migration tool for PostgreSQL.

## Crowd-funded open-source software

To help us develop this software sustainably under the MIT license, we ask
all individuals and businesses that use it to help support its ongoing
maintenance and development via sponsorship.

### [Click here to find out more about sponsors and sponsorship.](https://www.graphile.org/sponsor/)

And please give some love to our featured sponsors 🤩:

<table><tr>
<td align="center"><a href="http://chads.website/"><img src="https://www.graphile.org/images/sponsors/chadf.png" width="90" height="90" alt="Chad Furman" /><br />Chad Furman</a></td>
<td align="center"><a href="https://timescale.com/"><img src="https://www.graphile.org/images/sponsors/timescale.svg" width="90" height="90" alt="Timescale" /><br />Timescale</a></td>
</tr></table>

## Why?

- fast iteration speed — save a file and database is updated in milliseconds
- roll-forward only — maintaining rollbacks is a chore, and in 10 years of API
  development I've never ran one in production
- familiar — no custom DSL to learn, just use PostgreSQL syntax
- fully functional — sending SQL commands directly to PostgreSQL means you can
  use all of PostgreSQL's features
- complements [PostGraphile](https://graphile.org/postgraphile/) — works with
  any application, but PostGraphile's watch mode means that the GraphQL schema
  is instantly regenerated (without server restart) whenever the database
  changes

## Status

**HIGHLY EXPERIMENTAL**

If you're a sponsor and you're using this software, let me know so I can
justify allocating additional time to it.

The interface is raw and doesn't ask for confirmation (e.g. the
`graphile-migrate reset` command will drop and re-create that database without
asking for confirmation).

There are no automated tests yet, and APIs may still change. (Pull requests to
add tests welcome!)

Using this for prototyping should be fine, but when it comes to shipping you
may want to

- help us write tests and finalise interfaces
- send us money to do the same
- use an alternative migration framework, such as:
  - [db-migrate](https://db-migrate.readthedocs.io/en/latest/Getting%20Started/commands/)
  - [sqitch](https://sqitch.org/)
  - [Flyway](https://flywaydb.org/)
  - [migra](https://github.com/djrobstep/migra)

## Opinions

- Local iteration should be easy and _fast_
- Migrating should be fast
- Once deployed, databases should be identical (including subtleties such as column order)
- Migration software should not be tied to a particular application stack
- Migrations should be written in SQL
- Roll-forward only (production issues should be fixed via additional migrations, development can iterate current migration)
- Once a migration is signed off (deployable) it should never be edited
- Use PostgreSQL ;)
- Development databases are cheap; can run multiple
- Resetting development database is acceptable if absolutely necessary
- Production databases are critical - NEVER RESET
- Migrating data (as well as DDL) is acceptable, but should be kept to fast operations (or trigger a background job)
- Migrations should automatically be wrapped in transactions by default
- Migrations that require execution outside of a transaction (e.g. to enable augmenting non-DDL-safe things, such as `ENUM`s in PostgreSQL) should be explicitly marked
- Migrations should not pollute PostgreSQL global settings (e.g. use `SET LOCAL` rather than `SET`)
- Roles should be managed outside of migrations (since they can be shared between databases)
- Certain schemas are managed by other tools and should not be interfered with; e.g. `graphile_jobs`

## Setup

`graphile-migrations` requires two databases: the first is your main database
against which you perform development, the second is a "shadow" database
which is used by the system to apply migrations. You should never interact
with the "shadow" database directly. Further all members of your team should
run the same PostgreSQL version to ensure that the shadow dump matches for
everyone (one way of achieving this is through Docker, but that isn't
required).

## Usage

### `graphile-migrate migrate [--shadow] [--force]`

Runs any un-executed committed migrations. Does **not** run `current.sql`. For use in production and development.

If `--shadow` is specified, migrates the shadow database instead.

If `--force` is specified, it will run any `afterAllMigrations` actions even if no migrations are actually ran.

### `graphile-migrate watch [--shadow] [--once]`

Runs any un-executed committed migrations and then runs and watches
`current.sql`, re-running its contents on any change.

`current.sql` should be idempotent (this is your responsibility, see
"Idempotency" below); i.e. it should be able to be ran multiple times and have
the same result.

If `--shadow` is specified, changes will be applied against the shadow database instead.

If `--once` is specified, `current.sql` will be ran once and then the command will exit.

### `graphile-migrate commit`

- reset the shadow database to the latest dump
- apply the current migration to the shadow database, and replace the dump
- move the current migration to committed migrations (adding a hash to prevent tampering)

### `graphile-migrate reset [--shadow]`

Drop and re-create the database, and re-run all the committed migrations from the start. **HIGHLY DESTRUCTIVE**

If `--shadow` is specified, the shadow database will be reset rather than the main database.

### `graphile-migrate status`

[EXPERIMENTAL!]

Exits with a bitmap status code indicating statuses:

- 1 if there are committed migrations that have not been executed yet
- 2 if the `current.sql` file is non-empty (ignoring comments)

If both of the above are true then the output status will be 3 (1+2). If
neither are true, exit status will be 0 (success).

Also outputs helpful messages:

```
There are 3 committed migrations pending:

  000001.sql
  000002.sql
  000003.sql

The current.sql migration is not empty and has not been committed.
```

## Library usage

It's possible to consume this module as a JavaScript library rather than via
the CLI. There's no documentation on this, but the CLI code in `cli.ts` is very
approachable.

ALPHA WARNING: internals are likely to change a lot, so expect breakage if you
use library mode right now. CLI is more stable.

## Configuration

Configuration goes in `.gmrc`, which is a JSON file with the following keys:

- `connectionString` (or `DATABASE_URL` envvar) — this is your main development database. If you run
  `graphile-migrate reset` this will be dropped without warning, so be careful.
- `shadowConnectionString` (or `SHADOW_DATABASE_URL` envvar) — the shadow
  database which will be dropped frequently, so don't store anything to it that
  you care about. **This database should not already exist.**
- `rootConnectionString` (or `ROOT_DATABASE_URL` envvar) — this is used to
  connect to the database server with superuser privileges to drop and
  re-create the relevant databases (via the `reset` command directly, or via
  the `commit` command for the shadow database). It **must not** be a
  connection to the database in `connectionString` or `shadowConnectionString`.
  It defaults to "template1" if the key or environment variable is not set so
  it may result in PG connection errors if a default PG `template1` database is
  not available.
- `pgSettings` — optional string-string key-value object defining settings to
  set in PostgreSQL when migrating. Useful for setting `search_path` for
  example. Beware of changing this, a full reset will use the new values which
  may lead to unexpected consequences.
- `placeholders` — optional string-string key-value object defining placeholder
  values to be replaced when encountered in any migration files. Placeholders
  must begin with a colon and a capital letter, and then can continue with a
  string of capital letters, numbers and underscores `/^:[A-Z][A-Z0-9_]+$/`.
  `:DATABASE_NAME` and `:DATABASE_OWNER` are automatically added to this
  object. The value must be a valid in the place you use it (i.e. ensure you
  escape the values) — graphile-migrate does not perform any escaping for you.
  The special value `!ENV` will tell graphile-migrate to
  load the setting from the environment variable with the same name.
- `afterReset` — optional list of actions to execute after the database has
  been created but before the migrations run, useful to set default
  permissions, install extensions or install external schemas like
  `graphile-worker` that your migrations may depend on. See "Actions" below.
- `afterAllMigrations` — optional list of actions to execute after all the
  migrations have ran, useful for performing a tasks like dumping the database
  or regenerating dependent data (GraphQL schema, type definitions, etc). See
  "Actions" below.

What follows is an example configuration file that depends on the following
environmental variables being set:

- `ROOT_DATABASE_URL` - equivalent to `rootConnectionString` above, e.g. `postgres://localhost/template1`
- `DATABASE_URL` - equivalent to `connectionString` above, e.g. `postgres://my_user:my_password@localhost/my_db`
- `SHADOW_DATABASE_URL` - equivalent to `shadowConnectionString` above, e.g. `postgres://my_user:my_password@localhost/my_db_shadow` (should use same credentials as the )

```json
{
  "pgSettings": {
    "search_path": "app_public,app_private,app_hidden,public"
  },
  "placeholders": {
    ":DATABASE_AUTHENTICATOR": "!ENV",
    ":DATABASE_VISITOR": "!ENV"
  },
  "afterReset": [
    "afterReset.sql",
    { "_": "command", "command": "npx --no-install graphile-worker --once" }
  ],
  "afterAllMigrations": [
    {
      "_": "command",
      "command": "pg_dump --schema-only --no-owner --exclude-schema=graphile_migrate --file=data/schema.sql \"$GM_DBURL\""
    }
  ]
}
```

### Windows

Since committed migrations utilize hashes to verify file integrity, the difference between LF and CRLF line endings on \*nix and Windows will cause the hash verification to fail. Git's default/recommended approach to line endings is to convert back and forth depending on your platform. To work around this, we recommend adding a `.gitattributes` file to force LF line endings for the committed migrations on all platforms:

```
migrations/committed/*.sql text eol=lf
migrations/current.sql text eol=lf
```

After committing this change, you may run `git checkout-index --force --all` to rewrite the working copy with LF line endings. If that command does not replace the CRLF line endings, you may need to delete your copy of the repo and re-clone.

## Actions

We support certain "actions" after certain events happen; for example see
`afterReset` and `afterAllMigrations` mentioned above. Actions should be
specified as a list of strings or action spec objects.

### Actions spec strings

String values are converted to `sql` action specs (see below) with the `file`
property set to the string. I.e. they indicate a file within the `migrations`
folder to execute against the database.

### Action spec objects

Action spec objects are plain JSON objects with the following properties:

- `_` - specifies the type of object (see supported types below)
- `shadow` (optional) - if set, must be a boolean; `true` indicates the
  action should only occur against the shadow DB, `false` indicates that the
  action should not occur against the shadow DB, unset runs against both
  databases

Each action spec subtype can have its own properties

#### `sql` action spec

e.g.

```json
{
  "_": "sql",
  "file": "install_extensions.sql"
}
```

The `file` indicates the name of a SQL file in the `migrations/` folder to
execute against the database (e.g. to set permissions, load data, install
extensions, etc).

#### `command` action spec

e.g.

```json
{
  "_": "command",
  "command": "npx --no-install graphile-worker --once"
}
```

`command` actions specify shell actions (e.g. running an external
command such as `graphile-worker` which might install a separately managed
worker schema into the database, or running something like `pg_dump` to dump
the schema).

When the command is invoked it will have access to the following envvars:

- `GM_DBURL` - the relevant database URL (e.g. the one that was just reset/migrated)
- `GM_DBNAME` - the database name in `GM_DBURL`; you might use this if you need to use separate superuser credentials to install extensions against the database
- `GM_DBUSER` - the database user in `GM_DBURL`
- `GM_SHADOW` - set to `1` if we're dealing with the shadow DB, unset otherwise

## Collaboration

The intention is that developers can work on different migrations in parallel,
and can switch between `git` branches - idempotent migrations using `CASCADE`
when dropping should make it possible to do this with little issue (other than
the implicit data loss of dropping tables/columns/etc).

`graphile-migrate commit`, on the other hand, should be linear - one way to
approach this is to only commit a migration immediately before it is merged to
`master`. Another approach is to do the commit on `master` itself. Non-linear
migration commits will result in errors, and may lead to you resetting your
development database.

## Idempotency

`graphile-migrate` is all about iteration; you write your database modification
commands in `migrations/current.sql` and every time you save it is ran against
the database, generally taking under 100ms.

Because we run the same script over and over (on every save) and there's no
down migrations, you need to make your script idempotent. PostgreSQL has a number
of idempotent commands such as:

```sql
create or replace function...
drop table if exists ...
drop trigger if exists ...
-- etc
```

When these aren't suitable you can start your migration with an explicit
rollback: commands that undo later actions. For example:

```sql
-- undo
drop table if exists people;

-- redo
create table people (
  id serial primary key,
  name text
);
```

When it comes time to commit your migration we will run it against a "shadow"
database to make sure it's valid.

It's often wise to use `DROP ... CASCADE` so that if other migrations are
worked on in parallel no additional `rollback` step is required. When you
`DROP ... CASCADE`, be sure to add back any dropped dependents (triggers,
indexes, etc) once the dropped entity has been replaced. Reviewing the database
schema diff can help you spot these issues.

More examples of idempotent operations:

```sql
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

## Disable Transaction

Some migrations require execution outside of a transaction (e.g. to enable augmenting non-DDL-safe things, such as ENUMs in PostgreSQL). To disable wrapping a given migration file in a transaction, use the special comment `--! no-transaction` at the top of the migration file, e.g.

```sql
--! no-transaction
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Admin';
```

## TODO:

- [ ] Use a proper CLI parsing library

- [ ] Store pgSettings with committed transactions to protect against user edits

- [ ] Add automated tests

- [ ] Add `graphile-migrate check` command: reset the shadow database to the latest
      dump, apply the current migration to the shadow database, and output a SQL
      schema diff you can use to ensure no accidental changes have been made

- [ ] Add `graphile-migrate init` command: ask questions and set up the relevant
      files for running graphile-migrate.

- [ ] Add `graphile-migrate import` command: used after init but before running any
      other commands, imports the existing database as if it were the first
      migration. (For now just pg_dump, and put the schema in
      migrations/schema.sql.)
