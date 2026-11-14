---
"graphile-migrate": patch
---

`uncommit` now restores the `--!include` line of an included file whose path
contains a space, instead of leaving the file's contents and the `--! Included`
markers in the current migration.
