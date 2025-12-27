// ============================================
// Confirm Fix Tool
// ============================================

import {
  FixSuggestion,
  FixConfirmation,
} from '../../types.js';
import { getFixById, updateFixConfirmation } from '../../storage/index.js';

interface ConfirmFixParams {
  fixId: string;
  action: 'approve' | 'reject' | 'modify';
  modifiedCode?: string;
  reason?: string;
}

interface ConfirmFixResult {
  success: boolean;
  confirmation: FixConfirmation;
  fix: FixSuggestion | null;
  message: string;
}

export function confirmFix(params: ConfirmFixParams): ConfirmFixResult {
  const { fixId, action, modifiedCode, reason } = params;

  // Get the fix
  const storedFix = getFixById(fixId);
  if (!storedFix) {
    return {
      success: false,
      confirmation: {
        fixId,
        action,
        confirmedAt: new Date().toISOString(),
      },
      fix: null,
      message: `Fix not found: ${fixId}`,
    };
  }

  // Create confirmation
  const confirmation: FixConfirmation = {
    fixId,
    action,
    modifiedCode,
    reason,
    confirmedAt: new Date().toISOString(),
  };

  // Update fix with confirmation
  const updated = updateFixConfirmation(fixId, confirmation);

  if (!updated) {
    return {
      success: false,
      confirmation,
      fix: storedFix.fix,
      message: 'Failed to update fix confirmation',
    };
  }

  // Generate appropriate message
  let message = '';
  switch (action) {
    case 'approve':
      message = `Fix approved: ${storedFix.fix.title}. Ready to apply.`;
      break;
    case 'reject':
      message = `Fix rejected: ${storedFix.fix.title}. ${reason || 'No reason provided'}`;
      break;
    case 'modify':
      message = `Fix modified: ${storedFix.fix.title}. Using custom code.`;
      break;
  }

  return {
    success: true,
    confirmation,
    fix: storedFix.fix,
    message,
  };
}

// Batch confirm multiple fixes
export function confirmFixes(
  fixes: { fixId: string; action: 'approve' | 'reject' | 'modify'; modifiedCode?: string; reason?: string }[]
): {
  results: ConfirmFixResult[];
  summary: {
    approved: number;
    rejected: number;
    modified: number;
    failed: number;
  };
} {
  const results: ConfirmFixResult[] = [];

  for (const fix of fixes) {
    results.push(confirmFix(fix));
  }

  return {
    results,
    summary: {
      approved: results.filter(r => r.success && r.confirmation.action === 'approve').length,
      rejected: results.filter(r => r.success && r.confirmation.action === 'reject').length,
      modified: results.filter(r => r.success && r.confirmation.action === 'modify').length,
      failed: results.filter(r => !r.success).length,
    },
  };
}

// Generate confirmation prompt for user
export function generateConfirmationPrompt(fix: FixSuggestion): string {
  const lines: string[] = [];

  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`🔧 Fix Suggestion #${fix.id.substring(0, 8)}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(`📁 File: ${fix.file}:${fix.line}`);
  lines.push(`📝 Title: ${fix.title}`);
  lines.push(`📖 Description: ${fix.description}`);
  lines.push(`🎯 Confidence: ${fix.confidence}%`);
  lines.push('');
  lines.push('📄 Current Code:');
  lines.push('┌──────────────────────────────────────────────');
  for (const line of fix.originalCode.split('\n')) {
    lines.push(`│ ${line}`);
  }
  lines.push('└──────────────────────────────────────────────');
  lines.push('');
  lines.push('✨ Suggested Fix:');
  lines.push('┌──────────────────────────────────────────────');
  for (const line of fix.suggestedCode.split('\n')) {
    lines.push(`│ ${line}`);
  }
  lines.push('└──────────────────────────────────────────────');
  lines.push('');
  lines.push('📊 Diff:');
  lines.push('┌──────────────────────────────────────────────');
  for (const line of fix.diff.split('\n')) {
    const prefix = line.startsWith('+') ? '│ ✅' : line.startsWith('-') ? '│ ❌' : '│  ';
    lines.push(`${prefix} ${line}`);
  }
  lines.push('└──────────────────────────────────────────────');
  lines.push('');
  lines.push('⚠️ Impact:');
  lines.push(`   - Files Affected: ${fix.impact.filesAffected.length}`);
  lines.push(`   - Risk Level: ${fix.impact.riskLevel}`);
  lines.push(`   - Breaking Change: ${fix.impact.breakingChange ? 'Yes' : 'No'}`);
  lines.push(`   - Requires Retest: ${fix.impact.requiresRetest ? 'Yes' : 'No'}`);

  if (fix.alternatives && fix.alternatives.length > 0) {
    lines.push('');
    lines.push('🔄 Alternatives:');
    for (let i = 0; i < fix.alternatives.length; i++) {
      const alt = fix.alternatives[i]!;
      lines.push(`   ${i + 1}. ${alt.description}`);
      lines.push(`      Tradeoffs: ${alt.tradeoffs}`);
    }
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('Actions:');
  lines.push('  [✅ Approve]  [❌ Reject]  [✏️ Modify]');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  return lines.join('\n');
}

export default confirmFix;
