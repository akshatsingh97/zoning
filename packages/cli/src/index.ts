#!/usr/bin/env node
import { Command } from 'commander';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CACHE_DIR,
  CHECKS_DIR,
  collectScopeDiff,
  createChatFn,
  describeZone,
  fileGapsCache,
  formatEvent,
  formatGuardResult,
  installHook,
  llmConfigFromEnv,
  loadDotEnv,
  normalizeScopePath,
  readActiveContract,
  requestGapQuestions,
  resolveScopeFile,
  runCheck,
  runGuard,
  runInit,
  scanRepo,
  scanRepoWithTags,
  setActiveContract,
  sparkFromEnv,
  watchRepo,
  writeContract,
  writeGapQuestions,
  writeSuggestedZones,
  ZONING_DIR,
  type ScannedFile,
  type WatchHandle,
} from '@zoning/core';
import { startServer } from '@zoning/server';
import { ask, flattenLists } from './prompt.js';

const program = new Command();
program.name('zoning').description('Zoning laws for AI in your codebase.').version('0.1.0');

function printSummary(files: ScannedFile[]): void {
  const critical = files.filter((f) => f.tier === 'critical');
  const shared = files.filter((f) => f.tier === 'shared');
  const open = files.filter((f) => f.tier === 'open');
  console.log(`Scanned ${files.length} files.`);
  console.log(`Critical: ${critical.length}, shared: ${shared.length}, open: ${open.length}.`);
  for (const f of critical) console.log(`  critical  ${f.file} — ${f.reason}`);
  for (const f of shared) console.log(`  shared    ${f.file} — ${f.reason}`);
}

