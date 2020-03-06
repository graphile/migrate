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

## `--! no-transaction`

This is treated as a body comment for backwards compatibility reasons. This
comment is only valid in `migrations/current.sql` and is ignored or will error
if found in `migrations/current/*.sql`. It has to be the very first line (after
any headers).
