/**
 * LLM fallback for fix suggestion.
 *
 * Mirrors the philosophy of `error-doctor-mcp`'s `llm.py`:
 *
 *   1. When rule-based fix has low confidence (or no match), call an LLM with
 *      a structured prompt to propose an alternative fix.
 *   2. Provider auto-detection: `TEST_GENIE_LLM_PROVIDER` env var > anthropic
 *      key > openai key > none.
 *   3. SDKs are lazy-imported so the base npm install stays slim — `[llm]`
 *      consumers add `@anthropic-ai/sdk` and/or `openai` via
 *      `optionalDependencies`.
 *
 * This module never throws on missing SDKs — callers receive `null` if LLM
 * isn't available and must handle gracefully.
 */

import { ToolError } from '../security.js';

export type LlmProvider = 'anthropic' | 'openai' | 'none';

const DEFAULT_ANTHROPIC_MODEL = process.env.TEST_GENIE_ANTHROPIC_MODEL || 'claude-haiku-4-5';
const DEFAULT_OPENAI_MODEL = process.env.TEST_GENIE_OPENAI_MODEL || 'gpt-4o-mini';

const LLM_MAX_INPUT_BYTES = 16 * 1024;

export interface LlmFixRequest {
  issueType: string;
  issueTitle: string;
  issueDescription: string;
  platform: string;
  file: string;
  line: number;
  originalCode: string;
  testFailureMessage?: string;
  /** Why the rule-based fix wasn't sufficient. */
  reason: string;
}

export interface LlmFixResponse {
  /** One-line description of the proposed fix. */
  description: string;
  /** New code to replace originalCode. */
  suggestedCode: string;
  /** 0-100, LLM's self-rated confidence. */
  confidence: number;
  /** Free-form rationale — surfaced to user before apply. */
  rationale: string;
  /** Which provider/model was used. */
  provider: LlmProvider;
  model: string;
}

/** Detect which provider should be used given env state. */
export function detectProvider(): LlmProvider {
  const explicit = (process.env.TEST_GENIE_LLM_PROVIDER || '').toLowerCase().trim();
  if (explicit === 'anthropic') return 'anthropic';
  if (explicit === 'openai') return 'openai';
  if (explicit === 'none') return 'none';

  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'none';
}

/** True if any LLM provider is reachable. Cheap, no I/O. */
export function isLlmAvailable(): boolean {
  return detectProvider() !== 'none';
}

/**
 * Build the system prompt. Kept short and instruction-heavy because
 * cheap/fast models (haiku, 4o-mini) follow short prompts more reliably.
 */
function systemPrompt(): string {
  return [
    'You are test-genie, a code-fix proposer. The local rule-based fixer was not confident, so you are being asked to propose an alternative.',
    'Return STRICT JSON with these keys (no markdown fences, no commentary):',
    '  "description": one-line summary of the fix (string)',
    '  "suggestedCode": the new code that should replace `originalCode` (string, multi-line allowed)',
    '  "confidence": integer 0-100',
    '  "rationale": 1-3 sentences explaining why this fix is correct',
    'Constraints:',
    '  - Only change what is needed to fix the issue. Preserve surrounding code style.',
    '  - Do NOT invent imports unless they already exist in the file context (we only show a snippet).',
    '  - If you cannot fix it confidently, return confidence < 40 and describe what extra context you would need.',
  ].join('\n');
}

function userPrompt(req: LlmFixRequest): string {
  const truncatedCode = req.originalCode.length > LLM_MAX_INPUT_BYTES
    ? req.originalCode.slice(0, LLM_MAX_INPUT_BYTES) + '\n// …truncated…'
    : req.originalCode;

  const lines: string[] = [];
  lines.push(`Platform: ${req.platform}`);
  lines.push(`Issue type: ${req.issueType}`);
  lines.push(`Issue: ${req.issueTitle}`);
  lines.push(`Description: ${req.issueDescription}`);
  lines.push(`File: ${req.file}:${req.line}`);
  if (req.testFailureMessage) {
    lines.push(`Test failure: ${req.testFailureMessage.slice(0, 2000)}`);
  }
  lines.push(`Rule-based fixer reason: ${req.reason}`);
  lines.push('');
  lines.push('Original code:');
  lines.push('```');
  lines.push(truncatedCode);
  lines.push('```');
  lines.push('');
  lines.push('Return ONLY the JSON object described in the system prompt.');
  return lines.join('\n');
}

