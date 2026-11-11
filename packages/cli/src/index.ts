#!/usr/bin/env node
import { Command } from 'commander';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BriefError,
  citability,
  createRun,
  findProject,
  finishRun,
  formatBibtex,
  formatBriefJson,
  formatBriefSummary,
  formatCsl,
  formatCsv,
  formatSearchJson,
  formatTable,
  hashSnapshot,
  initProject,
  isCitable,
  openProject,
  readBrief,
  replayRun,
  saveBrief,
  savePayload,
  saveRunSources,
  searchLiterature,
  snapshotForRankedSources,
  verifyDoi,
  type ParsedBrief,
  type RankedSource,
  type VerificationRecord,
  type VerifiedDoi,
} from '@michaelborck/winnow-core';

const VERSION = '0.1.0';

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

interface SearchCliOptions {
  project?: string;
  brief?: string;
  limit: string;
  since?: string;
  until?: string;
  type?: string;
  openAccess?: boolean;
  provider: string;
  format: string;
  out?: string;
  save: boolean;
  abstracts: boolean;
  checkLinks?: boolean;
  mailto?: string;
}

interface VerifyCliOptions {
  format: string;
  out?: string;
  links: boolean;
  mailto?: string;
}

const program = new Command();

program
  .name('winnow')
  .description('Find, verify, and weigh the literature. Locally.')
  .version(VERSION);

program
  .command('init <name>')
  .description('Create a project folder and database')
  .option('--path <dir>', 'parent directory (default: current directory)')
  .action(async (name: string, options: { path?: string }) => {
    try {
      const project = await initProject(name, options.path);
      project.db.close();
      process.stdout.write(`Created ${project.root}\n`);
      process.stdout.write(
        `Project database: ${path.join(project.root, '.winnow', 'project.sqlite')}\n`,
      );
      process.exitCode = 0;
    } catch (error) {
      throw new UsageError(error instanceof Error ? error.message : String(error));
    }
  });

program
  .command('brief <file>')
  .description('Validate a brief file and print its parsed fields')
  .option('--format <format>', 'text or json', 'text')
  .action(async (file: string, options: { format: string }) => {
    const format = parseFormat(options.format, ['text', 'json']);
    try {
      const parsed = await readBrief(file);
      if (format === 'json' && parsed.warnings.length) {
        for (const warning of parsed.warnings) {
          process.stderr.write(`winnow: ${warning.field}: ${warning.message}\n`);
        }
      }
      const output =
        format === 'json'
          ? formatBriefJson(parsed.brief)
          : formatBriefSummary(parsed);
      await emit(output);
      process.exitCode = 0;
    } catch (error) {
      if (error instanceof BriefError) throw new UsageError(error.message);
      throw error;
    }
  });

