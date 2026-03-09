# Contributing

## Current Project Shape

This project is intentionally narrow.

Before expanding it, understand the current constraints:

- one assistant identity
- one owner-operator web app
- one governed mission path
- one worker runtime
- one Postgres-backed kernel

## What Good Changes Look Like

- preserve the kernel as the only lifecycle authority
- keep the chat lane / mission lane split explicit
- improve reliability, clarity, or operator usability
- keep Phase 1 scope disciplined

## What To Avoid

- premature microservices
- generic workflow-builder abstractions
- multi-agent product surfaces
- direct lifecycle writes from the UI or worker
- OpenClaw dependency in the Phase 1 core path

## Development

```bash
npm install
npm test
npm run build
```

For the real runtime path, use PostgreSQL and run:

```bash
npm run test:postgres
```

## Pull Requests

Aim for changes that are:

- small enough to review clearly
- backed by tests where behavior changes
- explicit about lifecycle, approval, and artifact consequences

If a change affects the governed runtime model, update the relevant documentation under `docs/`.
