/**
 * MCP resources surface for test-genie-mcp.
 *
 * Three resource families are exposed:
 *
 *   1. resource://test-genie/test-history/{projectPath}
 *      Last 100 test results for a project. Path is URL-encoded
 *      (forward slashes → `%2F`) because resource URIs are flat.
 *
 *   2. resource://test-genie/iteration-logs/{loopId}
 *      Full iterate-fix-loop history (status, per-iteration counts, applied
 *      / rolled-back fix ids, resumeToken). Surfaced for post-hoc audit.
 *
 *   3. resource://test-genie/applied-fixes/{projectPath}
 *      All fix applications for the project, with rollback info attached.
 *
 * Resources are read-only views over the JSON storage backend in `src/storage`.
 */

import {
  getTestResults,
  getIterationLog,
  getIterationLogs,
  getFixes,
} from '../storage/index.js';

export interface ResourceDescriptor {
  name: string;
  uri: string;
  description: string;
  mimeType: string;
}

export const STATIC_RESOURCE_DESCRIPTORS: ResourceDescriptor[] = [
  {
    name: 'iteration-logs-index',
    uri: 'test-genie://iteration-logs',
    description: 'Index of all iterate-fix loop logs (most recent first).',
    mimeType: 'application/json',
  },
];

export function decodePath(encoded: string): string {
  // The MCP URI templating gives us the variable value already decoded,
  // but we accept double-encoded for safety.
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded;
  } catch {
    return encoded;
  }
}

export function readIterationLogsIndex(uri: string): { uri: string; mimeType: string; text: string } {
  const logs = getIterationLogs();
  const summary = logs
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 100)
    .map((l) => ({
      loopId: l.loopId,
      projectPath: l.projectPath,
      status: l.status,
      iterations: l.iterations.length,
      appliedFixIds: l.appliedFixIds.length,
      rolledBackFixIds: l.rolledBackFixIds.length,
      startedAt: l.startedAt,
      completedAt: l.completedAt,
    }));
  return {
    uri,
    mimeType: 'application/json',
    text: JSON.stringify(summary, null, 2),
  };
}

export function readTestHistory(
  uri: string,
  projectPathEncoded: string,
): { uri: string; mimeType: string; text: string } {
  const projectPath = decodePath(projectPathEncoded);
  const history = getTestResults(projectPath, 100);
  const items = history.map((h) => ({
    id: h.result.id,
    scenarioName: h.result.scenarioName,
    status: h.result.status,
    duration: h.result.duration,
    error: h.result.error,
    executedAt: h.result.executedAt,
  }));
  return {
    uri,
    mimeType: 'application/json',
    text: JSON.stringify({ projectPath, count: items.length, results: items }, null, 2),
  };
}

export function readIterationLog(
  uri: string,
  loopId: string,
): { uri: string; mimeType: string; text: string } {
  const log = getIterationLog(loopId);
  if (!log) {
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ error: 'iteration log not found', loopId }, null, 2),
    };
  }
  return { uri, mimeType: 'application/json', text: JSON.stringify(log, null, 2) };
}

export function readAppliedFixes(
  uri: string,
  projectPathEncoded: string,
): { uri: string; mimeType: string; text: string } {
  const projectPath = decodePath(projectPathEncoded);
  const fixes = getFixes(projectPath).filter((f) => f.application);
  const summary = fixes.map((f) => ({
    id: f.fix.id,
    title: f.fix.title,
    file: f.fix.file,
    line: f.fix.line,
    confidence: f.fix.confidence,
    applied: f.application?.success,
    backupPath: f.application?.backupPath,
    appliedAt: f.application?.appliedAt,
    error: f.application?.error,
  }));
  return {
    uri,
    mimeType: 'application/json',
    text: JSON.stringify({ projectPath, count: summary.length, fixes: summary }, null, 2),
  };
}
