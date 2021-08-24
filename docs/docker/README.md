# Running Graphile Migrate from a container

When working in a team it can be useful to package `graphile-migrate` and the
Postgres tooling into a Docker file so that everyone has easy access to the same
versions. This is also helpful if you're using Migrate as part of a larger
non-Node based project.

For these purposes we provide an [example Dockerfile](./Dockerfile) in the
`docs/docker` directory in the source tree. This uses the latest released
version of `graphile-migrate` from `npm` and packages it together with the
necessary Node and Postgres tools. You can build the Dockerfile from the root of
the repository using a command like such as:

```bash
docker build -t graphile-migrate docs/docker \
    --build-arg NODEJS_VERSION=14 --build-arg POSTGRES_VERSION=12
```

To conveniently run Graphile Migrate within the container you can then use the
[`graphile-migrate` wrapper script](./graphile-migrate) which passes the
standard Migrate environment variables through to the container.
