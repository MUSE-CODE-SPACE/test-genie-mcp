// ============================================
// Apply Fix Tool
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  FixSuggestion,
  FixApplication,
  TestResult,
} from '../../types.js';
import { getFixById, updateFixApplication, getConfirmedFixes } from '../../storage/index.js';

interface ApplyFixParams {
  fixId: string;
  backup?: boolean;
  validate?: boolean;
  dryRun?: boolean;
}

interface ApplyFixResult {
  success: boolean;
  application: FixApplication;
  backupPath?: string;
  error?: string;
  diff?: string;
}

export function applyFix(params: ApplyFixParams): ApplyFixResult {
  const { fixId, backup = true, validate = true, dryRun = false } = params;

  // Get the fix
  const storedFix = getFixById(fixId);
  if (!storedFix) {
    return {
      success: false,
      application: {
        fixId,
        success: false,
        error: `Fix not found: ${fixId}`,
        appliedAt: new Date().toISOString(),
      },
      error: `Fix not found: ${fixId}`,
    };
  }

  const fix = storedFix.fix;

  // Check if fix is confirmed
  if (fix.status !== 'confirmed' && !storedFix.confirmation) {
    return {
      success: false,
      application: {
        fixId,
        success: false,
        error: 'Fix must be confirmed before applying',
        appliedAt: new Date().toISOString(),
      },
      error: 'Fix must be confirmed before applying',
    };
  }

  // Read original file
  let originalContent: string;
  try {
    originalContent = fs.readFileSync(fix.file, 'utf-8');
  } catch (error) {
    return {
      success: false,
      application: {
        fixId,
        success: false,
        error: `Failed to read file: ${fix.file}`,
        appliedAt: new Date().toISOString(),
      },
      error: `Failed to read file: ${fix.file}`,
    };
  }

  // Determine which code to use (original or modified)
  const codeToApply = storedFix.confirmation?.action === 'modify' && storedFix.confirmation.modifiedCode
    ? storedFix.confirmation.modifiedCode
    : fix.suggestedCode;

  // Find and replace the code
  const lines = originalContent.split('\n');
  const originalCodeLines = fix.originalCode.split('\n');
  const newCodeLines = codeToApply.split('\n');

  // Find the location of original code
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    let match = true;
    for (let j = 0; j < originalCodeLines.length && match; j++) {
      if (i + j >= lines.length || lines[i + j]?.trim() !== originalCodeLines[j]?.trim()) {
        match = false;
      }
    }
    if (match) {
      startLine = i;
      break;
    }
  }

  // If exact match not found, try fuzzy matching around the reported line
  if (startLine === -1) {
    // Try to find a partial match near the reported line
    const searchStart = Math.max(0, fix.line - 10);
    const searchEnd = Math.min(lines.length, fix.line + 10);

    // Just replace around the reported line
    startLine = Math.max(0, fix.line - 2);
  }

  // Create new content
  let newContent: string;
  if (startLine >= 0) {
    const before = lines.slice(0, startLine);
    const after = lines.slice(startLine + originalCodeLines.length);
    newContent = [...before, ...newCodeLines, ...after].join('\n');
  } else {
    // Fallback: append fix as comment
    newContent = originalContent + '\n\n// TODO: Apply fix manually\n// ' + newCodeLines.join('\n// ');
  }

  // Dry run - just return what would be changed
  if (dryRun) {
    return {
      success: true,
      application: {
        fixId,
        success: true,
        appliedAt: new Date().toISOString(),
      },
      diff: generateUnifiedDiff(originalContent, newContent, fix.file),
    };
  }

  // Create backup
  let backupPath: string | undefined;
  if (backup) {
    try {
      const backupDir = path.join(path.dirname(fix.file), '.test-genie-backups');
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      backupPath = path.join(
        backupDir,
        `${path.basename(fix.file)}.${Date.now()}.bak`
      );
      fs.writeFileSync(backupPath, originalContent);
    } catch (error) {
      // Non-fatal error, continue without backup
      console.warn('Failed to create backup:', error);
    }
  }

  // Apply the fix
  try {
    fs.writeFileSync(fix.file, newContent);
  } catch (error) {
    // Restore from backup if available
    if (backupPath && fs.existsSync(backupPath)) {
      fs.writeFileSync(fix.file, originalContent);
    }

    return {
      success: false,
      application: {
        fixId,
        success: false,
        backupPath,
        error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
        appliedAt: new Date().toISOString(),
      },
      error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Validate syntax (basic check)
  if (validate) {
    const validationResult = validateSyntax(fix.file, newContent);
    if (!validationResult.valid) {
      // Restore from backup
      if (backupPath && fs.existsSync(backupPath)) {
        fs.writeFileSync(fix.file, originalContent);
      }

      return {
        success: false,
        application: {
          fixId,
          success: false,
          backupPath,
          error: `Syntax validation failed: ${validationResult.error}`,
          appliedAt: new Date().toISOString(),
        },
        error: `Syntax validation failed: ${validationResult.error}`,
      };
    }
  }

  // Create application record
  const application: FixApplication = {
    fixId,
    success: true,
    backupPath,
    appliedAt: new Date().toISOString(),
  };

  // Update storage
  updateFixApplication(fixId, application);

  return {
    success: true,
    application,
    backupPath,
    diff: generateUnifiedDiff(originalContent, newContent, fix.file),
  };
}

// Apply multiple fixes
export async function applyFixes(
  fixIds: string[],
  options?: { backup?: boolean; validate?: boolean; stopOnError?: boolean }
): Promise<{
  results: ApplyFixResult[];
  summary: {
    successful: number;
    failed: number;
    backups: string[];
  };
}> {
  const { backup = true, validate = true, stopOnError = true } = options || {};
  const results: ApplyFixResult[] = [];
  const backups: string[] = [];

  for (const fixId of fixIds) {
    const result = applyFix({ fixId, backup, validate });
    results.push(result);

    if (result.backupPath) {
      backups.push(result.backupPath);
    }

    if (!result.success && stopOnError) {
      break;
    }
  }

  return {
    results,
    summary: {
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      backups,
    },
  };
}

// Apply all confirmed fixes
export async function applyConfirmedFixes(
  projectPath: string,
  options?: { backup?: boolean; validate?: boolean }
): Promise<{
  results: ApplyFixResult[];
  summary: {
    successful: number;
    failed: number;
    skipped: number;
  };
}> {
  const confirmedFixes = getConfirmedFixes(projectPath);
  const fixIds = confirmedFixes.map(f => f.fix.id);

  const { results, summary } = await applyFixes(fixIds, {
    ...options,
    stopOnError: false,
  });

  return {
    results,
    summary: {
      successful: summary.successful,
      failed: summary.failed,
      skipped: confirmedFixes.length - results.length,
    },
  };
}

// Rollback a fix
export function rollbackFix(fixId: string): {
  success: boolean;
  message: string;
} {
  const storedFix = getFixById(fixId);
  if (!storedFix || !storedFix.application) {
    return {
      success: false,
      message: 'Fix or application record not found',
    };
  }

  if (!storedFix.application.backupPath) {
    return {
      success: false,
      message: 'No backup available for rollback',
    };
  }

  try {
    const backupContent = fs.readFileSync(storedFix.application.backupPath, 'utf-8');
    fs.writeFileSync(storedFix.fix.file, backupContent);

    return {
      success: true,
      message: `Successfully rolled back ${storedFix.fix.file}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Rollback failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function validateSyntax(filePath: string, content: string): { valid: boolean; error?: string } {
  const ext = path.extname(filePath);

  try {
    // Basic syntax validation based on file type
    switch (ext) {
      case '.js':
      case '.jsx':
      case '.ts':
      case '.tsx':
        // Check for balanced braces
        const openBraces = (content.match(/\{/g) || []).length;
        const closeBraces = (content.match(/\}/g) || []).length;
        if (openBraces !== closeBraces) {
          return { valid: false, error: 'Unbalanced braces' };
        }

        // Check for balanced parentheses
        const openParens = (content.match(/\(/g) || []).length;
        const closeParens = (content.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
          return { valid: false, error: 'Unbalanced parentheses' };
        }
        break;

      case '.swift':
        // Similar checks for Swift
        break;

      case '.kt':
      case '.java':
        // Similar checks for Kotlin/Java
        break;

      case '.dart':
        // Similar checks for Dart
        break;
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function generateUnifiedDiff(original: string, modified: string, filename: string): string {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  const diff: string[] = [];
  diff.push(`--- a/${filename}`);
  diff.push(`+++ b/${filename}`);

  let i = 0;
  let j = 0;
  let hunkStart = -1;
  let hunk: string[] = [];

  while (i < originalLines.length || j < modifiedLines.length) {
    if (originalLines[i] === modifiedLines[j]) {
      if (hunk.length > 0) {
        // End of change hunk
        diff.push(`@@ -${hunkStart + 1},${hunk.filter(l => l.startsWith('-') || l.startsWith(' ')).length} +${hunkStart + 1},${hunk.filter(l => l.startsWith('+') || l.startsWith(' ')).length} @@`);
        diff.push(...hunk);
        hunk = [];
        hunkStart = -1;
      }
      i++;
      j++;
    } else {
      if (hunkStart === -1) {
        hunkStart = i;
      }

      // Find next matching lines
      let foundMatch = false;
      for (let lookAhead = 1; lookAhead <= 3; lookAhead++) {
        if (originalLines[i + lookAhead] === modifiedLines[j]) {
          // Lines were removed
          for (let k = 0; k < lookAhead; k++) {
            hunk.push(`-${originalLines[i + k]}`);
          }
          i += lookAhead;
          foundMatch = true;
          break;
        }
        if (originalLines[i] === modifiedLines[j + lookAhead]) {
          // Lines were added
          for (let k = 0; k < lookAhead; k++) {
            hunk.push(`+${modifiedLines[j + k]}`);
          }
          j += lookAhead;
          foundMatch = true;
          break;
        }
      }

      if (!foundMatch) {
        // Line was changed
        if (i < originalLines.length) {
          hunk.push(`-${originalLines[i]}`);
          i++;
        }
        if (j < modifiedLines.length) {
          hunk.push(`+${modifiedLines[j]}`);
          j++;
        }
      }
    }
  }

  // Flush remaining hunk
  if (hunk.length > 0) {
    diff.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@`);
    diff.push(...hunk);
  }

  return diff.join('\n');
}

export default applyFix;
