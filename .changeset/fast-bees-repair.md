---
"graphile-migrate": patch
---

Fix a bug in the chokidar queue where concurrent events did not wait for
migration to finish running.
