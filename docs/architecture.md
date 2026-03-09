# Architecture

## Purpose

AgentOS is a governed assistant runtime.

The product shape is intentionally narrow:

- one assistant identity
- one authenticated owner-operator
- one web application
- one governed mission path
- one kernel-owned lifecycle model

This is not a generic multi-agent platform and not a chat-first orchestration toy.

## Core Model

AgentOS separates two execution lanes:

- `chat lane`
  - low-friction conversation
  - explanations, drafting, and lightweight replies
  - no canonical mission state

- `mission lane`
  - governed execution for consequential work
  - tool execution
  - approval-gated actions
  - artifact-backed completion
  - deterministic kernel state transitions

Within mission lane, the runtime distinguishes:

- `speculative plane`
  - reasoning, proposal, interpretation
- `authoritative plane`
  - canonical state changes
  - approvals
  - artifact promotion
  - mission completion

## Source of Truth

Canonical truth lives in the kernel-backed data model:

- missions
- mission steps
- approval requests
- artifacts
- append-only events
- projections derived from committed events

The UI, worker, and assistant shell do not own lifecycle truth.

They may:

- submit turns
- request mission creation
- claim work through kernel APIs
- submit receipts
- render canonical objects or derived projections

They may not:

- invent lifecycle state
- skip approvals
- directly promote artifacts
- declare mission success outside kernel verification

## Runtime Components

## Web process

- Fastify API
- cookie-based owner auth
- static serving for the React/Vite frontend
- routes for:
  - auth
  - assistant turns
  - missions
  - approvals
  - overview / stream

## Worker process

- polls for claimable steps
- claims work through the kernel
- renews leases with heartbeats
- executes local tools through an adapter
- submits structured execution receipts

## Persistence

- PostgreSQL is the canonical runtime store
- raw SQL migrations define the initial schema
- read models are stored in dedicated projection tables
- event history is append-only

## Frontend

The current MVP UI includes:

- `Assistant`
- `Overview`
- `Approvals`
- `Mission Detail`

The UI is intentionally mission-centric, not channel-centric.

## Current Skill Model

Phase 1 includes one active governed skill:

- `skill.healthcheck@1.0.0`

It performs:

1. diagnostics collection
2. diagnostics artifact emission
3. remediation decision
4. approval gate if remediation is required
5. remediation execution
6. remediation artifact emission
7. mission verification and completion

## Current Data Model

The initial schema includes:

- `missions`
- `mission_steps`
- `approval_requests`
- `artifacts`
- `events`
- `skill_versions`
- `conversation_messages`
- `user_preferences`
- `mission_summary_view`
- `approval_queue_view`
- `overview_health_view`
- `projection_watermarks`

## Failure Handling

The runtime includes explicit handling for:

- duplicate receipts
- lease expiry
- step requeue
- dead-letter transitions
- approval races
- artifact verification failure
- read-model staleness

## Non-Goals for Phase 1

- multi-user tenancy
- RBAC
- channel adapters
- browser automation
- OpenClaw integration
- generic workflow authoring
- dynamic skill synthesis
