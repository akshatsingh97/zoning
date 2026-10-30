# Zoning — project rules for coding agents

Zoning gives AI coding agents "zoning laws" for a codebase. Files with a big blast radius (payments, auth, infra) are **Critical**: they can change only under an intent contract the developer writes, and Muse Spark checks the diff against it. Widely imported files are **Shared**. Everything else is **Open** and stays frictionless.

The full product spec is in `docs/SPEC.md`. Read it before starting any task. Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026).

## Ground rules

- Work on one milestone at a time, in the order given in `docs/SPEC.md`. Stop at the end of the milestone you were asked for and summarise.
- Build only what the spec and the current task ask for. No extra features, no speculative abstractions.
- Never read, print or commit secrets. The Meta API key lives in `.env` as `MODEL_API_KEY`, and `.env` is gitignored. Only `.env.example` is committed.
- All code must be original work written in this repo. Don't paste code from other projects. npm dependencies listed under Stack are fine.
- Ask before adding a dependency that isn't listed under Stack.
- Ask before deleting files, changing git history, or touching anything outside this repo (except reading the target repo that Zoning scans).
- Open-zone files must never be sent to a model. Only Critical and Shared candidates, and contract diffs, may reach Muse Spark.
- Messages Zoning shows to users are short and plain, describe the file and the rule, and never name or blame a person.

## Stack

- Node 22, TypeScript in strict mode, ESM, pnpm workspaces
- `packages/core` — scanning, zones, contracts, checking. Prefer pure functions; keep I/O at the edges.
- `packages/cli` — the `zoning` command (commander)
- `packages/server` — Fastify, with server-sent events for the live feed
- `apps/dashboard` — React + Vite
- Libraries: dependency-cruiser or ts-morph (import graph), chokidar (file watching), simple-git (git), yaml, zod (schemas), vitest (tests), the `openai` SDK (model calls)
- Model calls: `openai` SDK with `baseURL` `https://api.meta.ai/v1`, model name from env `ZONING_MODEL` (default `muse-spark-1.3`). Every model call goes through one module, `packages/core/src/llm.ts`.

## Commands

- `pnpm install`
- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm zoning <command>` — run the CLI from the workspace

## Conventions

- Every model response is JSON validated with a zod schema. If it fails validation, retry once, then fail with a clear error. Never guess.
- Cache model results in `.zoning/cache/`, keyed by file content hash, so the same file version is never sent twice.
- Any line number a model cites must exist in the diff or file it was given. Drop citations that don't, and log that they were dropped.
- Unit-test the pure functions in `core`. Use the fixture repo in `tests/fixtures/shop` (a tiny fake shop with payment, auth, cart and utils files that import each other).
- Small commits, one change each, with a clear message.

## Definition of done for every task

- `pnpm typecheck`, `pnpm lint` and `pnpm test` pass.
- The README's "How to run" steps still work.
- End with a short summary: what changed, how to try it, and anything you skipped or are unsure about.
