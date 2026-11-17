---
"graphile-migrate": patch
---

`--!include` now rejects a path that contains whitespace. Such an include used
to be compiled and committed, but `uncommit` could not turn it back into its
`--!include` line.
