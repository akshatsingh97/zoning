# Zoning — product spec

## Problem

AI coding agents now edit production code, including payments, auth and infrastructure. Most of their changes are harmless, but a single unreviewed edit in a high-blast-radius file can cost real money. Today's safeguards (code owners, branch protection, agent rule files) act at merge time or are only advice the agent may ignore.

Zoning puts scrutiny where mistakes hurt: in proportion to a file's blast radius, at the moment the agent edits it, and backed by a commit guard.

Hackathon problem statement this answers: **Build for Your World** — "Bring Meta's models into your domain. Solve a problem you know firsthand, free up time and mental space, and make something possible that wasn't before." Zoning answers it for the world developers now live in: AI coding agents editing production code, governed by Muse Spark. Scrutiny lands where mistakes hurt — in proportion to a file's blast radius, at the moment the agent edits it, backed by a commit guard.

## Concepts

- **Zone** — one of three tiers for every file:
  - `critical`: money, auth/permissions, infra, migrations. Changes need an active intent contract.
  - `shared`: imported by many modules. Changes show their blast radius; no contract needed.
  - `open`: everything else. No friction, no model calls.
- **`zones.yml`** — the committed zone map, edited by an admin. Zoning only ever writes `zones.suggested.yml`; it never overwrites `zones.yml`.
- **Intent contract** — written by the developer before a Critical change: the task, the files in scope, what should change, and what must not change.
- **Drive-by edit** — a change to a Critical file that is not in the active contract's scope.

## File formats

`zones.yml`:

```yaml
version: 1
critical:
  - path: packages/payment/**
    reason: handles money
shared:
  - path: packages/utils/pricing.ts
    reason: imported by many modules
# every file not listed is open
```

Contract, stored at `.zoning/contracts/<slug>.yml`; the active one is recorded in `.zoning/active.json`:

```yaml
task: Add a retry to payment capture
in_scope:
  - packages/payment/capture.ts
must_change:
  - Retry capture on a network error
must_not_change:
  - Never charge a customer twice
  - Keep the capture response shape the same
```

Validate both with zod schemas in `packages/core`.

## Components

### 1. `zoning scan <repo>`

Signals per file:

- **Fan-in**: how many files import it (from the import graph).
- **Path rules**: default patterns for payment, billing, checkout, auth, session, permission, migration, terraform, infra and CI workflow files. Configurable.
- **Hotfix count**: commits in the file's git history whose message matches `fix|hotfix|revert`.
- **Muse Spark tag** (milestone M2): for the top candidates only (cap per run, configurable), send the path and the first part of the file. Response schema: `{ handles: ("money" | "personal_data" | "permissions" | "infra" | "none")[], confidence: "low" | "medium" | "high", reason: string }`.

Tier rule (configurable thresholds): `critical` if a path rule for money, auth or infra matches, or Spark tags money or permissions with high confidence; `shared` if fan-in is at or above the threshold; otherwise `open`.

Output: `zones.suggested.yml` with a reason on every entry, plus a terminal summary.

### 2. `zoning contract new`

Interactive prompts (or flags) for task, files in scope, must change, must not change. Writes the contract and makes it active.

Then Muse Spark reads the contract and the in-scope files and returns up to 3 **gap questions** about rules that seem to be missing, e.g. "What should happen if capture succeeds but the response times out?" Schema: `{ questions: string[] }`. Zoning shows them; the developer decides whether to edit the contract. Spark never writes or edits the contract itself.

### 3. `zoning watch`

Watches the target repo (ignoring `node_modules`, `.git`, `.zoning`). On each change, looks up the zone and emits an event:

- `critical` and not in the active contract's scope → `drive_by` (printed loudly)
- `critical` and in scope → `in_scope_change`
- `shared` → `shared_change` with the list of importers
- `open` → `open_change` (no model call)

Events are printed in the terminal and sent to the server.

### 4. `zoning check`

Takes the diff (staged and unstaged) of the in-scope files, sends the contract and the diff hunks to Muse Spark. Schema:

```ts
{
  verdict: "pass" | "fail",
  violations: { rule: string; file: string; line: number; explanation: string }[],
  out_of_scope: string[]
}
```

Drop any violation whose line isn't in the diff. Store results in `.zoning/checks/`, keyed by diff hash.

### 5. `zoning guard` and `zoning install-hook`

`install-hook` writes a git pre-commit hook that runs `zoning guard`. The guard fails the commit when:

- a staged Critical file is not covered by the active contract (drive-by), or
- there is no passing check for the current diff of the in-scope files.

Shared files pass with a printed blast-radius warning. Open files pass silently.

### 6. Server and dashboard

Server endpoints: `GET /zones`, `GET /blast-radius?file=`, `GET /events` (server-sent events), `GET /checks`, `GET /contract`.

Dashboard views:

- **Zone map**: files grouped by folder, coloured by tier, with counts.
- **File panel**: tier, reason, Spark's tag, and the files that import it.
- **Live feed**: events from the watcher; drive-by edits stand out.
- **Contract**: the active contract, gap questions, and the latest check result with the exact lines that break a rule.

### 7. Muse Code skill and `zoning init`

`zoning init` writes `zones.suggested.yml` (via scan), installs the hook, and adds a Muse Code skill at `.agents/skills/zoning/SKILL.md` in the target repo. The skill tells the agent: before editing a file, run `zoning zone <file>`; if it is Critical and not covered by the active contract, stop and ask the developer to create one. The skill is guidance; the watcher and guard enforce.

Add `zoning zone <file>` (prints tier and reason) for the skill to call.

## Milestones (build in this order)

| # | Milestone | Done when |
| --- | --- | --- |
| M1 | Workspace, fixture repo, `zoning scan` without model calls | Scan on `tests/fixtures/shop` puts payment and auth files in critical and the most-imported util in shared |
| M2 | `llm.ts`, Spark tagging with cache | Second scan run makes zero model calls |
| M3 | Contracts and gap questions | `contract new` writes a valid contract and prints up to 3 questions |
| M4 | `watch` and drive-by detection | Editing a Critical file outside scope prints a drive-by event |
| M5 | `check` | A diff that retries without an idempotency safeguard fails against "Never charge a customer twice" |
| M6 | `guard` and `install-hook` | The drive-by commit and the failing-check commit are both blocked |
| M7 | Server and dashboard | The full M4–M6 flow is visible live in the browser |
| M8 | `init`, `zone`, and the Muse Code skill | Running `zoning init` on a fresh clone sets everything up |

## Out of scope

VS Code extension, languages other than TypeScript/JavaScript, user accounts, cloud hosting, per-person metrics or scores.
