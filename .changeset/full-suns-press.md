---
"graphile-migrate": patch
---

Fixes a bug in error handling for `commit` where `--! include` comments were not
restored, instead being replaced by the included assets.