program
  .command('search [topic]')
  .description('Explore: retrieve, deduplicate, verify, rank and select sources')
  .option('--project <path>', 'project directory or name (default: nearest project)')
  .option('--brief <file>', 'brief file with question, thesis and filters')
  .option('--limit <n>', 'maximum selected sources', '20')
  .option('--since <year>', 'earliest publication year')
  .option('--until <year>', 'latest publication year')
  .option('--type <type>', 'source type filter, e.g. article or preprint')
  .option('--open-access', 'only sources with an open-access link')
  .option('--provider <list>', 'comma-separated providers', 'openalex,crossref')
  .option('--format <format>', 'table, json, csv, bibtex or csl', 'table')
  .option('--out <file>', 'write output to a file')
  .option('--no-save', 'do not write the run to a project database')
  .option('--no-abstracts', 'omit abstracts from table output')
  .option('--check-links', 'probe landing pages (slow; informational only)')
  .option('--mailto <email>', 'polite-pool email for scholarly APIs')
  .action(async (topicArg: string | undefined, options: SearchCliOptions) => {
    let parsedBrief: ParsedBrief | undefined;
    if (options.brief) {
      try {
        parsedBrief = await readBrief(options.brief);
      } catch (error) {
        if (error instanceof BriefError) throw new UsageError(error.message);
        throw error;
      }
      for (const warning of parsedBrief.warnings) {
        process.stderr.write(`winnow: ${warning.field}: ${warning.message}\n`);
      }
    }

    const topic =
      topicArg?.trim() ||
      parsedBrief?.brief.question ||
      parsedBrief?.brief.thesis;
    if (!topic) {
      throw new UsageError('Provide a topic, or a brief with a question or thesis');
    }

    const limit = parseLimit(options.limit);
    const since =
      parseYear(options.since, 'since') ?? parsedBrief?.brief.filters.since;
    const until =
      parseYear(options.until, 'until') ?? parsedBrief?.brief.filters.until;
    if (since && until && since > until) {
      throw new UsageError('--since must not be later than --until');
    }

    const types = options.type
      ? options.type
          .split(',')
          .map((type) => type.trim())
          .filter(Boolean)
      : parsedBrief?.brief.filters.types;

    const openAccessOnly =
      options.openAccess === true ||
      parsedBrief?.brief.filters.openAccess === true;

    if (parsedBrief?.brief.counter) {
      process.stderr.write(
        'winnow: counter-evidence is not implemented yet; brief.counter ignored\n',
      );
    }
    if (parsedBrief?.brief.filters.languages.length) {
      process.stderr.write(
        'winnow: language filtering is not available yet; filters.languages ignored\n',
      );
    }

    const format = parseFormat(options.format, ['table', 'json', 'csv', 'bibtex', 'csl']);
    const projectRoot = options.save
      ? await resolveProjectRoot(options.project)
      : null;

    const result = await searchLiterature(topic, {
      limit,
      since,
      until,
      type: options.type,
      types,
      openAccessOnly,
      providers: options.provider
        .split(',')
        .map((provider) => provider.trim())
        .filter(Boolean),
      mailto: options.mailto,
      checkLinks: options.checkLinks === true,
    });

    const snapshot = snapshotForRankedSources(result.runId, result.query, result.sources);
    const selected = result.sources.filter((source) => source.selected);

    let savedPath: string | null = null;
    let briefId: string | null = null;
    if (projectRoot) {
      const project = await openProject(projectRoot);
      try {
        if (parsedBrief) {
          briefId = saveBrief(project.db, parsedBrief.brief);
        }
        createRun(project.db, {
          id: result.runId,
          query: result.query,
          config: {
            limit,
            since,
            until,
            type: options.type,
            types,
            openAccessOnly,
            providers: options.provider,
            checkLinks: options.checkLinks === true,
            mailto: options.mailto ?? null,
            briefId,
            briefPath: parsedBrief?.brief.path ?? null,
          },
        });
        for (const payload of result.payloads) {
          await savePayload(project.db, project.root, result.runId, payload);
        }
        saveRunSources(project.db, result.runId, result.query, result.sources);
        finishRun(project.db, result.runId, {
          outputSha256: hashSnapshot(snapshot),
          stages: {
            retrieve: result.failures.length ? 'partial' : 'ok',
            verify: 'ok',
            rank: 'ok',
          },
          componentHealth: {
            failed: result.failures.length > 0,
            failures: result.failures,
          },
        });
        savedPath = project.root;
      } finally {
        project.db.close();
      }
    }

    const output = renderSearchOutput(format, result, selected, options.abstracts);
    await emit(output, options.out);
    emitSearchSummary(result, savedPath, options.out);

    if (result.failures.length > 0) process.exitCode = 1;
    else if (result.citableCount === 0) process.exitCode = 3;
    else process.exitCode = 0;
  });

program
  .command('verify <target>')
  .description('Verify a DOI, or every DOI found in a text file')
  .option('--format <format>', 'table or json', 'table')
  .option('--out <file>', 'write output to a file')
  .option('--no-links', 'skip landing-page probes')
  .option('--mailto <email>', 'polite-pool email for scholarly APIs')
  .action(async (target: string, options: VerifyCliOptions) => {
    const format = parseFormat(options.format, ['table', 'json']);
    const dois = await targetsFrom(target);
    const results: Array<{ doi: string } & VerifiedDoi> = [];

    for (const doi of dois) {
      const { record, work } = await verifyDoi(doi, {
        mailto: options.mailto,
        checkLinks: options.links,
      });
      results.push({ doi, record, work });
    }

    const output =
      format === 'json'
        ? `${JSON.stringify(
            results.map((item) => ({
              doi: item.doi,
              citability: citability(item.record),
              verification: item.record,
              work: item.work,
            })),
            null,
            2,
          )}\n`
        : renderVerifyTable(results);

    await emit(output, options.out);
    if (options.out) {
      process.stderr.write(`wrote ${options.out}\n`);
    }

    const incomplete = results.some(
      (item) => item.record.completeness.status === 'incomplete',
    );
    const citable = results.some((item) => isCitable(citability(item.record)));
    if (incomplete) process.exitCode = 1;
    else if (!citable) process.exitCode = 3;
    else process.exitCode = 0;
  });

