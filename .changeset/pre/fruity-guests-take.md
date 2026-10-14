---
"graphile-migrate": patch
---

Fix a bug when commit fails: restore the original migration fully (don't drop
`Message` header)
