# Zoning

**Zoning laws for AI in your codebase.**

AI coding agents work freely in most of the code. Files with a big blast radius, like payments, auth and infra, need a permit: a short intent contract in the developer's own words, checked by Muse Spark before the change can land.

Built during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026),
Indie Developer track, for the **Build for Your World** problem statement
("a problem you know firsthand"): AI coding agents editing production code
need scrutiny where mistakes hurt — in proportion to a file's blast radius,
at the moment the agent edits it, backed by a commit guard. Everything in
this repo — scan, contracts, watcher, check, guard, server, dashboard, skill —
was built during the hackathon.

## How it works

- **Zone map** — `zoning scan` ranks every file by blast radius and tags what it handles with Muse Spark. Files are Critical, Shared or Open.
- **Live guard** — `zoning watch` flags drive-by edits to Critical files the moment an agent makes them.
- **Intent contracts** — before a Critical change, the developer writes what should change and what must never change. Muse Spark asks about missing rules, then checks the diff against the contract.
- **Commit guard** — a pre-commit hook blocks drive-by edits and diffs that break a contract.
- **Dashboard** — a live view of zones, edits and contract checks.

See [`docs/SPEC.md`](docs/SPEC.md) for the full spec and [`AGENTS.md`](AGENTS.md) for the rules coding agents follow in this repo.

## How to run

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm build
pnpm zoning scan tests/fixtures/shop
```

This scans the fixture shop and writes `tests/fixtures/shop/zones.suggested.yml`
with the suggested Critical and Shared files. Copy entries into `zones.yml`
after review — Zoning never writes `zones.yml` itself.

For Muse Spark tagging (shared files that handle money or permissions with
high confidence become Critical), copy `.env.example` to `.env`, set
`MODEL_API_KEY`, and scan again. Tag results are cached in
`<repo>/.zoning/cache/` by file content hash, so an unchanged second run makes
zero model calls. `pnpm zoning scan --no-spark <repo>` skips tagging;
`--spark-top-n <n>` caps files sent per run.

Before a Critical change, write an intent contract (missing flags are prompted
interactively):

```sh
pnpm zoning contract new tests/fixtures/shop \
  --task "Add a retry to payment capture" \
  --scope packages/payment/capture.ts \
  --must-change "Retry capture on a network error" \
  --must-not "Never charge a customer twice"
```

This writes `.zoning/contracts/<slug>.yml`, makes it active, and — with
`MODEL_API_KEY` set — prints up to 3 gap questions from Muse Spark about rules
the contract may be missing. Spark never edits the contract; you decide what
to add.

To watch a repo, it needs a committed `zones.yml` (copy the reviewed
suggestions over), then:

```sh
cp tests/fixtures/shop/zones.suggested.yml tests/fixtures/shop/zones.yml
pnpm zoning watch tests/fixtures/shop
```

Every edit prints an event: Critical files outside the active contract's scope
raise a `DRIVE-BY EDIT` banner, in-scope Critical edits print quietly, Shared
edits show their importers, Open edits print one line. Use `--poll` where
native file watching is unavailable, and `--server-url` streams events to
the dashboard server.

After editing, judge the in-scope diff against the active contract (needs
`MODEL_API_KEY`):

```sh
pnpm zoning check tests/fixtures/shop
```

This sends the contract and the staged + unstaged diff hunks to Muse Spark,
prints `PASS` or `FAIL` with the exact `file:line` breaks, and stores the
result in `.zoning/checks/` keyed by diff hash. Citations outside the diff are
dropped. Exit code is 1 on failure.

To enforce the rules at commit time, install the pre-commit hook (needs
`zones.yml` in the target repo):

```sh
pnpm zoning install-hook tests/fixtures/shop
```

The hook runs `zoning guard`, which blocks the commit when a staged Critical
file is outside the active contract's scope, or when there is no passing
`zoning check` for the current in-scope diff. Staged Shared files print a
blast-radius warning; Open files pass silently.

To see the full flow live in the browser, start the server (API + dashboard):

```sh
pnpm zoning server tests/fixtures/shop --port 3000
```

Then open http://127.0.0.1:3000 in a browser. In another terminal, point the
watcher at it so edits stream into the live feed:

```sh
pnpm zoning watch tests/fixtures/shop --server-url http://127.0.0.1:3000
```

Contracts, gap questions and check results appear as you work. For dashboard
development, `pnpm --filter @zoning/dashboard dev` proxies the API from port
3000.

On a fresh repo, one command sets everything up (scan, hook, agent skill):

```sh
pnpm zoning init <repo>
```

Then copy `zones.suggested.yml` to `zones.yml` and review it. Tip: prefer
directory globs like `packages/payment/**` in `zones.yml` so new files in
sensitive folders are covered automatically — anything not listed is open.

Agents check a file before editing it with:

```sh
pnpm zoning zone <file> <repo>
```

which prints the tier, reason, and contract coverage (`--json` for machines).
The skill at `.agents/skills/zoning/SKILL.md` tells the agent to stop and ask
for a contract when a file is Critical and uncovered.

Other commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`.

## Which Meta model does what

Zoning uses one Meta model, **Muse Spark 1.3** (`muse-spark-1.3` via the Meta
Model API, overridable with `ZONING_MODEL`), in three places:

- **File tagging** (`zoning scan`) — the top candidates only (capped per run)
  are sent as path + first 4000 characters; Spark returns what each file
  handles (`money`, `personal_data`, `permissions`, `infra`, `none`) with a
  confidence and reason. Money or permissions at high confidence makes a file
  Critical. Results are cached by content hash; Open-zone files are never
  sent.
- **Gap questions** (`zoning contract new`) — Spark reads the contract and the
  in-scope files and returns up to 3 questions about rules that seem to be
  missing. It never writes or edits the contract.
- **Contract check** (`zoning check`) — Spark judges the in-scope diff against
  the contract and returns a pass/fail verdict with exact `file:line`
  citations; citations outside the diff are dropped.

## Built with

- Muse Spark 1.3 via the Meta Model API (see above)
- Muse Code, the coding agent Zoning governs in the demo
