/**
 * diagnose_project — v3.1.0 headline tool tests.
 *
 * Asserts:
 *   (a) findings are detected for both planted fixtures.
 *   (b) summary mode produces a concise Markdown string.
 *   (c) JSON mode is parseable and shape-stable.
 *   (d) autoFix flag is wired through (no-op for now but accepted).
 *   (e) per-check timeout pruning works.
 *   (f) severityThreshold filters lower findings out.
 */
import * as path from 'path';
import { diagnoseProject } from '../src/tools/automation/diagnoseProject.js';

const FIXTURES = path.join(__dirname, 'fixtures');
const RACE = path.join(FIXTURES, 'race-react');
const SEC = path.join(FIXTURES, 'security-node');

beforeAll(() => {
  process.env.TEST_GENIE_ALLOWED_ROOT = FIXTURES;
});

describe('diagnoseProject — race-react fixture', () => {
  it('detects race findings on the race-react fixture', async () => {
    const r = await diagnoseProject({ projectPath: RACE, output: 'detailed' });
    expect(r.findings.length).toBeGreaterThanOrEqual(4);
    expect(r.findings.some((f) => f.category === 'race-condition')).toBe(true);
  });

  it('summary mode returns a concise Markdown string', async () => {
    const r = await diagnoseProject({ projectPath: RACE, output: 'summary' });
    expect(typeof r.markdownSummary).toBe('string');
    expect(r.markdownSummary).toContain('vibe-check report');
    // summary mode caps findings array to top 5
    expect(r.findings.length).toBeLessThanOrEqual(5);
  });

  it('produces a sorted topFindings list (high severity first)', async () => {
    const r = await diagnoseProject({ projectPath: RACE, output: 'detailed' });
    expect(r.topFindings.length).toBeGreaterThan(0);
    const sevOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
    for (let i = 1; i < r.topFindings.length; i++) {
      const a = sevOrder[r.topFindings[i - 1]!.severity];
      const b = sevOrder[r.topFindings[i]!.severity];
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });

  it('reports filesScanned and platform on projectInfo', async () => {
    const r = await diagnoseProject({ projectPath: RACE, output: 'summary' });
    expect(r.projectInfo.path).toBe(RACE);
    expect(r.projectInfo.platform).toBeDefined();
  });
});

describe('diagnoseProject — security-node fixture', () => {
  it('detects security findings', async () => {
    const r = await diagnoseProject({ projectPath: SEC, checks: ['security'], output: 'detailed' });
    expect(r.findings.length).toBeGreaterThanOrEqual(5);
    expect(r.findings.every((f) => f.category === 'security')).toBe(true);
  });

  it('JSON output mode is parseable', async () => {
    const r = await diagnoseProject({ projectPath: SEC, output: 'json' });
    const serialized = JSON.stringify(r);
    const back = JSON.parse(serialized);
    expect(back.findings.length).toBeGreaterThan(0);
    expect(back.summary).toBeDefined();
  });

  it('autoFix flag is accepted (no-op pass-through for now)', async () => {
    const r = await diagnoseProject({ projectPath: SEC, autoFix: true, output: 'summary' });
    expect(r).toBeDefined();
    expect(r.summary.total).toBeGreaterThan(0);
  });
});

describe('diagnoseProject — filtering + control flow', () => {
  it('severityThreshold filters out lower findings', async () => {
    const all = await diagnoseProject({ projectPath: SEC, output: 'detailed' });
    const criticalOnly = await diagnoseProject({
      projectPath: SEC,
      severityThreshold: 'critical',
      output: 'detailed',
    });
    expect(criticalOnly.findings.length).toBeLessThanOrEqual(all.findings.length);
    expect(criticalOnly.findings.every((f) => f.severity === 'critical')).toBe(true);
  });

  it('per-check timeout marks slow checks as timed-out without aborting the run', async () => {
    // 0ms timeout forces all checks into the timeout path.
    const r = await diagnoseProject({
      projectPath: RACE,
      perCheckTimeoutMs: 0,
      output: 'detailed',
    });
    expect(r.checksTimedOut.length).toBeGreaterThan(0);
    // The run still returns a structured response.
    expect(r.markdownSummary).toBeDefined();
  });

  it('checks parameter limits which analyzers run', async () => {
    const r = await diagnoseProject({
      projectPath: SEC,
      checks: ['security'],
      output: 'detailed',
    });
    expect(r.checksRun).toEqual(['security']);
    expect(r.findings.every((f) => f.category === 'security')).toBe(true);
  });

  it('suggestedNextCommands includes a re-run hint', async () => {
    const r = await diagnoseProject({ projectPath: SEC, output: 'summary' });
    expect(r.suggestedNextCommands.some((c) => c.toLowerCase().includes('re-run'))).toBe(true);
  });

  it('estimatedFixTimeMinutes is positive when there are findings', async () => {
    const r = await diagnoseProject({ projectPath: SEC, output: 'detailed' });
    expect(r.summary.estimatedFixTimeMinutes).toBeGreaterThan(0);
  });

  it('returns a clean report when there are no findings above threshold', async () => {
    const r = await diagnoseProject({
      projectPath: RACE,
      severityThreshold: 'critical',
      output: 'summary',
    });
    expect(r.markdownSummary).toContain('vibe-check report');
  });

  it('includes platform info in markdownSummary', async () => {
    const r = await diagnoseProject({ projectPath: RACE, output: 'summary' });
    expect(r.markdownSummary).toContain('Platform:');
  });
});
