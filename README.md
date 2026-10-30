# Zoning

**Zoning laws for AI in your codebase.**

AI coding agents work freely in most of the code. Files with a big blast radius, like payments, auth and infra, need a permit: a short intent contract in the developer's own words, checked by Muse Spark before the change can land.

Built for the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026), Indie Developer track.

## How it works

- **Zone map** — `zoning scan` ranks every file by blast radius and tags what it handles with Muse Spark. Files are Critical, Shared or Open.
- **Live guard** — `zoning watch` flags drive-by edits to Critical files the moment an agent makes them.
- **Intent contracts** — before a Critical change, the developer writes what should change and what must never change. Muse Spark asks about missing rules, then checks the diff against the contract.
- **Commit guard** — a pre-commit hook blocks drive-by edits and diffs that break a contract.
- **Dashboard** — a live view of zones, edits and contract checks.

See [`docs/SPEC.md`](docs/SPEC.md) for the full spec and [`AGENTS.md`](AGENTS.md) for the rules coding agents follow in this repo.

## How to run

Coming with milestone M1.

## Built with

- Muse Spark 1.3 via the Meta Model API
- Muse Code, the coding agent Zoning governs in the demo
