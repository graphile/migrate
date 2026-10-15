# graphile-migrate

## 2.0.0-rc.7

### Patch Changes

- [#275](https://github.com/graphile/migrate/pull/275)
  [`a55954b`](https://github.com/graphile/migrate/commit/a55954bec701fbcbbf0e0313bed17909d8ba5d1e)
  Thanks [@benjie](https://github.com/benjie)! - Fixes a bug in error handling
  for `commit` where `--! include` comments were not restored, instead being
  replaced by the included assets.

## 2.0.0-rc.6

### Patch Changes

- [#265](https://github.com/graphile/migrate/pull/265)
  [`9348e85`](https://github.com/graphile/migrate/commit/9348e85dea90c75d32bdb2cd27e5cf35009fa5ec)
  Thanks [@benjie](https://github.com/benjie)! - Fix a bug in the chokidar queue
  where concurrent events did not wait for migration to finish running.

- [#273](https://github.com/graphile/migrate/pull/273)
  [`69c7d2d`](https://github.com/graphile/migrate/commit/69c7d2dd918fa5acaa73ee701dfeed45afb9015c)
  Thanks [@sean0407](https://github.com/sean0407)! - Fix a bug when commit
  fails: restore the original migration fully (don't drop `Message` header)

- [#272](https://github.com/graphile/migrate/pull/272)
  [`7339fbe`](https://github.com/graphile/migrate/commit/7339fbe6b429d6a55b95e9b5dbcb22262f488a14)
  Thanks [@benjie](https://github.com/benjie)! - Internal refactor of migration
  reading, allowing us to get the latest committed migration without reading all
  committed migrations.

- [#271](https://github.com/graphile/migrate/pull/271)
  [`9eb1f53`](https://github.com/graphile/migrate/commit/9eb1f53fce21f4bd5a851447bf63fe6d4acf6ad6)
  Thanks [@benjie](https://github.com/benjie)! - Internal refactor of chokidar
  settings

- [#268](https://github.com/graphile/migrate/pull/268)
  [`777f677`](https://github.com/graphile/migrate/commit/777f6773aa7bf3a73b7d42525fbb4d264a0b493e)
  Thanks [@benjie](https://github.com/benjie)! - Internal refactor of compiling
  includes

- [#266](https://github.com/graphile/migrate/pull/266)
  [`a6a3af2`](https://github.com/graphile/migrate/commit/a6a3af2284a85c20c3121f7fb718f2fdf6fefc2a)
  Thanks [@benjie](https://github.com/benjie)! - Internal refactor of filesystem
  helpers.

## 2.0.0-rc.5

### Patch Changes

- [#260](https://github.com/graphile/migrate/pull/260)
  [`16d5835`](https://github.com/graphile/migrate/commit/16d5835fd4ece7fe5bf15dcbe587964b25ed1050)
  Thanks [@benjie](https://github.com/benjie)! - parseSync can't work with
  subcommands; revert to argv/isPromise

## 2.0.0-rc.4

### Major Changes

- [#257](https://github.com/graphile/migrate/pull/257)
  [`1101e43`](https://github.com/graphile/migrate/commit/1101e4319d91a205cf9024017c99173f2f389a1f)
  Thanks [@benjie](https://github.com/benjie)! - Adds fixtures for reusable,
  version-controlled migration definitions.

  The major new feature in this release is `fixtures`. The reason this is a
  major version is because we've upgraded all the dependencies and the minimum
  supported Node version is now Node 18, which Migrate will only support until
  its "end of life" (EOL) date in 2025. Reminder: once a Node.js or PostgreSQL
  version goes EOL, we no longer support that version, and we may break
  compatibility with it in a patch release. We only support LTS versions of
  Node.js and PostgreSQL.

  ## Fixtures

  Fixtures live in the `migrations/fixtures/` folder and can be included into
  your migration with `--!include` comments; this allows you to keep your
  definitions in a set location (for version control) and include them into the
  migration when you make changes.

  Fixtures can use placeholders such as `:DATABASE_VISITOR` just like the
  `current.sql` migration can.

  Fixtures can also `--!include` other fixtures, though be sure not to create a
  cycle! (We will throw an error if you do.)

  IMPORTANT: fixtures must only affect stateless resources. It would not make
  sense to add `DROP TABLE posts; CREATE TABLE posts (...);` into a fixture, as
  that would result in the table being dropped and recreated each time you
  `--!include` it, destroying all your data. Similarly we strongly recommend
  that you do not use `CASCADE` in any `DROP` statements - if a stack of
  resources needs to be dropped and recreated then do that explicitly to ensure
  only things you expect to be affected are affected.

  Stateless resources: functions, triggers, grants, policies, views,
  constraints, indexes, etc

  Stateless but expensive resources: materialized views, indexes, some
  constraints, etc

  Stateful resources: tables, some operations on composite types used in table
  columns, etc

  Thank you to @jnbarlow for working with me to develop this feature!

  ### Example

  In this example you have two fixtures that you've changed, and you will
  include them into the `current.sql` migration. Note that the `fixtures` paths
  are arbitrary, you can choose your own structure inside that folder.

  #### `migrations/fixtures/functions/current_user_id.sql`

  This is where you would create and manage the current_user_id function.
  Whenever you make changes to it, ensure you `--!include` it in your
  `current.sql` migration.

  ```sql
  create or replace function current_user_id() returns int as $$
    select nullif(current_setting('jwt.claims.user_id', true), '')::int;
  $$ language sql stable;
  revoke execute on current_user_id() from public;
  grant execute on current_user_id() to :DATABASE_VISITOR;
  ```

  #### `migrations/fixtures/policies/posts.sql`

  This is where you would create and manage the policies for the posts table.
  Whenever you make changes to it, ensure you `--!include` it in your
  `current.sql` migration.

  ```sql
  drop policy if exists manage_own on posts;
  create policy manage_own on posts
    for all
    using (author_id = current_user_id());

  drop policy if exists view_all on posts;
  create policy view_all on posts
    for select
    using (true);

  drop policy if exists admin_delete on posts;
  create policy admin_delete on posts
    for delete
    using (current_user_is_admin());
  ```

  #### `migrations/current.sql`

  Built in this way, the `current.sql` migration would only need to contain
  stateful operations (or expensive operations, like creating indexes); all
  stateless idempotent operations can be included from their location in
  `fixtures`.

  ```sql
  --!include functions/current_user_id.sql
  --!include policies/posts.sql
  ```
