---
"graphile-migrate": patch
---

`--! no-transaction` in `current.sql` is now honoured when it follows headers
such as `--! Message`, as it already was once the migration is committed.
