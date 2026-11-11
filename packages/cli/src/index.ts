#!/usr/bin/env node
import { Command } from 'commander';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import {
  BriefError,
  citability,
  createRun,
  DEFAULT_FIELDS,
  detectExtractionFormat,
  detectScreeningFormat,
  findProject,
  finishRun,
  formatBibtex,
  formatBriefJson,
  formatBriefSummary,
  formatCsl,
  formatCsv,
  formatEvidenceCsv,
  formatEvidenceJson,
  formatEvidenceTable,
  formatScreeningCsv,
  formatScreeningJson,
  formatScreeningTable,
  formatSearchJson,
  formatTable,
  getLatestRun,
  hashSnapshot,
  importExtractionValues,
  importScreeningDecisions,
  initProject,
  isCitable,
  loadExtractionState,
  loadScreeningState,
  openProject,
  parseExtractionValues,
  parseScreeningDecisions,
  readBrief,
  recordExtraction,
  recordExtractionSuggestion,
  recordScreeningDecision,
  recordScreeningSuggestion,
  replayRun,
  saveBrief,
  savePayload,
  saveRunSources,
  searchLiterature,
  snapshotForRankedSources,
  suggestExtraction,
  suggestScreening,
  verifyDoi,
  ExtractionError,
  ScreeningError,
  type ExtractionSummary,
  type ParsedBrief,
  type RankedSource,
  type ScreeningDecision,
  type ScreeningReasonCode,
  type ScreeningRelevance,
  type ScreeningState,
  type ScreeningSummary,
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

interface ScreenCliOptions {
  run?: string;
  brief?: string;
  all?: boolean;
  interactive?: boolean;
  decisions?: string;
  suggest?: boolean;
  dropExcluded?: boolean;
  reviewer?: string;
  format: string;
  out?: string;
}

interface ExtractCliOptions {
  run?: string;
  fields?: string;
  suggest?: boolean;
  interactive?: boolean;
  decisions?: string;
  reviewer?: string;
  format: string;
  out?: string;
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
  .command('screen [project]')
  .description('Record human screening decisions for a run')
  .option('--run <run-id>', 'run to screen (default: latest completed)')
  .option('--brief <file>', 'brief with exclusion filters and criteria')
  .option('--all', 'include unselected sources')
  .option('--interactive', 'review sources one at a time')
  .option('--decisions <file>', 'import decisions from CSV or JSON')
  .option('--suggest', 'store heuristic tool suggestions')
  .option('--drop-excluded', 'hide sources matched by brief exclusion filters')
  .option('--reviewer <name>', 'reviewer for new decisions')
  .option('--format <format>', 'table, json or csv', 'table')
  .option('--out <file>', 'write output to a file')
  .action(async (projectArg: string | undefined, options: ScreenCliOptions) => {
    const format = parseFormat(options.format, ['table', 'json', 'csv']);
    if (options.decisions && (options.interactive || options.suggest)) {
      throw new UsageError(
        '--decisions cannot be combined with --interactive or --suggest',
      );
    }
    if (options.interactive && !process.stdin.isTTY) {
      throw new UsageError(
        '--interactive needs a terminal; use --decisions or --format csv',
      );
    }

    const root = await requireProjectRoot(projectArg);
    const project = await openProject(root);

    try {
      let brief;
      if (options.brief) {
        try {
          const parsed = await readBrief(options.brief);
          brief = parsed.brief;
          for (const warning of parsed.warnings) {
            process.stderr.write(
              `winnow: ${warning.field}: ${warning.message}\n`,
            );
          }
          saveBrief(project.db, brief);
        } catch (error) {
          if (error instanceof BriefError) throw new UsageError(error.message);
          throw error;
        }
      }

      let runId = options.run;
      if (!runId) {
        const latest = getLatestRun(project.db);
        if (!latest) {
          throw new UsageError(
            'No completed run found. Run `winnow search` first.',
          );
        }
        runId = latest.id;
      }

      const stateOptions = {
        all: options.all === true,
        brief,
        dropExcluded: options.dropExcluded === true,
      };
      const reviewer = options.reviewer?.trim() || userInfo().username;

      if (options.decisions) {
        let text: string;
        try {
          text = await readFile(options.decisions, 'utf8');
        } catch (error) {
          throw new UsageError(
            `Cannot read decisions file: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const decisionFormat = detectScreeningFormat(options.decisions, text);
        const decisions = parseScreeningDecisions(text, decisionFormat);
        if (!decisions.length) {
          throw new UsageError('No decisions found in the file');
        }
        const imported = importScreeningDecisions(
          project.db,
          runId,
          decisions,
          reviewer,
        );
        process.stderr.write(`imported ${imported.imported} decision(s)\n`);
        for (const skipped of imported.skipped) {
          process.stderr.write(`skipped ${skipped.key}: ${skipped.reason}\n`);
        }
      }

      if (options.suggest) {
        const state = loadScreeningState(project.db, runId, stateOptions);
        for (const source of state.sources) {
          const draft = suggestScreening(source);
          recordScreeningSuggestion(project.db, {
            runId,
            sourceId: source.source.id,
            ...draft,
          });
        }
        process.stderr.write(
          `stored ${state.sources.length} suggestion(s)\n`,
        );
      }

      if (options.interactive) {
        const state = loadScreeningState(project.db, runId, stateOptions);
        await runInteractiveScreening(project.db, state, runId, reviewer);
      }

      const summary = loadScreeningState(project.db, runId, stateOptions);
      const output = renderScreeningOutput(format, summary);
      await emit(output, options.out);

      if (format === 'csv' || options.out) {
        process.stderr.write(screeningCountsLine(summary));
      }
      process.exitCode = 0;
    } catch (error) {
      if (error instanceof ScreeningError) throw new UsageError(error.message);
      throw error;
    } finally {
      project.db.close();
    }
  });

program
  .command('extract [project]')
  .description('Build a human-confirmed evidence table from included sources')
  .option('--run <run-id>', 'run to extract (default: latest completed)')
  .option('--fields <list>', 'comma-separated fields', DEFAULT_FIELDS.join(','))
  .option('--suggest', 'store heuristic extraction suggestions')
  .option('--interactive', 'review and confirm fields one at a time')
  .option('--decisions <file>', 'import confirmed values from CSV or JSON')
  .option('--reviewer <name>', 'reviewer for confirmed values')
  .option('--format <format>', 'table, json or csv', 'table')
  .option('--out <file>', 'write output to a file')
  .action(async (projectArg: string | undefined, options: ExtractCliOptions) => {
    const format = parseFormat(options.format, ['table', 'json', 'csv']);
    if (options.decisions && (options.interactive || options.suggest)) {
      throw new UsageError(
        '--decisions cannot be combined with --interactive or --suggest',
      );
    }
    if (options.interactive && !process.stdin.isTTY) {
      throw new UsageError(
        '--interactive needs a terminal; use --decisions or --format csv',
      );
    }

    const fields = parseFields(options.fields);
    const root = await requireProjectRoot(projectArg);
    const project = await openProject(root);

    try {
      let runId = options.run;
      if (!runId) {
        const latest = getLatestRun(project.db);
        if (!latest) {
          throw new UsageError(
            'No completed run found. Run `winnow search` first.',
          );
        }
        runId = latest.id;
      }

      const reviewer = options.reviewer?.trim() || userInfo().username;

      if (options.decisions) {
        let text: string;
        try {
          text = await readFile(options.decisions, 'utf8');
        } catch (error) {
          throw new UsageError(
            `Cannot read extraction file: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const valueFormat = detectExtractionFormat(options.decisions, text);
        const values = parseExtractionValues(text, valueFormat);
        if (!values.length) {
          throw new UsageError('No extraction values found in the file');
        }
        const imported = importExtractionValues(
          project.db,
          runId,
          values,
          reviewer,
        );
        process.stderr.write(`imported ${imported.imported} value(s)\n`);
        for (const skipped of imported.skipped) {
          process.stderr.write(`skipped ${skipped.key}: ${skipped.reason}\n`);
        }
      }

      if (options.suggest) {
        const state = loadExtractionState(project.db, runId, fields);
        let stored = 0;
        for (const row of state.rows) {
          for (const draft of suggestExtraction(row.source, fields)) {
            recordExtractionSuggestion(project.db, {
              runId,
              sourceId: row.source.id,
              ...draft,
            });
            stored += 1;
          }
        }
        process.stderr.write(
          `stored ${stored} suggestion(s) for ${state.rows.length} included source(s)\n`,
        );
      }

      if (options.interactive) {
        const state = loadExtractionState(project.db, runId, fields);
        await runInteractiveExtraction(project.db, state, runId, reviewer);
      }

      const summary = loadExtractionState(project.db, runId, fields);
      const output = renderExtractionOutput(format, summary);
      await emit(output, options.out);

      if (format === 'csv' || options.out) {
        process.stderr.write(extractionCountsLine(summary));
      }
      process.exitCode = summary.counts.included === 0 ? 3 : 0;
    } catch (error) {
      if (error instanceof ExtractionError) throw new UsageError(error.message);
      throw error;
    } finally {
      project.db.close();
    }
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

function renderScreeningOutput(
  format: string,
  summary: ScreeningSummary,
): string {
  if (format === 'json') return formatScreeningJson(summary);
  if (format === 'csv') return formatScreeningCsv(summary);
  return formatScreeningTable(summary);
}

function screeningCountsLine(summary: ScreeningSummary): string {
  const counts = summary.counts;
  return (
    `screened ${counts.screened}/${counts.deduplicated}; ` +
    `included ${counts.included}, excluded ${counts.excluded}, ` +
    `maybe ${counts.maybe}, undecided ${counts.undecided}, ` +
    `filtered out ${counts.filteredOut}\n`
  );
}

type WinnowDb = Parameters<typeof recordScreeningDecision>[0];

async function runInteractiveScreening(
  db: WinnowDb,
  summary: ScreeningSummary,
  runId: string,
  reviewer: string,
): Promise<void> {
  if (!summary.sources.length) {
    process.stderr.write('Nothing to screen.\n');
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let index = 0;
    const total = summary.sources.length;

    while (index < total) {
      const state = summary.sources[index]!;
      printScreeningSource(state, index + 1, total);

      const raw = (
        await rl.question(
          'Decision [i]include [c]core [p]peripheral [e]exclude [x]exclude+reason [m]maybe [s]skip [q]quit [?]help: ',
        )
      )
        .trim()
        .toLowerCase();

      if (!raw) {
        index += 1;
        continue;
      }
      if (raw === '?' || raw === 'h' || raw === 'help') {
        printScreeningHelp();
        continue;
      }
      if (raw === 'q' || raw === 'quit') {
        process.stderr.write('stopped\n');
        break;
      }
      if (raw === 's' || raw === 'skip') {
        index += 1;
        continue;
      }

      const save = (
        decision: ScreeningDecision,
        relevance?: ScreeningRelevance,
        reasonCode?: ScreeningReasonCode,
        reason?: string,
      ) => {
        recordScreeningDecision(db, {
          runId,
          sourceId: state.source.id,
          decision,
          relevance,
          reasonCode,
          reason,
          reviewer,
        });
      };

      if (raw === 'i' || raw === 'include') {
        save('include', 'supporting');
      } else if (raw === 'c' || raw === 'core') {
        save('include', 'core');
      } else if (raw === 'p' || raw === 'peripheral') {
        save('include', 'peripheral');
      } else if (raw === 'm' || raw === 'maybe') {
        save('maybe');
      } else if (raw === 'e' || raw === 'exclude') {
        save('exclude');
      } else if (raw === 'x' || raw === 'exclude-reason') {
        const reasonCode = await promptReasonCode(rl);
        if (!reasonCode) continue;
        const note = (await rl.question('Note (optional): ')).trim();
        save('exclude', undefined, reasonCode, note || undefined);
      } else {
        process.stderr.write(`winnow: unknown key ${JSON.stringify(raw)}\n`);
        continue;
      }

      process.stderr.write('saved\n');
      index += 1;
    }
  } catch (error) {
    if (isReadlineAbort(error)) {
      process.stderr.write('stopped\n');
      return;
    }
    throw error;
  } finally {
    rl.close();
  }
}

function isReadlineAbort(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || /aborted|ctrl\+d|sigint/i.test(error.message))
  );
}

function printScreeningSource(
  state: ScreeningState,
  index: number,
  total: number,
): void {
  const year = state.source.year ?? 'n.d.';
  const authors = state.source.authors.slice(0, 3).join(', ');
  const suffix = state.source.authors.length > 3 ? ' et al.' : '';
  const width = Math.min(process.stdout.columns ?? 88, 100);

  process.stdout.write('\n');
  process.stdout.write(
    `[${index}/${total}] rank ${state.rank} · ${state.citability}\n`,
  );
  process.stdout.write(`${state.source.title} (${year})\n`);
  if (authors) {
    process.stdout.write(
      `${authors}${suffix}${state.source.venue ? ` — ${state.source.venue}` : ''}\n`,
    );
  }
  if (state.source.doi) process.stdout.write(`doi:${state.source.doi}\n`);
  if (state.suggestion) {
    const confidence =
      state.suggestion.confidence != null
        ? ` (${state.suggestion.confidence.toFixed(2)})`
        : '';
    process.stdout.write(
      `tool: ${state.suggestion.decision}/${state.suggestion.relevance ?? '-'}${confidence}` +
        `${state.suggestion.rationale ? ` — ${state.suggestion.rationale}` : ''}\n`,
    );
  }
  if (state.decision) {
    const parts: string[] = [state.decision];
    if (state.relevance) parts.push(state.relevance);
    if (state.reasonCode) parts.push(state.reasonCode);
    if (state.reason) parts.push(state.reason);
    process.stdout.write(
      `you: ${parts.join(' / ')}${state.reviewer ? ` — ${state.reviewer}` : ''}\n`,
    );
  }
  if (state.filterFlags.length) {
    process.stdout.write(`flags: ${state.filterFlags.join(', ')}\n`);
  }
  if (state.source.abstract) {
    process.stdout.write(
      `${wrapText(state.source.abstract.slice(0, 1200), width).join('\n')}\n`,
    );
  } else {
    process.stdout.write('No abstract.\n');
  }
}

function printScreeningHelp(): void {
  process.stdout.write(
    'i include (supporting) · c include (core) · p include (peripheral)\n' +
      'e exclude · x exclude with reason code · m maybe · s skip · q quit\n',
  );
}

async function promptReasonCode(
  rl: ReturnType<typeof createInterface>,
): Promise<ScreeningReasonCode | undefined> {
  const options: Array<[string, ScreeningReasonCode]> = [
    ['1', 'off_topic'],
    ['2', 'wrong_population'],
    ['3', 'wrong_method'],
    ['4', 'not_empirical'],
    ['5', 'duplicate'],
    ['6', 'not_accessible'],
    ['7', 'out_of_scope_date'],
    ['8', 'out_of_scope_venue'],
    ['9', 'other'],
  ];

  process.stdout.write(
    'Reason: 1 off-topic  2 wrong population  3 wrong method  4 not empirical\n' +
      '        5 duplicate  6 not accessible  7 date  8 venue  9 other  [Enter] cancel\n',
  );

  const answer = (await rl.question('Reason code: ')).trim().toLowerCase();
  if (!answer) return undefined;
  return options.find(([key]) => key === answer)?.[1];
}

function wrapText(value: string, width: number): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  const effective = Math.max(24, width);

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= effective) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function parseFields(value: string | undefined): string[] {
  const fields = (value ?? '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
  return fields.length ? [...new Set(fields)] : DEFAULT_FIELDS;
}

function renderExtractionOutput(
  format: string,
  summary: ExtractionSummary,
): string {
  if (format === 'json') return formatEvidenceJson(summary);
  if (format === 'csv') return formatEvidenceCsv(summary);
  return formatEvidenceTable(summary);
}

function extractionCountsLine(summary: ExtractionSummary): string {
  const counts = summary.counts;
  return (
    `included ${counts.included}; extracted ${counts.extracted}; ` +
    `complete ${counts.complete}; missing ${counts.missing}\n`
  );
}

type ExtractionDb = Parameters<typeof recordExtraction>[0];

async function runInteractiveExtraction(
  db: ExtractionDb,
  summary: ExtractionSummary,
  runId: string,
  reviewer: string,
): Promise<void> {
  if (!summary.rows.length) {
    process.stderr.write('No human-confirmed includes to extract.\n');
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    let sourceIndex = 0;

    while (sourceIndex < summary.rows.length) {
      const row = summary.rows[sourceIndex]!;
      const width = Math.min(process.stdout.columns ?? 88, 100);

      process.stdout.write(
        `\n[${sourceIndex + 1}/${summary.rows.length}] ${row.source.title} (${row.source.year ?? 'n.d.'})\n`,
      );
      if (row.source.doi) process.stdout.write(`doi:${row.source.doi}\n`);
      if (row.source.abstract) {
        process.stdout.write(
          `${wrapText(row.source.abstract.slice(0, 600), width).join('\n')}\n`,
        );
      }

      let quit = false;

      for (const field of summary.fields) {
        const confirmed = row.values[field];
        const suggestion = row.suggestions[field];

        if (confirmed) {
          process.stdout.write(
            `\n${field}: confirmed — ${trimText(confirmed, 220)}\n`,
          );
          const answer = (
            await rl.question('[Enter] keep · e edit · s skip · q quit: ')
          )
            .trim()
            .toLowerCase();

          if (answer === 'q' || answer === 'quit') {
            quit = true;
            break;
          }
          if (!answer || answer === 's' || answer === 'skip') continue;
          if (answer === 'e' || answer === 'edit') {
            const value = (await rl.question(`${field} value: `)).trim();
            if (!value) continue;
            const quote =
              field === 'quote'
                ? value
                : (await rl.question('quote (optional): ')).trim();
            recordExtraction(db, {
              runId,
              sourceId: row.source.id,
              field,
              value,
              quote: quote || undefined,
              reviewer,
            });
            process.stderr.write('saved\n');
          }
          continue;
        }

        if (suggestion) {
          process.stdout.write(
            `\n${field}: [suggested] ${trimText(suggestion.value, 220)}` +
              `${suggestion.confidence != null ? ` (${suggestion.confidence.toFixed(2)})` : ''}\n`,
          );
          const answer = (
            await rl.question('[Enter] accept · e edit · s skip · q quit: ')
          )
            .trim()
            .toLowerCase();

          if (answer === 'q' || answer === 'quit') {
            quit = true;
            break;
          }
          if (answer === 's' || answer === 'skip') continue;
          if (answer === 'e' || answer === 'edit') {
            const value = (await rl.question(`${field} value: `)).trim();
            if (!value) continue;
            const quote =
              field === 'quote'
                ? value
                : (await rl.question('quote (optional): ')).trim();
            recordExtraction(db, {
              runId,
              sourceId: row.source.id,
              field,
              value,
              quote: quote || undefined,
              reviewer,
            });
          } else {
            recordExtraction(db, {
              runId,
              sourceId: row.source.id,
              field,
              value: suggestion.value,
              quote: suggestion.quote,
              location: suggestion.location,
              reviewer,
            });
          }
          process.stderr.write('saved\n');
          continue;
        }

        const value = (
          await rl.question(`\n${field} (Enter to skip, q to quit): `)
        ).trim();
        if (value === 'q' || value === 'quit') {
          quit = true;
          break;
        }
        if (!value) continue;
        const quote =
          field === 'quote'
            ? value
            : (await rl.question('quote (optional): ')).trim();
        recordExtraction(db, {
          runId,
          sourceId: row.source.id,
          field,
          value,
          quote: quote || undefined,
          reviewer,
        });
        process.stderr.write('saved\n');
      }

      if (quit) {
        process.stderr.write('stopped\n');
        break;
      }
      sourceIndex += 1;
    }
  } catch (error) {
    if (isReadlineAbort(error)) {
      process.stderr.write('stopped\n');
      return;
    }
    throw error;
  } finally {
    rl.close();
  }
}

function trimText(value: string, length: number): string {
  const clean = value.trim();
  return clean.length <= length ? clean : `${clean.slice(0, length - 1)}…`;
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
