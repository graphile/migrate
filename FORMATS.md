# Formats

`graphile-migrate` uses cryptographic hashes to sign the resulting migration
files, so it's critically important that these signatures are stable. No matter
what previously committed migration exists, assuming `current/*` / `current.sql`
is empty you should be able to run
`graphile-migrate uncommit && graphile-migrate commit` and the hash should be
unchanged. This should be true independent of whether you are using commit
messages, multi-file or single-file migrations, etc.

So, we have the following rules:

## Trim and trail

When the migration is ready to be signed and/or written to disk, we trim it
(using `String.prototype.trim`) and then append a newline. So every file should
always end with exactly one newline (and should never start with a newline or
whitespace).

## Header comments

Header comments such as `--! Hash`, `--! Previous` and `--! Message` will always
be at the top of a file, and _should_ have two newlines between them and the
rest of the content. This last part is enforced for committed migrations, but is
more relaxed when dealing with `current`.

Header comments always start with a capital letter.

## Body comments

Body comments such as `--! split` occur after the header section. They should be
at the top.

Body comments always start with a lower case letter.

## Unexpected comments

Comments elsewhere in the file are ignored - we do not implement an SQL parser
so we do not know if the comment is within a SQL string or similar. It's easiest
just not parse that far.

## `--! AllowInvalidHash`

Should you need to go back and edit a _committed_ migration you can opt out of
Graphile Migrate's consistency checks by adding this comment to the very top of
your committed migration. Please note that editing the migration **WILL NOT**
cause the migration to run again. This is primarily useful where there was a
mistake in your migration that prevents it running on production but you don't
want to reset your staging database, or where an update to PostgreSQL has made
the syntax or commands in an older migration invalid and thus you must edit them
to make the migration run against a clean database again.

## `--! no-transaction`

This is treated as a body comment for backwards compatibility reasons. This
comment is only valid in `migrations/current.sql` and is ignored or will error
if found in `migrations/current/*.sql`. It has to be the very first line (after
any headers).

## Multifile

Multi-file dumps use `--! split: name_of_file.sql` comments to split the file
into multiple parts.

Any lines that come before the first `--! split` are pushed into that split
(this should only be headers).

Every split is separated from the next split by a newline.

Due to "trim and trail" (above), an empty file is treated as a single newline,
which means that it would be output as two newlines - one for the file itself,
and one for the regular split. E.g.

```sql
--! split: 001.sql
select 1;

--! split: 002-empty.sql


--! split: 003.sql
select 3;

```
