# Roadmap

## Current State

Phase 1 exists as a narrow governed runtime:

- one assistant identity
- one operator-only web app
- one governed skill
- one worker runtime
- one Postgres-backed kernel

## Immediate Priorities

1. backup automation
2. documented deploy / rollback workflow
3. minimal monitoring and alerting

These should happen before expanding product scope.

## Near-Term Product Work

- improve operator ergonomics in Mission Detail and Approvals
- expose safer explicit mission test controls for non-production debugging
- tighten operational docs around upgrade and restore procedures

## Deferred on Purpose

- OpenClaw integration
- multi-channel adapters
- multi-user auth
- RBAC
- generalized workflow builder
- browser / scraping runtime
- dynamic skill generation

## Architectural Rule

Expansion is justified only if the current governed path remains boringly reliable.

Do not add:

- more services
- more channels
- more skills
- more infrastructure

until the current path stays stable under normal use and failure drills.
