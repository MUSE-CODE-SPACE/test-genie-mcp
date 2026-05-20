/**
 * LLM-backed fix suggester. Invoked by the iterate-fix loop in `hybrid` and
 * `llm` strategies when rule-based confidence is below threshold (or there is
 * no rule-based match at all).
 *
 * Keeps the public shape compatible with `FixSuggestion` so the rest of the
 * pipeline (confirm, apply, rollback) doesn't need to special-case LLM fixes.
 */

import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

import { DetectedIssue, FixSuggestion, Platform } from '../../types.js';
import { saveFix } from '../../storage/index.js';
import { generateDiff } from '../../utils/codeParser.js';
import { isLlmAvailable, requestLlmFix } from '../../llm/index.js';

export interface LlmSuggestFixesInput {
  issue: DetectedIssue;
  platform: Platform;
  projectPath: string;
  reason: string;
  testFailureMessage?: string;
}

export interface LlmSuggestFixesResult {
  suggestion: FixSuggestion | null;
  /**
   * 'unavailable' means no LLM provider configured (caller can quietly skip).
   * 'low-confidence' means the LLM returned but with confidence < threshold.
   * 'ok' means the suggestion is usable.
   * 'error' means the call/parse failed.
   */
  status: 'ok' | 'unavailable' | 'low-confidence' | 'error';
  error?: string;
}

/**
 * Read the local code window around the issue (±3/+5 lines) so the LLM has
 * enough context to propose a self-contained fix.
 */
function readCodeWindow(file: string, line: number): string {
  try {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, line - 4);
    const end = Math.min(lines.length, line + 6);
    return lines.slice(start, end).join('\n');
  } catch {
    return '';
  }
}

export async function suggestFixWithLlm(
  input: LlmSuggestFixesInput,
): Promise<LlmSuggestFixesResult> {
  if (!isLlmAvailable()) {
    return { suggestion: null, status: 'unavailable' };
  }

  const original = readCodeWindow(input.issue.file, input.issue.line);

  let llmResponse;
  try {
    llmResponse = await requestLlmFix({
      issueType: input.issue.type,
      issueTitle: input.issue.title,
      issueDescription: input.issue.description,
      platform: input.platform,
      file: input.issue.file,
      line: input.issue.line,
      originalCode: original || input.issue.code || '',
      testFailureMessage: input.testFailureMessage,
      reason: input.reason,
    });
  } catch (err) {
    return {
      suggestion: null,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!llmResponse) {
    return { suggestion: null, status: 'unavailable' };
  }

  // Refuse very-low-confidence proposals — they're more dangerous than useful.
  if (llmResponse.confidence < 40) {
    return {
      suggestion: null,
      status: 'low-confidence',
      error: `LLM confidence ${llmResponse.confidence} below threshold`,
    };
  }

  const fix: FixSuggestion = {
    id: uuidv4(),
    issueId: input.issue.id,
    title: `[LLM] ${llmResponse.description || `Fix: ${input.issue.title}`}`,
    description: llmResponse.rationale,
    confidence: llmResponse.confidence,
    file: input.issue.file,
    line: input.issue.line,
    originalCode: original,
    suggestedCode: llmResponse.suggestedCode,
    diff: generateDiff(original, llmResponse.suggestedCode),
    impact: {
      filesAffected: [input.issue.file],
      testsAffected: [],
      riskLevel: llmResponse.confidence > 75 ? 'medium' : 'high',
      breakingChange: false,
      requiresRetest: true,
    },
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  // Persist so the rest of the apply pipeline can find it.
  saveFix(fix, input.projectPath);

  return { suggestion: fix, status: 'ok' };
}
