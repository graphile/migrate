# Contributing

Thanks for your interesting in contributing to Graphile Migrate!

First, and most importantly, contributions to Graphile are governed by the
Graphile Code of Conduct (which uses the Contributor Covenant); you can read it
here: https://www.graphile.org/postgraphile/code-of-conduct/

Following are some guidelines for contributions.

## Running tests

The tests require a database connection. One way to get to a point where tests
are passing is to use a minimal `docker-compose.yml` file. This one works nicely
(note that the connections are made by your local user account, which may not
work in a Windows environment):

```
version: "3"

services:
  graphile_migrate_postgres:
    container_name: graphile_migrate_postgres
    environment:
      POSTGRES_USER: ${USER}
      POSTGRES_HOST_AUTH_METHOD: trust
    image: "postgres:12.4"
    ports:
      - 5432:5432
    restart: always
    volumes:
      - graphile_migrate_data:/var/lib/postgresql/data

volumes:
  graphile_migrate_data:
    driver: local
```

## ASK FIRST!

There's nothing worse than having your PR with 3 days of work in it rejected
because it's just too complex to be sensibly reviewed! If you're interested in
opening a PR please open an issue to discuss it, or come chat with us:
http://discord.gg/graphile

Small, focussed PRs are generally welcome without previous approval.
