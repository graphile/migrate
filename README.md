# graphile-migrate

[![Discord chat room](https://img.shields.io/discord/489127045289476126.svg)](http://discord.gg/graphile)
[![Package on npm](https://img.shields.io/npm/v/graphile-migrate.svg?style=flat)](https://www.npmjs.com/package/graphile-migrate)
![MIT license](https://img.shields.io/npm/l/graphile-migrate.svg)
[![Follow](https://img.shields.io/badge/twitter-@GraphileHQ-blue.svg)](https://twitter.com/GraphileHQ)

Opinionated SQL-powered productive roll-forward migration tool for PostgreSQL.

<!-- SPONSORS_BEGIN -->

## Crowd-funded open-source software

To help us develop this software sustainably under the MIT license, we ask all
individuals and businesses that use it to help support its ongoing maintenance
and development via sponsorship.

### [Click here to find out more about sponsors and sponsorship.](https://www.graphile.org/sponsor/)

And please give some love to our featured sponsors 🤩:

<table><tr>
<td align="center"><a href="https://surge.io/"><img src="https://graphile.org/images/sponsors/surge.png" width="90" height="90" alt="Surge" /><br />Surge</a> *</td>
<td align="center"><a href="https://www.netflix.com/"><img src="https://graphile.org/images/sponsors/Netflix.png" width="90" height="90" alt="Netflix" /><br />Netflix</a> *</td>
<td align="center"><a href="https://qwick.com/"><img src="https://graphile.org/images/sponsors/qwick.png" width="90" height="90" alt="Qwick" /><br />Qwick</a> *</td>
<td align="center"><a href="https://www.the-guild.dev/"><img src="https://graphile.org/images/sponsors/theguild.png" width="90" height="90" alt="The Guild" /><br />The Guild</a> *</td>
</tr><tr>
<td align="center"><a href="http://chads.website"><img src="https://graphile.org/images/sponsors/chadf.png" width="90" height="90" alt="Chad Furman" /><br />Chad Furman</a> *</td>
<td align="center"><a href="https://www.fanatics.com/"><img src="https://graphile.org/images/sponsors/fanatics.png" width="90" height="90" alt="Fanatics" /><br />Fanatics</a> *</td>
<td align="center"><a href="https://dovetailapp.com/"><img src="https://graphile.org/images/sponsors/dovetail.png" width="90" height="90" alt="Dovetail" /><br />Dovetail</a> *</td>
<td align="center"><a href="https://www.enzuzo.com/"><img src="https://graphile.org/images/sponsors/enzuzo.png" width="90" height="90" alt="Enzuzo" /><br />Enzuzo</a> *</td>
</tr><tr>
<td align="center"><a href="https://stellate.co/"><img src="https://graphile.org/images/sponsors/Stellate.png" width="90" height="90" alt="Stellate" /><br />Stellate</a> *</td>
</tr></table>

<em>\* Sponsors the entire Graphile suite</em>

<!-- SPONSORS_END -->

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

## Opinions

- Local iteration should be easy and _fast_
- Migrating should be fast
- Once deployed, databases should be identical (including subtleties such as
  column order)
- Migration software should not be tied to a particular application stack
- Migrations should be written in SQL
- Roll-forward only (production issues should be fixed via additional
  migrations, development can iterate current migration)
- Once a migration is signed off (deployable) it should never be edited
- Use PostgreSQL ;)
- Development databases are cheap; can run multiple
- Resetting development database is acceptable if absolutely necessary
- Production databases are critical - NEVER RESET
- Migrating data (as well as DDL) is acceptable, but should be kept to fast
  operations (or trigger a background job)
- Migrations should automatically be wrapped in transactions by default
- Migrations that require execution outside of a transaction (e.g. to enable
  augmenting non-DDL-safe things, such as `ENUM`s in PostgreSQL) should be
  explicitly marked
- Migrations should not pollute PostgreSQL global settings (e.g. use `SET LOCAL`
  rather than `SET`)
- Roles should be managed outside of migrations (since they can be shared
  between databases)
- Certain schemas are managed by other tools and should not be interfered with;
  e.g. `graphile_worker`

## Setup

In development, `graphile-migrate` uses two databases: the main database and a
"shadow" database. The "shadow" database is used internally by
`graphile-migrate` to test the consistency of the migrations and perform various
other tasks.

In production, most users only run `graphile-migrate migrate` which operates
solely on the main database - there is no need for a shadow database in
production.

All members of your team should run the same PostgreSQL version to ensure that
the shadow dump matches for everyone (one way of achieving this is through
Docker, but that isn't required).

We recommend dumping your database schema with `pg_dump` after migrations are
completed; you can
[see an example of this in Graphile Starter](https://github.com/graphile/starter/blob/4854f77e461062a95cdfff9c62082eb90a3a0d5b/%40app/db/.gmrc#L20).
Tracking this file in git will allow you to easily see the changes that
different migrations are making, so you can be sure you're making the changes
you intend to. We recommend that you dump the shadow database as it will be
unaffected by the iteration you've been applying to your development database
(which may have come out of sync - see 'Drift' below).

### Getting started

> These instructions are for starting a new database project with Graphile
> Migrate; if you already have a database schema, see
> [Using Migrate with an existing database](#using-migrate-with-an-existing-database)
> for some tips.

Create your database role (if desired), database and shadow database:

```bash
createuser --pwprompt appuser
createdb myapp --owner=appuser
createdb myapp_shadow --owner=appuser
```

Export your database URL, shadow database URL, and a "root" database URL which
should be a superuser account connection to any **other** database (most
PostgreSQL servers have a default database called `postgres` which is a good
choice for this).

```bash
export DATABASE_URL="postgres://appuser:password@localhost/myapp"
export SHADOW_DATABASE_URL="postgres://appuser:password@localhost/myapp_shadow"

export ROOT_DATABASE_URL="postgres://postgres:postgres@localhost/postgres"
```

> Your database URL is needed for most Graphile Migrate commands. The shadow
> database URL is needed for the development-only commands `commit`, `uncommit`
> and `reset`. The root database URL is needed to drop and recreate databases,
> i.e. for the `reset` command and for commands that call it (`commit` and
> `uncommit`, which reset the shadow database).
>
> **NOTE**: you should not need the shadow database URL or root database URL in
> production (you only need the `graphile-migrate migrate` command in
> production) unless you have actions that need them.

Then run:

```bash
graphile-migrate init
```

At this point you should be ready to use Graphile Migrate. You may want to store
these environmental variables to a file so you can easily source them (with the
`.` command in bash, for example) in future:

```bash
. ./.env
graphile-migrate watch
```

## Usage

### Committed and current migrations

New migrations are composed within **"the current migration"**. You will see
this term used a lot. By default this is in the `migrations/current.sql` file,
but if you like you may delete that file and instead create a
`migrations/current/` folder into which you may place numbered SQL files which
together comprise "the current migration".

The current migration should be idempotent (this is your responsibility, see
"Idempotency" below); i.e. it should be able to be ran multiple times and have
the same result. This is critical for `graphile-migrate watch`, which is one of
the main selling points of the project.

<!-- prettier-ignore-start -->
<!-- CLI_USAGE_BEGIN -->
## graphile-migrate

```
graphile-migrate <command>

Commands:
  graphile-migrate init            Initializes a graphile-migrate project by
                                   creating a `.gmrc` file and `migrations`
                                   folder.
  graphile-migrate migrate         Runs any un-executed committed migrations.
                                   Does NOT run the current migration. For use
                                   in production and development.
  graphile-migrate watch           Runs any un-executed committed migrations and
                                   then runs and watches the current migration,
                                   re-running it on any change. For development.
  graphile-migrate commit          Commits the current migration into the
                                   `committed/` folder, resetting the current
                                   migration. Resets the shadow database.
  graphile-migrate uncommit        This command is useful in development if you
                                   need to modify your latest commit before you
                                   push/merge it, or if other DB commits have
                                   been made by other developers and you need to
                                   'rebase' your migration onto theirs. Moves
                                   the latest commit out of the committed
                                   migrations folder and back to the current
                                   migration (assuming the current migration is
                                   empty-ish). Removes the migration tracking
                                   entry from ONLY the local database. Do not
                                   use after other databases have executed this
                                   committed migration otherwise they will fall
                                   out of sync. Assuming nothing else has
                                   changed, `graphile-migrate uncommit &&
                                   graphile-migrate commit` should result in the
                                   exact same hash. Development only, and liable
                                   to cause conflicts with other developers - be
                                   careful.
  graphile-migrate status          Exits with a bitmap status code indicating
                                   statuses:

                                   - 1 if there are committed migrations that
                                   have not been executed yet (requires DB
                                   connection)
                                   - 2 if the current migration is non-empty
                                   (ignoring comments)

                                   If both of the above are true then the output
                                   status will be 3 (1+2). If neither
                                   are true, exit status will be 0 (success).
                                   Additional messages may also be output.
  graphile-migrate reset           Drops and re-creates the database, re-running
                                   all committed migrations from the start.
                                   **HIGHLY DESTRUCTIVE**.
  graphile-migrate compile [file]  Compiles a SQL file, inserting all the
                                   placeholders and returning the result to
                                   STDOUT
  graphile-migrate run [file]      Compiles a SQL file, inserting all the
                                   placeholders, and then runs it against the
                                   database. Useful for seeding. If called from
                                   an action will automatically run against the
                                   same database (via GM_DBURL envvar) unless
                                   --shadow or --rootDatabase are supplied.
  graphile-migrate completion      Generate shell completion script.

Options:
  --help        Show help                                              [boolean]
  --config, -c  Optional path to gmrc file   [string] [default: .gmrc[.js|.cjs]]

You are running graphile-migrate v1.4.1.
```


## graphile-migrate init

```
graphile-migrate init

Initializes a graphile-migrate project by creating a `.gmrc` file and
`migrations` folder.

Options:
  --help        Show help                                              [boolean]
  --config, -c  Optional path to gmrc file   [string] [default: .gmrc[.js|.cjs]]
  --folder      Use a folder rather than a file for the current migration.
                                                      [boolean] [default: false]
```


## graphile-migrate migrate

```
graphile-migrate migrate

Runs any un-executed committed migrations. Does NOT run the current migration.
For use in production and development.

Options:
  --help          Show help                                            [boolean]
  --config, -c    Optional path to gmrc file [string] [default: .gmrc[.js|.cjs]]
  --shadow        Apply migrations to the shadow DB (for development).
                                                      [boolean] [default: false]
  --forceActions  Run beforeAllMigrations and afterAllMigrations actions even if
                  no migration was necessary.         [boolean] [default: false]
```


## graphile-migrate watch

```
graphile-migrate watch

Runs any un-executed committed migrations and then runs and watches the current
migration, re-running it on any change. For development.

Options:
  --help        Show help                                              [boolean]
  --config, -c  Optional path to gmrc file   [string] [default: .gmrc[.js|.cjs]]
  --once        Runs the current migration and then exits.
                                                      [boolean] [default: false]
  --shadow      Applies changes to shadow DB.         [boolean] [default: false]
```


## graphile-migrate commit

```
graphile-migrate commit

Commits the current migration into the `committed/` folder, resetting the
current migration. Resets the shadow database.

Options:
  --help         Show help                                             [boolean]
  --config, -c   Optional path to gmrc file  [string] [default: .gmrc[.js|.cjs]]
  --message, -m  Optional commit message to label migration, must not contain
                 newlines.                                              [string]
```


## graphile-migrate uncommit

```
graphile-migrate uncommit

This command is useful in development if you need to modify your latest commit
before you push/merge it, or if other DB commits have been made by other
developers and you need to 'rebase' your migration onto theirs. Moves the latest
commit out of the committed migrations folder and back to the current migration
(assuming the current migration is empty-ish). Removes the migration tracking
entry from ONLY the local database. Do not use after other databases have
executed this committed migration otherwise they will fall out of sync. Assuming
nothing else has changed, `graphile-migrate uncommit && graphile-migrate commit`
should result in the exact same hash. Development only, and liable to cause
conflicts with other developers - be careful.

Options:
  --help        Show help                                              [boolean]
  --config, -c  Optional path to gmrc file   [string] [default: .gmrc[.js|.cjs]]
```


## graphile-migrate reset

```
graphile-migrate reset

Drops and re-creates the database, re-running all committed migrations from the
start. **HIGHLY DESTRUCTIVE**.

Options:
  --help        Show help                                              [boolean]
  --config, -c  Optional path to gmrc file   [string] [default: .gmrc[.js|.cjs]]
  --shadow      Applies migrations to shadow DB.      [boolean] [default: false]
  --erase       This is your double opt-in to make it clear this DELETES
                EVERYTHING.                           [boolean] [default: false]
```


## graphile-migrate status

```
graphile-migrate status

Exits with a bitmap status code indicating statuses:

- 1 if there are committed migrations that have not been executed yet (requires
DB connection)
- 2 if the current migration is non-empty (ignoring comments)

If both of the above are true then the output status will be 3 (1+2). If neither
are true, exit status will be 0 (success). Additional messages may also be
output.

Options:
  --help          Show help                                            [boolean]
  --config, -c    Optional path to gmrc file [string] [default: .gmrc[.js|.cjs]]
  --skipDatabase  Skip checks that require a database connection.
                                                      [boolean] [default: false]
```


## graphile-migrate compile

```
graphile-migrate compile [file]

Compiles a SQL file, inserting all the placeholders and returning the result to
STDOUT

Options:
  --help        Show help                                              [boolean]
  --config, -c  Optional path to gmrc file   [string] [default: .gmrc[.js|.cjs]]
  --shadow      Apply shadow DB placeholders (for development).
                                                      [boolean] [default: false]
```


## graphile-migrate run

```
graphile-migrate run [file]

Compiles a SQL file, inserting all the placeholders, and then runs it against
the database. Useful for seeding. If called from an action will automatically
run against the same database (via GM_DBURL envvar) unless --shadow or
--rootDatabase are supplied.

Options:
  --help          Show help                                            [boolean]
  --config, -c    Optional path to gmrc file [string] [default: .gmrc[.js|.cjs]]
  --shadow        Apply to the shadow database (for development).
                                                      [boolean] [default: false]
  --root          Run the file using the root user (but application database).
                                                      [boolean] [default: false]
  --rootDatabase  Like --root, but also runs against the root database rather
                  than application database.          [boolean] [default: false]
```
<!-- CLI_USAGE_END -->
<!-- prettier-ignore-end -->

## Configuration

Configuration can be stored in a `.gmrc` JSON5 file (compatible with JSON and
[JSONC](https://code.visualstudio.com/docs/languages/json#_json-with-comments)),
or in a `.gmrc.js` file which will be `require()`'d. The following configuration
options are available:

- `connectionString` (or `DATABASE_URL` envvar) — this is your main development
  database. If you run `graphile-migrate reset` this will be dropped without
  warning, so be careful.
- `shadowConnectionString` (or `SHADOW_DATABASE_URL` envvar) — the shadow
  database which will be dropped frequently, so don't store anything to it that
  you care about.
- `rootConnectionString` (or `ROOT_DATABASE_URL` envvar) — this is used to
  connect to the database server with superuser (or superuser-like) privileges
  to drop and re-create the relevant databases (via the `reset` command
  directly, or via the `commit` command for the shadow database). It **must
  not** be a connection to the database in `connectionString` or
  `shadowConnectionString`. It defaults to "template1" if the key or environment
  variable is not set so it may result in PG connection errors if a default PG
  `template1` database is not available.
- `pgSettings` — optional string-string key-value object defining settings to
  set in PostgreSQL when migrating. Useful for setting `search_path` for
  example. Beware of changing this, a full reset will use the new values which
  may lead to unexpected consequences.
- `placeholders` — optional string-string key-value object defining placeholder
  values to be replaced when encountered in any migration files. Placeholders
  must begin with a colon and a capital letter, and then can continue with a
  string of capital letters, numbers and underscores `/^:[A-Z][A-Z0-9_]+$/`.
  `:DATABASE_NAME` and `:DATABASE_OWNER` are automatically added to this object.
  The value must be a valid in the place you use it (i.e. ensure you escape the
  values) — graphile-migrate does not perform any escaping for you. The special
  value `!ENV` will tell graphile-migrate to load the setting from the
  environment variable with the same name.
- `beforeReset` — optional list of actions to execute before deleting and
  recreating the database.
- `afterReset` — optional list of actions to execute after the database has been
  created but before the migrations run, useful to set default permissions,
  install extensions or install external schemas like `graphile-worker` that
  your migrations may depend on. See "Actions" below.
- `beforeAllMigrations` — optional list of actions to execute before any pending
  migrations are executed.
- `afterAllMigrations` — optional list of actions to execute after all the
  migrations have ran, useful for performing a tasks like dumping the database
  or regenerating dependent data (GraphQL schema, type definitions, etc). See
  "Actions" below.
- `beforeCurrent` — optional list of actions to execute before `current.sql` is
  executed.
- `afterCurrent` — optional list of actions to execute after `current.sql` is
  loaded into the database. See "Actions" below.
- `manageGraphileMigrateSchema` (defaults to `true`) — if set to `false`, you
  assume responsibility for managing the `graphile_migrate` schema. **Not
  recommended.** This is useful in environments where the user running the
  migrations isn't granted schema creation privileges. If you set this to
  `false`, you must be sure to migrate the `graphile_migrate` database schema
  any time you update the `graphile-migrate` module.
- `blankMigrationContent` ─ what should be written to the current migration
  after commit. NOTE: this should only contain comments such that the current
  commit is "empty-ish" on creation.
- `migrationsFolder` ─ allows you to override where migrations are stored;
  defaults to `./migrations`.

What follows is an example configuration file that depends on the following
environmental variables being set:

- `ROOT_DATABASE_URL` - equivalent to `rootConnectionString` above, e.g.
  `postgres://localhost/template1`
- `DATABASE_URL` - equivalent to `connectionString` above, e.g.
  `postgres://my_user:my_password@localhost/my_db`
- `SHADOW_DATABASE_URL` - equivalent to `shadowConnectionString` above, e.g.
  `postgres://my_user:my_password@localhost/my_db_shadow` (should use same
  credentials as the )

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
  ],
  "afterCurrent": ["afterCurrent.sql"]
}
```

A `.gmrc.js` configuration file could be identical to the above, except the
opening brace `{` would be prepended with `module.exports =`:

```js
module.exports = {
```

All commands accept an optional `--config` parameter with a custom path to a
`.gmrc(.js)` file. This is useful if, for example, you have a monorepo or other
project with multiple interacting databases.

### Windows

Since committed migrations utilize hashes to verify file integrity, the
difference between LF and CRLF line endings on \*nix and Windows will cause the
hash verification to fail. Git's default/recommended approach to line endings is
to convert back and forth depending on your platform. To work around this, we
recommend adding a `.gitattributes` file to force LF line endings for the
committed migrations on all platforms:

```
migrations/committed/*.sql text eol=lf
migrations/current.sql text eol=lf
```

After committing this change, you may run `git checkout-index --force --all` to
rewrite the working copy with LF line endings. If that command does not replace
the CRLF line endings, you may need to delete your copy of the repo and
re-clone.

## Actions

We support certain "actions" after certain events happen; for example see
`afterReset`, `afterAllMigrations` and `afterCurrent` mentioned above. Actions
should be specified as a list of strings or action spec objects.

### Actions spec strings

String values are converted to `sql` action specs (see below) with the `file`
property set to the string. I.e. they indicate a file within the `migrations`
folder to execute against the database.

### Action spec objects

Action spec objects are plain JSON objects with the following properties:

- `_` - specifies the type of object (see supported types below)
- `shadow` (optional) - if set, must be a boolean; `true` indicates the action
  should only occur against the shadow DB, `false` indicates that the action
  should not occur against the shadow DB, unset runs against both databases

Each action spec subtype can have its own properties.

#### `sql` action spec

e.g.

```json
{
  "_": "sql",
  "file": "install_extensions.sql",
  "root": false
}
```

The `file` indicates the name of a SQL file in the `migrations/` folder to
execute against the database (e.g. to set permissions, load data, install
extensions, etc).

The `root` property should be used _with care_, and is only supported by the
`afterReset` hook (all other hooks will throw an error when it is set). When
`true`, the file will be run using the superuser role (i.e. the one defined in
`rootConnectionString`) but with the database name from `connectionString`. This
is primarily useful for creating extensions.

An identical effect can be achieved using the shorthand syntax of prepending the
file name with an exclamation point, like so:

```json
"afterReset": [ "!install_extensions.sql" ]
```

#### `command` action spec

e.g.

```json
{
  "_": "command",
  "command": "npx --no-install graphile-worker --once"
}
```

`command` actions specify shell actions (e.g. running an external command such
as `graphile-worker` which might install a separately managed worker schema into
the database, or running something like `pg_dump` to dump the schema).

When the command is invoked it will have access to the following envvars:

- `GM_DBURL` - the relevant database URL (e.g. the one that was just
  reset/migrated)
- `GM_DBNAME` - the database name in `GM_DBURL`
- `GM_DBUSER` - the database user in `GM_DBURL` if `root` is `false`.
- `GM_SHADOW` - set to `1` if we're dealing with the shadow DB, unset otherwise

**IMPORTANT NOTE** the `DATABASE_URL` envvar will be set to the nonsense value
`postgres://PLEASE:USE@GM_DBURL/INSTEAD` to avoid ambiguity - you almost
certainly mean to use `GM_DBURL` in your scripts since they will want to change
whichever database was just reset/migrated/etc (which could be the shadow DB).

The `root` property applies to `command` actions with the similar effects as
`sql` actions (see above). When `true`, the command will be run with GM_DBURL
envvar set using the superuser role (i.e. the one defined in
`rootConnectionString`) but with the database name from `connectionString`. When
`root` is true, `GM_DBUSER` is not set.

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

Because we run the same script over and over (on every save) and there's no down
migrations, you need to make your script idempotent. PostgreSQL has a number of
idempotent commands such as:

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

It's often wise to use `DROP ... CASCADE` so that if other migrations are worked
on in parallel no additional `rollback` step is required. When you
`DROP ... CASCADE`, be sure to add back any dropped dependents (triggers,
indexes, etc) once the dropped entity has been replaced. Reviewing the database
schema diff can help you spot these issues.

More examples of idempotent operations can be found in
[docs/idempotent-examples.md](./docs/idempotent-examples.md).

## Disable Transaction

Some migrations require execution outside of a transaction (e.g. to enable
augmenting non-DDL-safe things, such as ENUMs in PostgreSQL). To disable
wrapping a given migration file in a transaction, use the special comment
`--! no-transaction` at the top of the migration file, e.g.

```sql
--! no-transaction
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Admin';
```

**IMPORTANT**: `pg` always runs multi-statement queries in a pseudo-transaction,
so `--! no-transaction` migrations must contain exactly one statement. You might
be able to work around this with a `DO $$` block? (If this works, please send a
PR to this paragraph.)

## Editing a committed migration

Graphile Migrate deliberately performs cryptographic hashing to avoid/detect
accidental editing of committed migrations and to ensure there is a strict
linear progression in migrations. By default, Graphile Migrate will refuse to
run a migration if its hash does not match what it declares; this is generally
desired (and you shouldn't have to worry about it).

Should you need to go back and edit a _committed_ migration you can opt out of
Graphile Migrate's consistency checks by adding the comment
`--! AllowInvalidHash` to the very top of the committed migration. Please note
that editing the migration **WILL NOT** cause the migration to run again on
yours or any other system.

The need to edit a previous migration generally arises if there was a mistake in
your migration that prevents it running on production but you don't want to
reset your staging database, or where an update to PostgreSQL has made the
syntax or commands in an older migration invalid and thus you must edit them to
make the migration run against a clean database again. Most users should never
need this functionality. If you find yourself using it more than once or twice,
please get in touch and we can discuss how the tool can better serve your needs.

## Terminology

### The current migration

The file (or files) in which the non-committed migration that would be executed
by `graphile-migrate watch` is defined. By default this is in the
`migrations/current.sql` file, but it might be `migrations/current/*.sql` if
you're using folder mode.

### Committed migration(s)

The files for migrations that you've committed with `graphile-migrate commit`
(note: this is different to committing the files using your version control
system, e.g. git). By default they're located in `migrations/committed/*.sql`
and are numbered.

### Root

We use the term "root" to indicate a database role with superuser or
superuser-like privileges. This should include the ability to create and delete
databases, but may also include the abilities to create extensions and/or roles.

Since "superuser" has a specific meaning and is not strictly required for these
activities we avoid that term, however you may find that you use a superuser as
your root user - this is expected.

## Status

**STABLE**

This project is intended to be consumed via the CLI, which is stable and is
being used in production in many projects. The CLI doesn't have explicit tests
(PR welcome!), but it's a thin wrapper around the programmatic API which has
copious tests.

The programmatic API is deliberately undocumented; it is not a public interface
at this time (though it is fully typed in TypeScript). We reserve the right to
make breaking changes to the programmatic API in patch releases (though this has
not happened yet and is unlikely to happen without good reason). Should you need
to use the programmatic API, please get in touch to encourage us to make this a
supported interface ─ we'd love to know how you're using it!
[src/cli.ts](src/cli.ts) is the best place to start.

The project as a whole is stable, but the approach is still "experimental", in
particular:

- the approach of up-only and re-runnable migrations is not for the faint of
  heart ─ it requires solid SQL knowledge and if insufficient attention is paid
  it could result in your migrations and your local database state drifting
  apart (see 'Drift' below).

If you don't understand what makes Graphile Migrate awesome, you may want to
consider an alternative migration framework such as these awesome (and quite
diverse) projects:

- [db-migrate](https://db-migrate.readthedocs.io/en/latest/Getting%20Started/commands/)
- [sqitch](https://sqitch.org/)
- [Flyway](https://flywaydb.org/)
- [migra](https://github.com/djrobstep/migra)

## Node.js versioning policy

We only support LTS versions of Node.js; the currently supported versions are:

- Node v14.x
- Node v16.x
- Node v18.x

Other versions of Node may work, but are not officially supported.

Once a Node.js version becomes "unsupported" (i.e. the maintenance LTS window
ends), this project will no longer support it either. We may drop support for
unmaintained versions of Node.js in a **minor** release.

## Drift

> **NOTE**: drift only affects your local development database, it cannot occur
> in your production database assuming you're only using
> `graphile-migrate migrate` in production.

In development, if you're insufficiently careful with modifications to
`current.sql` (including when you choose to save the file, and when switching
branches in `git`) you may end up with a local database state that differs from
what you'd expect given the committed migrations and contents of `current.sql`.
We **strongly recommend against auto-save** for this reason; and recommend that
you keep a dumped `schema.sql` to help you spot unexpected changes.

Here's an illustrative example to explain the drift phenomenon, with function
inspired by [XKCD221](https://xkcd.com/221/). Imagine that you're running
`graphile-migrate watch` locally and you write the following to `current.sql`:

```sql
-- Revision 1
create function rnd() returns int as $$
  select 4;
$$ language sql stable;
```

Because `watch` runs the contents of `current.sql` whenever it changes, this
will create the `rnd()` function in your local database.

A couple seconds later you change your mind, and decide to rename the function,
writing the following to `current.sql`:

```sql
-- Revision 2
create function get_random_number() returns int as $$
  select 4;
$$ language sql stable;
```

This creates `get_random_number()`, but no-one ever said to delete `rnd()`, so
now both functions exist. According to the committed migrations and
`current.sql` only `get_random_number()` should exist. The existence of the
orphaned `rnd()` function in your local database is what we term "drift" ─ this
function will never appear in your production database even after you commit
this latest migration; it also won't be in your shadow database (because we
reset the shadow database and reapply all the migrations frequently).

Since Graphile Migrate doesn't know how to reverse the SQL you've written, it's
up to you to make the SQL safe so that it can be ran over and over, and adjust
to your changes. The two to `current.sql` versions above should have been

```sql
-- Revision 1
drop function if exists rnd();

create function rnd() returns int as $$
  select 4;
$$ language sql stable;
```

and

```sql
-- Revision 2
drop function if exists rnd();
drop function if exists get_random_number();

create function get_random_number() returns int as $$
  select 4;
$$ language sql stable;
```

## Using Migrate with an existing database

You can use Graphile Migrate to manage the migrations for your existing system,
but the process is slightly different.

Because Graphile Migrate tracks which migrations it has ran and runs remaining
migrations, you must not put your existing database schema as the first
migration otherwise you production database might be wiped (or it just won't
work) when Graphile Migrate attempts to apply it. Instead you must ensure all
databases (development, staging, production, etc.) are at the same state before
running any migrations, and then the Graphile Migrate migrations will be applied
_on top_ of this initial state.

### Storing the initial state

Though you could hand-roll the initial state if you prefer, we generally advise
that you take a schema-only dump of your existing (production) database schema
and store it to `migrations/initial_schema.sql` with a command such as:

```
pg_dump --schema-only --no-owner --file=migrations/initial_schema.sql "postgres://..."
```

If you manage some of the data in your initial database schema using your
existing migration system then you should add that data to your
`initial_schema.sql` file too.

### New databases must apply the initial state

When creating new databases (e.g. test databases, new development databases for
new developers, when resetting your development database, whenever Graphile
Migrate recreates the shadow database, etc.) it's imperative that these new
databases also have `initial_schema.sql` applied to them.

#### Applying the initial schema with Actions

One way to apply the initial schema is to use [Actions](#actions), specifically
the `afterReset` action, to apply the initial schema immediately after the
database is reset/created and before any committed migrations are applied. Add
something like `"afterReset": [ "initial_schema.sql" ]` to your `.gmrc` and
whenever Graphile Migrate's `reset` command runs (including against the shadow
database when committing a migration) this initial schema will be applied. Note
this is only used when a DB is reset (i.e. when you have Graphile Migrate create
it) and thus it won't be a concern for production since you never run `reset`
there.

#### Applying the initial schema in other ways

You can take care of applying the initial schema using your own tooling should
you want or need to do so.

The [official PostgreSQL Docker container](https://hub.docker.com/_/postgres)
has the `/docker-entrypoint-initdb.d/` directory for initialization scripts, and
this might be a good location for your `initial_schema.sql` file if you're using
this image.

**Important note**: in development the shadow database must be able to be
destroyed and recreated by Graphile Migrate at will, so applying the initial
schema _to the shadow database_ must be done via an Action (see above). You can,
however, ensure that your action only applies to the shadow database by setting
the `"shadow": true` property, leaving you free to manage how your more
permanent databases are initialized.

## Examples

- [Running Graphile Migrate in a Docker container](docs/docker/README.md)
- [Examples of idempotent migration files including edge cases](docs/idempotent-examples.md)

## TODO:

- [ ] Store pgSettings with committed transactions to protect against user edits

- [ ] Add `graphile-migrate check` command: reset the shadow database to the
      latest dump, apply the current migration to the shadow database, and
      output a SQL schema diff you can use to ensure no accidental changes have
      been made

- [ ] Add `graphile-migrate import` command: used after init but before running
      any other commands, imports the existing database as if it were the first
      migration. (For now, see
      [Using Migrate with an existing database](#using-migrate-with-an-existing-database).)
