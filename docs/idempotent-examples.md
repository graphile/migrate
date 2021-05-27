# Idempotent Examples

Idempotency is an important concept in Graphile Migrate, if a migration is
idempotent it means that you can run the migration multiple times and the end
state of the database structure will always be the same. (NOTE: though the
structure may be the same, some idempotent commands may result in
deleting/dropping data, so extreme care must be exercised.)

Many of PostgreSQL's commands have built in support for idempotency; you will
see this commonly with `IF EXISTS` or `IF NOT EXISTS` clauses,
`CREATE OR REPLACE`, and similar constructs:

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

Sometimes idempotency is a little more difficult to achieve. For instance, some
commands do not have the `if exists` parameter. One such example is `rename`. In
this case, we can implement the `if exists` logic ourselves using an anonymous
code block:

```sql
do $$
begin
    /* if column `username` exists on users table */
    if exists(
        select 1
            from information_schema.columns 
            where table_schema = 'public'
            and table_name = 'users' 
            and column_name = 'username'
    ) then
        /* rename the column to `name` */
        alter table users
            rename column username to name;
    end if;
end$$;
```
