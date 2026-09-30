---
title: Getting Started
description: Install the caf CLI, scaffold a product, and understand what exists today.
---

## Status, first

Read this before copying anything: **cafaye is in early development.** The
repos are coming online service by service, starting with `identity` and
`billing`. The commands below are the intended shape of the CLI and the
platform; where a command does not ship yet, it is marked
<span class="badge caution">Coming soon</span> and there is no workaround to
follow. Nothing here is a stable API.

## Install the CLI

`caf` is the entry point to everything: it scaffolds, runs, and generates.

```sh
# Coming soon — `caf` has no published release yet.
brew install cafaye/tap/caf
```

Until the tap exists, build it from source — the `caf` repository is
[github.com/cafaye/caf](https://github.com/cafaye/caf), and it is a Go binary,
so a `go install` is all there is to it.

```sh
git clone git@github.com:cafaye/caf.git
cd caf
go build -o caf .
```

## Scaffold a product

`caf init` is the command that creates a new project on top of the platform:
auth, tenancy, and billing wired to real services, so you are not writing those
again.

```sh
# Coming soon.
caf init my-saas
```

What `caf init` will do, per the platform's design: read the current `core`
version, write a project manifest, generate the client SDK for the contracts
you depend on, and emit a `docker-compose.yml` bringing up the services you
selected. It will not vendor services into your repository — each one stays an
independent dependency you upgrade on its own.

## Run the platform locally

```sh
# Coming soon.
caf dev
```

`caf dev` reads each service's `cafaye.yml`, brings up the services this project
declares, and proxies between them so localhost behaves like a deployment.
Before that exists, the per-service compose stacks are the way to run services
locally — each service repository ships a `docker-compose.yml` and documents its
own probes.

## Add a service

```sh
# Coming soon.
caf new billing          # add a dependency on a platform service
caf gen sdk              # regenerate SDKs from the contracts
caf contract test        # validate responses against core's specs
```

## What to read next

- [Contracts](/contracts/) — `cafaye.yml`, OpenAPI, and the event
  envelope. This is how the services find each other, and it is the one thing
  worth understanding before anything else.
- [Services](/services/) — one page per service, each stating what is built and
  what is not.
- [Guides](/guides/) — task-oriented walkthroughs. Empty for now.

## Contributing to the docs

This site lives in [github.com/cafaye/docs](https://github.com/cafaye/docs).
Every page is Markdown; run `npm run dev` to preview and `bin/prime` to prove
the build is green before opening a PR.