program
  .command('scan')
  .argument('<repo>', 'path to the repo to scan')
  .option('--no-hotfixes', 'skip git hotfix counts')
  .option('--shared-fan-in <n>', 'fan-in threshold for shared tier', (v) => Number.parseInt(v, 10))
  .option('--no-spark', 'skip Muse Spark tagging')
  .option('--spark-top-n <n>', 'max files to send to Spark per run', (v) =>
    Number.parseInt(v, 10),
  )
  .description('Scan a repo and write zones.suggested.yml')
  .action(
    async (
      repo: string,
      opts: { hotfixes: boolean; sharedFanIn?: number; spark: boolean; sparkTopN?: number },
    ) => {
      loadDotEnv();
      const repoRoot = resolve(repo);
      if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
        console.error(`zoning: no such directory: ${repo}`);
        process.exitCode = 1;
        return;
      }
      const thresholds = Number.isFinite(opts.sharedFanIn) ? { sharedFanIn: opts.sharedFanIn } : {};
      const baseOptions = { includeHotfixes: opts.hotfixes, thresholds };
      const spark = opts.spark ? sparkFromEnv() : undefined;
      if (spark !== undefined) {
        const topN = Number.isFinite(opts.sparkTopN) ? opts.sparkTopN : undefined;
        let result;
        try {
          result = await scanRepoWithTags(repoRoot, baseOptions, {
            chat: spark.chat,
            model: spark.model,
            topN,
          });
        } catch (err) {
          console.error(
            `zoning: spark tagging failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
          return;
        }
        const { files, zones, tagged, cacheHits } = result;
        printSummary(files);
        console.log(`Spark: tagged ${tagged} files (${cacheHits} from cache).`);
        const outPath = writeSuggestedZones(repoRoot, zones);
        console.log(`Wrote ${outPath}`);
      } else {
        if (opts.spark) {
          console.log('Spark tagging skipped: set MODEL_API_KEY in .env to enable it.');
        }
        const { files, zones } = scanRepo(repoRoot, baseOptions);
        printSummary(files);
        const outPath = writeSuggestedZones(repoRoot, zones);
        console.log(`Wrote ${outPath}`);
      }
    },
  );

program
  .command('watch')
  .argument('<repo>', 'path to the repo to watch')
  .option('--server-url <url>', 'server to send events to')
  .option('--poll', 'poll for changes instead of native watching')
  .description('Watch a repo and report edits by zone')
  .action(async (repo: string, opts: { serverUrl?: string; poll?: boolean }) => {
    loadDotEnv();
    const repoRoot = resolve(repo);
    if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
      console.error(`zoning: no such directory: ${repo}`);
      process.exitCode = 1;
      return;
    }
    let handle: WatchHandle;
    try {
      handle = await watchRepo(repoRoot, {
        serverUrl: opts.serverUrl,
        usePolling: opts.poll ?? false,
        onEvent: (event) => console.log(formatEvent(event)),
        onError: (err) => console.error(`zoning: watch error: ${err.message}`),
      });
    } catch (err) {
      console.error(`zoning: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
    await handle.ready();
    console.log(`Watching ${repoRoot} (Ctrl-C to stop).`);
    const stop = async (): Promise<void> => {
      await handle.stop();
      process.exit(0);
    };
    process.on('SIGINT', () => void stop());
    process.on('SIGTERM', () => void stop());
  });

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

const contract = program.command('contract').description('Manage intent contracts');

contract
  .command('new')
  .argument('[repo]', 'path to the repo (default: current directory)', '.')
  .option('--task <text>', 'what the change should do')
  .option('--scope <files>', 'comma-separated in-scope files (repeatable)', collect, [])
  .option('--must-change <rules>', 'comma-separated must-change rules (repeatable)', collect, [])
  .option('--must-not <rules>', 'comma-separated must-not-change rules (repeatable)', collect, [])
  .description('Write a new intent contract and make it active')
  .action(
    async (
      repo: string,
      opts: { task?: string; scope: string[]; mustChange: string[]; mustNot: string[] },
    ) => {
      loadDotEnv();
      const repoRoot = resolve(repo);
      if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
        console.error(`zoning: no such directory: ${repo}`);
        process.exitCode = 1;
        return;
      }
      let task = opts.task?.trim() ?? '';
      let scope = flattenLists(opts.scope).map(normalizeScopePath);
      let mustChange = flattenLists(opts.mustChange);
      let mustNot = flattenLists(opts.mustNot);
      if (task === '' || scope.length === 0) {
        if (!process.stdin.isTTY) {
          console.error('zoning: --task and --scope are required (no interactive terminal)');
          process.exitCode = 1;
          return;
        }
        try {
          if (task === '') task = (await ask('Task:')).trim();
          if (scope.length === 0) {
            scope = flattenLists([await ask('Files in scope (comma-separated):')]).map(
              normalizeScopePath,
            );
          }
          if (mustChange.length === 0) {
            mustChange = flattenLists([
              await ask('Must change (comma-separated, empty to skip):'),
            ]);
          }
          if (mustNot.length === 0) {
            mustNot = flattenLists([
              await ask('Must not change (comma-separated, empty to skip):'),
            ]);
          }
        } catch {
          console.error('zoning: cannot read interactive input — pass flags instead');
          process.exitCode = 1;
          return;
        }
        if (task === '' || scope.length === 0) {
          console.error('zoning: task and at least one in-scope file are required');
          process.exitCode = 1;
          return;
        }
      }
      let absPaths: string[];
      try {
        absPaths = scope.map((f) => resolveScopeFile(repoRoot, f));
      } catch (err) {
        console.error(`zoning: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }
      const { slug, path } = writeContract(repoRoot, {
        task,
        in_scope: scope,
        must_change: mustChange,
        must_not_change: mustNot,
      });
      setActiveContract(repoRoot, slug);
      console.log(`Wrote ${path}`);
      console.log(`Active contract: ${slug}`);
      const config = llmConfigFromEnv();
      if (config === undefined) {
        console.log('Gap questions skipped: set MODEL_API_KEY in .env to enable them.');
        return;
      }
      const files = scope.map((file, i) => ({
        file,
        content: readFileSync(absPaths[i] as string, 'utf8'),
      }));
      try {
        const { questions } = await requestGapQuestions(
          createChatFn(config),
          config.model,
          fileGapsCache(join(repoRoot, ZONING_DIR, CACHE_DIR)),
          { task, in_scope: scope, must_change: mustChange, must_not_change: mustNot },
          files,
        );
        writeGapQuestions(repoRoot, slug, questions);
        if (questions.length === 0) {
          console.log('No gap questions — the contract already covers the risks.');
        } else {
          console.log('Gap questions (edit the contract if any apply):');
          questions.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
        }
      } catch (err) {
        console.error(
          `zoning: gap questions failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    },
  );

program
  .command('check')
  .argument('[repo]', 'path to the repo (default: current directory)', '.')
  .description('Judge the in-scope diff against the active contract')
  .action(async (repo: string) => {
    loadDotEnv();
    const repoRoot = resolve(repo);
    if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
      console.error(`zoning: no such directory: ${repo}`);
      process.exitCode = 1;
      return;
    }
    const active = readActiveContract(repoRoot);
    if (active === undefined) {
      console.error('zoning: no active contract — create one with "zoning contract new" first');
      process.exitCode = 1;
      return;
    }
    let diff;
    try {
      diff = collectScopeDiff(repoRoot, active.contract.in_scope);
    } catch (err) {
      console.error(`zoning: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
    if (diff.empty) {
      console.log('No changes in scope — nothing to check.');
      return;
    }
    const config = llmConfigFromEnv();
    if (config === undefined) {
      console.error('zoning: check needs MODEL_API_KEY in .env');
      process.exitCode = 1;
      return;
    }
    try {
      const run = await runCheck(
        createChatFn(config),
        config.model,
        join(repoRoot, ZONING_DIR, CHECKS_DIR),
        active.slug,
        active.contract,
        diff.text,
      );
      if (run.cached) console.log('(result from the stored check for this diff)');
      for (const v of run.result.violations) {
        console.log(`  ${v.file}:${v.line} breaks "${v.rule}" — ${v.explanation}`);
      }
      if (run.result.out_of_scope.length > 0) {
        console.log(`Out of scope: ${run.result.out_of_scope.join(', ')}`);
      }
      if (run.dropped > 0) {
        console.log(`Dropped ${run.dropped} citation(s) outside the diff.`);
      }
      console.log(
        run.result.verdict === 'pass'
          ? `PASS: the diff keeps the contract (${active.slug}).`
          : `FAIL: the diff breaks the contract (${active.slug}).`,
      );
      console.log(`Stored ${run.path}`);
      if (run.result.verdict === 'fail') process.exitCode = 1;
    } catch (err) {
      console.error(
        `zoning: check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
    }
  });

program
  .command('guard')
  .argument('[repo]', 'path to the repo (default: current directory)', '.')
  .description('Fail when the staged commit breaks zoning rules')
  .action(async (repo: string) => {
    loadDotEnv();
    const repoRoot = resolve(repo);
    if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
      console.error(`zoning: no such directory: ${repo}`);
      process.exitCode = 1;
      return;
    }
    try {
      const result = runGuard(repoRoot);
      const text = formatGuardResult(result);
      if (text !== '') console.log(text);
      if (!result.ok) process.exitCode = 1;
    } catch (err) {
      console.error(`zoning: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

program
  .command('install-hook')
  .argument('[repo]', 'path to the repo (default: current directory)', '.')
  .description('Install a git pre-commit hook that runs zoning guard')
  .action(async (repo: string) => {
    const repoRoot = resolve(repo);
    if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
      console.error(`zoning: no such directory: ${repo}`);
      process.exitCode = 1;
      return;
    }
    try {
      const { path, created } = installHook(repoRoot, fileURLToPath(import.meta.url));
      console.log(created ? `Installed ${path}` : `Updated ${path}`);
    } catch (err) {
      console.error(`zoning: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

program
  .command('server')
  .argument('[repo]', 'path to the repo (default: current directory)', '.')
  .option('--port <n>', 'port to listen on', (v) => Number.parseInt(v, 10), 3000)
  .description('Serve the zoning API and dashboard')
  .action(async (repo: string, opts: { port: number }) => {
    loadDotEnv();
    const repoRoot = resolve(repo);
    if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
      console.error(`zoning: no such directory: ${repo}`);
      process.exitCode = 1;
      return;
    }
    const port = Number.isFinite(opts.port) ? opts.port : 3000;
    try {
      const { url } = await startServer(repoRoot, port);
      console.log(`Zoning dashboard: ${url}`);
      console.log('Press Ctrl-C to stop.');
    } catch (err) {
      console.error(
        `zoning: cannot start server: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
    }
  });

program
  .command('init')
  .argument('[repo]', 'path to the repo (default: current directory)', '.')
  .option('--no-spark', 'skip Muse Spark tagging')
  .option('--spark-top-n <n>', 'max files to send to Spark per run', (v) =>
    Number.parseInt(v, 10),
  )
  .description('Set up zoning in a repo: scan, hook and agent skill')
  .action(async (repo: string, opts: { spark: boolean; sparkTopN?: number }) => {
    loadDotEnv();
    const repoRoot = resolve(repo);
    if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
      console.error(`zoning: no such directory: ${repo}`);
      process.exitCode = 1;
      return;
    }
    const spark = opts.spark ? sparkFromEnv() : undefined;
    if (opts.spark && spark === undefined) {
      console.log('Spark tagging skipped: set MODEL_API_KEY in .env to enable it.');
    }
    const topN = Number.isFinite(opts.sparkTopN) ? opts.sparkTopN : undefined;
    try {
      const result = await runInit(repoRoot, {
        spark: spark === undefined ? undefined : { chat: spark.chat, model: spark.model, topN },
        cliEntryAbs: fileURLToPath(import.meta.url),
      });
      const { counts } = result;
      console.log(
        `Scanned: ${counts.critical} critical, ${counts.shared} shared, ${counts.open} open.`,
      );
      if (result.tagged !== undefined) {
        console.log(
          `Spark: tagged ${result.tagged.tagged} files (${result.tagged.cacheHits} from cache).`,
        );
      }
      console.log(`Wrote ${result.suggestedPath}`);
      console.log(`${result.hookCreated ? 'Installed' : 'Updated'} ${result.hookPath}`);
      console.log(`Wrote ${result.skillPath}`);
      console.log('Next: review zones.suggested.yml into zones.yml, then run zoning watch.');
    } catch (err) {
      console.error(`zoning: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

program
  .command('zone')
  .argument('<file>', 'file to look up, relative to the repo')
  .argument('[repo]', 'path to the repo (default: current directory)', '.')
  .option('--json', 'print machine-readable JSON')
  .description("Print a file's zone tier and reason")
  .action(async (file: string, repo: string, opts: { json?: boolean }) => {
    const repoRoot = resolve(repo);
    if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
      console.error(`zoning: no such directory: ${repo}`);
      process.exitCode = 1;
      return;
    }
    try {
      const desc = describeZone(repoRoot, file);
      if (opts.json === true) {
        console.log(JSON.stringify(desc));
        return;
      }
      console.log(`${desc.file}: ${desc.tier}${desc.reason === undefined ? '' : ` — ${desc.reason}`}`);
      if (desc.tier === 'critical') {
        console.log(
          `contract: ${desc.contractSlug ?? 'none'} — ${desc.inScope ? 'in scope' : 'not covered'}`,
        );
      }
    } catch (err) {
      console.error(`zoning: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