program
  .command('replay <runId>')
  .description('Re-derive deterministic outputs from stored payloads and compare hashes')
  .option('--project <path>', 'project directory or name (default: nearest project)')
  .action(async (runId: string, options: { project?: string }) => {
    const root = await requireProjectRoot(options.project);
    const project = await openProject(root);
    try {
      const result = await replayRun(project.db, project.root, runId);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result.ok ? 0 : 1;
    } finally {
      project.db.close();
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`winnow: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  process.stderr.write(
    `winnow: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

async function resolveProjectRoot(explicit?: string): Promise<string | null> {
  if (explicit) {
    const direct = path.resolve(explicit);
    if (await isProject(direct)) return direct;
    const named = path.resolve(process.cwd(), explicit);
    if (await isProject(named)) return named;
    throw new UsageError(`Not a Winnow project: ${explicit}`);
  }
  return findProject(process.cwd());
}

async function requireProjectRoot(explicit?: string): Promise<string> {
  const root = await resolveProjectRoot(explicit);
  if (!root) {
    throw new UsageError('No Winnow project found. Run `winnow init <name>` first.');
  }
  return root;
}

async function isProject(root: string): Promise<boolean> {
  try {
    const info = await stat(path.join(root, '.winnow', 'project.json'));
    return info.isFile();
  } catch {
    return false;
  }
}

function parseFormat(value: string, allowed: string[]): string {
  const clean = value.toLowerCase();
  if (!allowed.includes(clean)) {
    throw new UsageError(`--format must be one of: ${allowed.join(', ')}`);
  }
  return clean;
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new UsageError('--limit must be a positive integer');
  }
  return parsed;
}

function parseYear(value: string | undefined, name: string): number | undefined {
  if (value == null) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1000 || parsed > 3000) {
    throw new UsageError(`--${name} must be a four-digit year`);
  }
  return parsed;
}

async function targetsFrom(target: string): Promise<string[]> {
  const direct = target.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();
  if (/^10\.\d{4,9}\//i.test(direct)) return [direct];

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new UsageError(`Not a file: ${target}`);
    const text = await readFile(target, 'utf8');
    const matches = text.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/gi) ?? [];
    const unique = [...new Set(matches.map((doi) => doi.replace(/[.,;]+$/, '').toLowerCase()))];
    if (!unique.length) throw new UsageError(`No DOIs found in ${target}`);
    return unique;
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(`Expected a DOI or a readable text file: ${target}`);
  }
}

function renderSearchOutput(
  format: string,
  result: Awaited<ReturnType<typeof searchLiterature>>,
  selected: RankedSource[],
  abstracts: boolean,
): string {
  switch (format) {
    case 'json':
      return formatSearchJson(result);
    case 'csv':
      return formatCsv(result.sources);
    case 'bibtex':
      return formatBibtex(selected);
    case 'csl':
      return formatCsl(selected);
    default:
      return `${formatTable(result.sources, abstracts)}\n`;
  }
}

function renderVerifyTable(
  results: Array<{ doi: string; record: VerificationRecord; work: unknown }>,
): string {
  const rows = results.map((item) => {
    const value = citability(item.record);
    return [
      truncate(item.doi, 36),
      item.record.identity,
      item.record.matchCategory,
      item.record.integrity.join(';'),
      item.record.linkStatus,
      value,
    ];
  });
  const headers = ['DOI', 'IDENTITY', 'MATCH', 'INTEGRITY', 'LINK', 'CITABILITY'];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]!.length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index]!)).join('  ').trimEnd();

  return [
    line(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(line),
    '',
  ].join('\n');
}

function emitSearchSummary(
  result: Awaited<ReturnType<typeof searchLiterature>>,
  savedPath: string | null,
  out?: string,
): void {
  const destination = out ? `wrote ${out}` : savedPath ? `saved in ${savedPath}` : 'not saved';
  process.stderr.write(
    `${result.retrieved} retrieved, ${result.unique} unique, ` +
      `${result.selectedCount} selected, ${result.citableCount} citable; ` +
      `run ${result.runId} (${destination})\n`,
  );
  if (result.failures.length) {
    process.stderr.write(
      `provider failures: ${result.failures
        .map((failure) => `${failure.provider} (${failure.reason})`)
        .join(', ')}\n`,
    );
  }
}

async function emit(text: string, out?: string): Promise<void> {
  const content = text.endsWith('\n') ? text : `${text}\n`;
  if (out) {
    const absolute = path.resolve(out);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
    return;
  }
  process.stdout.write(content);
}

function truncate(value: string, length: number): string {
  if (value.length <= length) return value;
  return `${value.slice(0, Math.max(0, length - 1))}…`;
}