/**
 * Strip ```json fences / commentary that some models leak.
 */
function parseJsonLenient(raw: string): unknown {
  let s = raw.trim();
  if (s.startsWith('```')) {
    const newlineIdx = s.indexOf('\n');
    s = newlineIdx === -1 ? s.slice(3) : s.slice(newlineIdx + 1);
    if (s.endsWith('```')) {
      s = s.slice(0, -3);
    }
  }
  s = s.trim();
  // If model added a stray prefix, take from first `{` to last `}`.
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return JSON.parse(s);
}

function coerceResponse(raw: unknown, provider: LlmProvider, model: string): LlmFixResponse {
  if (!raw || typeof raw !== 'object') {
    throw new ToolError('LLM response was not an object', 'INTERNAL_ERROR');
  }
  const r = raw as Record<string, unknown>;
  const description = typeof r.description === 'string' ? r.description : '';
  const suggestedCode = typeof r.suggestedCode === 'string' ? r.suggestedCode : '';
  const rationale = typeof r.rationale === 'string' ? r.rationale : '';
  let confidence = typeof r.confidence === 'number' ? r.confidence : 0;
  if (typeof r.confidence === 'string') {
    const n = Number.parseInt(r.confidence, 10);
    if (!Number.isNaN(n)) confidence = n;
  }
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  if (!suggestedCode) {
    throw new ToolError('LLM response missing suggestedCode', 'INTERNAL_ERROR');
  }

  return { description, suggestedCode, confidence, rationale, provider, model };
}

/**
 * Public entry: request a fix from the configured LLM provider.
 *
 * Returns `null` if no provider is available (caller should fall back to
 * rule-based-only mode). Throws ToolError on transport / parse failures.
 */
export async function requestLlmFix(req: LlmFixRequest): Promise<LlmFixResponse | null> {
  const provider = detectProvider();
  if (provider === 'none') return null;

  if (provider === 'anthropic') {
    return callAnthropic(req);
  }
  return callOpenAI(req);
}

async function callAnthropic(req: LlmFixRequest): Promise<LlmFixResponse> {
  let mod: any;
  try {
    // Dynamic import keeps the dep optional.
    mod = await import('@anthropic-ai/sdk' as string);
  } catch {
    throw new ToolError(
      'Anthropic SDK not installed. Run `npm install @anthropic-ai/sdk` or use TEST_GENIE_LLM_PROVIDER=none',
      'INTERNAL_ERROR',
    );
  }

  const Anthropic = mod.default ?? mod.Anthropic ?? mod;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const model = DEFAULT_ANTHROPIC_MODEL;
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt(),
    messages: [{ role: 'user', content: userPrompt(req) }],
  });

  const block = Array.isArray(response.content)
    ? response.content.find((b: { type: string }) => b.type === 'text')
    : undefined;
  const text: string = block?.text ?? '';
  const parsed = parseJsonLenient(text);
  return coerceResponse(parsed, 'anthropic', model);
}

async function callOpenAI(req: LlmFixRequest): Promise<LlmFixResponse> {
  let mod: any;
  try {
    mod = await import('openai' as string);
  } catch {
    throw new ToolError(
      'OpenAI SDK not installed. Run `npm install openai` or use TEST_GENIE_LLM_PROVIDER=none',
      'INTERNAL_ERROR',
    );
  }

  const OpenAI = mod.default ?? mod.OpenAI ?? mod;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const model = DEFAULT_OPENAI_MODEL;
  const response = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: userPrompt(req) },
    ],
  });

  const text: string = response.choices?.[0]?.message?.content ?? '';
  const parsed = parseJsonLenient(text);
  return coerceResponse(parsed, 'openai', model);
}
