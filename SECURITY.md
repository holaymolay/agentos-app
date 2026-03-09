# Security Policy

## Scope

This repository contains a governed assistant runtime with authentication, cookie handling, execution workers, and a PostgreSQL-backed kernel.

Treat security issues seriously.

## Reporting

Do not post sensitive vulnerability details, secrets, or exploit chains in a public issue.

If GitHub private vulnerability reporting is enabled for this repository, use it.

Otherwise, contact the repository owner privately through GitHub before opening a public issue.

## What To Include

- affected commit or version
- clear reproduction steps
- impact
- whether the issue allows auth bypass, data exposure, remote execution, or integrity loss

## Out of Scope

The following are not security bugs by themselves:

- missing product features
- unsupported deployment shapes
- debug-only local development shortcuts that are not present in production guidance

## Operator Reminder

Do not commit:

- `.env`
- cookie secrets
- owner passwords
- private keys
- production database dumps
