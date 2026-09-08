---
"graphile-migrate": "major"
---

Adds fixtures for reusable, version-controlled migration definitions.

The major new feature in this release is `fixtures`. The reason this is a major
version is because we've upgraded all the dependencies and the minimum supported
Node version is now Node 18, which Migrate will only support until its "end of
life" (EOL) date in 2025. Reminder: once a Node.js or PostgreSQL version goes
EOL, we no longer support that version, and we may break compatibility with it
in a patch release. We only support LTS versions of Node.js and PostgreSQL.

## Fixtures

Fixtures live in the `migrations/fixtures/` folder and can be included into your
migration with `--!include` comments; this allows you to keep your definitions
in a set location (for version control) and include them into the migration when
you make changes.

Fixtures can use placeholders such as `:DATABASE_VISITOR` just like the
`current.sql` migration can.

Fixtures can also `--!include` other fixtures, though be sure not to create a
cycle! (We will throw an error if you do.)

IMPORTANT: fixtures must only affect stateless resources. It would not make
sense to add `DROP TABLE posts; CREATE TABLE posts (...);` into a fixture, as
that would result in the table being dropped and recreated each time you
`--!include` it, destroying all your data. Similarly we strongly recommend that
you do not use `CASCADE` in any `DROP` statements - if a stack of resources
needs to be dropped and recreated then do that explicitly to ensure only things
you expect to be affected are affected.

Stateless resources: functions, triggers, grants, policies, views, constraints,
indexes, etc

Stateless but expensive resources: materialized views, indexes, some
constraints, etc

Stateful resources: tables, some operations on composite types used in table
columns, etc

Thank you to @jnbarlow for working with me to develop this feature!

### Example

In this example you have two fixtures that you've changed, and you will include
them into the `current.sql` migration. Note that the `fixtures` paths are
arbitrary, you can choose your own structure inside that folder.

#### `migrations/fixtures/functions/current_user_id.sql`

This is where you would create and manage the current_user_id function. Whenever
you make changes to it, ensure you `--!include` it in your `current.sql`
migration.

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
