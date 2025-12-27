// ============================================
// Detect Logic Errors Tool
// ============================================

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import {
  DetectedIssue,
  LogicErrorInfo,
  Platform,
  AppStructure,
} from '../../types.js';
import { getAllFiles } from '../../utils/codeParser.js';
import { saveIssues } from '../../storage/index.js';

interface DetectLogicErrorsParams {
  appStructure: AppStructure;
  analysisDepth?: 'shallow' | 'normal' | 'deep';
  checkTypes?: ('race_condition' | 'state_inconsistency' | 'null_reference' | 'type_mismatch' | 'all')[];
}

interface DetectLogicErrorsResult {
  issues: LogicErrorInfo[];
  summary: {
    totalIssues: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  };
  recommendations: string[];
}

export function detectLogicErrors(params: DetectLogicErrorsParams): DetectLogicErrorsResult {
  const {
    appStructure,
    analysisDepth = 'normal',
    checkTypes = ['all'],
  } = params;

  const issues: LogicErrorInfo[] = [];
  const extensions = getExtensions(appStructure.platform);
  const files = getAllFiles(appStructure.projectPath, extensions);

  const shouldCheckAll = checkTypes.includes('all');

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');

      if (shouldCheckAll || checkTypes.includes('race_condition')) {
        issues.push(...detectRaceConditions(file, content, appStructure.platform));
      }

      if (shouldCheckAll || checkTypes.includes('state_inconsistency')) {
        issues.push(...detectStateInconsistencies(file, content, appStructure.platform));
      }

      if (shouldCheckAll || checkTypes.includes('null_reference')) {
        issues.push(...detectNullReferences(file, content, appStructure.platform));
      }

      if (shouldCheckAll || checkTypes.includes('type_mismatch')) {
        issues.push(...detectTypeMismatches(file, content, appStructure.platform));
      }

      if (analysisDepth === 'deep') {
        issues.push(...detectAdvancedLogicErrors(file, content, appStructure.platform));
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Save issues
  saveIssues(issues, appStructure.projectPath);

  // Generate summary
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const issue of issues) {
    byType[issue.type] = (byType[issue.type] || 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
  }

  return {
    issues,
    summary: {
      totalIssues: issues.length,
      byType,
      bySeverity,
    },
    recommendations: generateRecommendations(issues, appStructure),
  };
}

function detectRaceConditions(filePath: string, content: string, platform: Platform): LogicErrorInfo[] {
  const issues: LogicErrorInfo[] = [];
  const lines = content.split('\n');

  // Check for async state updates without proper synchronization
  const asyncStatePattern = /async\s+.*\{[\s\S]*?(setState|state\s*=|\.value\s*=)[\s\S]*?\}/g;
  let match;

  while ((match = asyncStatePattern.exec(content)) !== null) {
    const matchContent = match[0];
    const lineNum = content.substring(0, match.index).split('\n').length;

    // Check if there's proper handling for component unmount
    if (!matchContent.includes('isMounted') && !matchContent.includes('mounted') &&
        !matchContent.includes('disposed') && !matchContent.includes('cancelled')) {
      issues.push({
        id: uuidv4(),
        type: 'race_condition',
        severity: 'high',
        title: 'Async state update without mount check',
        description: 'Async operation updates state without checking if component is still mounted',
        file: filePath,
        line: lineNum,
        code: matchContent.substring(0, 150),
        context: 'Async state update',
        possibleCause: 'Component may unmount before async operation completes',
        reproducibility: 'intermittent',
        suggestion: 'Add isMounted check or use AbortController',
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // Check for race conditions in shared state
  if (platform === 'react-native' || platform === 'web') {
    // Multiple setState calls in sequence
    const setStatePattern = /setState\s*\([^)]+\)[^;]*;[\s\n]*setState\s*\(/g;
    while ((match = setStatePattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      issues.push({
        id: uuidv4(),
        type: 'race_condition',
        severity: 'medium',
        title: 'Multiple setState calls',
        description: 'Multiple setState calls may cause race condition or batching issues',
        file: filePath,
        line: lineNum,
        context: 'State updates',
        possibleCause: 'State updates may not batch correctly',
        reproducibility: 'intermittent',
        suggestion: 'Combine into single setState call or use functional updates',
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // Check for shared mutable state
  const sharedStatePattern = /let\s+(\w+)\s*=.*;\s*[\s\S]*?async[\s\S]*?\1\s*[+\-*\/]?=/g;
  while ((match = sharedStatePattern.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    issues.push({
      id: uuidv4(),
      type: 'race_condition',
      severity: 'high',
      title: 'Shared mutable state in async context',
      description: 'Mutable variable is accessed/modified in async context',
      file: filePath,
      line: lineNum,
      context: 'Async modification',
      possibleCause: 'Multiple async operations may access same variable',
      reproducibility: 'intermittent',
      suggestion: 'Use proper synchronization or immutable state pattern',
      detectedAt: new Date().toISOString(),
    });
  }

  return issues;
}

function detectStateInconsistencies(filePath: string, content: string, platform: Platform): LogicErrorInfo[] {
  const issues: LogicErrorInfo[] = [];
  const lines = content.split('\n');

  // Check for derived state not updated with source
  if (platform === 'react-native' || platform === 'web') {
    // useState that derives from props
    const derivedStatePattern = /useState\s*\(\s*props\.(\w+)\s*\)/g;
    let match;
    while ((match = derivedStatePattern.exec(content)) !== null) {
      const propName = match[1] || 'unknown';
      const lineNum = content.substring(0, match.index).split('\n').length;

      // Check if there's useEffect to sync
      if (!content.includes(`useEffect`) || !content.includes(propName)) {
        issues.push({
          id: uuidv4(),
          type: 'state_inconsistency',
          severity: 'medium',
          title: 'Derived state may become stale',
          description: `State initialized from props.${propName} but may not update when prop changes`,
          file: filePath,
          line: lineNum,
          context: 'Props to state',
          possibleCause: 'useState only uses initial value, subsequent prop changes are ignored',
          reproducibility: 'always',
          suggestion: 'Use useEffect to sync state with props, or compute value directly from props',
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // Check for conditional state updates
    const conditionalStatePattern = /if\s*\([^)]+\)\s*\{[^}]*setState[^}]*\}(?!\s*else)/g;
    while ((match = conditionalStatePattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const matchContent = match[0];

      // Check if the condition involves state
      if (matchContent.includes('state') || matchContent.includes('State')) {
        issues.push({
          id: uuidv4(),
          type: 'state_inconsistency',
          severity: 'low',
          title: 'Conditional state update without else branch',
          description: 'State is updated conditionally which may lead to inconsistent states',
          file: filePath,
          line: lineNum,
          code: matchContent.substring(0, 100),
          context: 'Conditional update',
          possibleCause: 'State may remain in unexpected state when condition is false',
          reproducibility: 'always',
          suggestion: 'Ensure all state paths are handled, or document expected behavior',
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }

  // Flutter specific
  if (platform === 'flutter') {
    // Check for setState after async gap
    const asyncSetStatePattern = /await\s+[^;]+;\s*[\s\S]{0,50}?setState/g;
    let match;
    while ((match = asyncSetStatePattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      if (!content.includes('mounted')) {
        issues.push({
          id: uuidv4(),
          type: 'state_inconsistency',
          severity: 'high',
          title: 'setState after async operation',
          description: 'setState called after await without checking mounted state',
          file: filePath,
          line: lineNum,
          context: 'Async setState',
          possibleCause: 'Widget may be disposed before setState is called',
          reproducibility: 'intermittent',
          suggestion: 'Check if (mounted) before calling setState after await',
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }

  return issues;
}

function detectNullReferences(filePath: string, content: string, platform: Platform): LogicErrorInfo[] {
  const issues: LogicErrorInfo[] = [];
  const lines = content.split('\n');

  // TypeScript/JavaScript null checks
  if (platform === 'react-native' || platform === 'web') {
    // Force unwrap with !
    const forceUnwrapPattern = /(\w+)!\./g;
    let match;
    while ((match = forceUnwrapPattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      issues.push({
        id: uuidv4(),
        type: 'null_reference',
        severity: 'medium',
        title: 'Non-null assertion operator',
        description: `Force unwrap of ${match[1]} may cause runtime error if null`,
        file: filePath,
        line: lineNum,
        code: lines[lineNum - 1]?.trim(),
        context: 'Force unwrap',
        possibleCause: 'Value may be null at runtime despite assertion',
        reproducibility: 'intermittent',
        suggestion: 'Use optional chaining (?.) or proper null check',
        detectedAt: new Date().toISOString(),
      });
    }

    // Accessing property without null check
    const nullableAccessPattern = /(\w+)\?\.[a-zA-Z]+\s*\(/g;
    while ((match = nullableAccessPattern.exec(content)) !== null) {
      // This is actually safe - it's using optional chaining
    }

    // Potential null access after conditional
    const unsafeAccessPattern = /if\s*\(\s*(\w+)\s*\)\s*\{[\s\S]*?\}\s*[\s\S]{0,50}?\1\./g;
    while ((match = unsafeAccessPattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const varName = match[1];

      // Check if there's an else that returns/throws
      if (!match[0].includes('return') && !match[0].includes('throw')) {
        issues.push({
          id: uuidv4(),
          type: 'null_reference',
          severity: 'low',
          title: 'Potential unsafe access after null check',
          description: `${varName} accessed outside of null-check block`,
          file: filePath,
          line: lineNum,
          context: 'Null check scope',
          possibleCause: 'Variable may be null when accessed outside if block',
          reproducibility: 'always',
          suggestion: 'Ensure access is within null-check block or add guard clause',
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }

  // Swift null checks
  if (platform === 'ios') {
    // Force unwrap
    const forceUnwrapPattern = /(\w+)!/g;
    let match;
    while ((match = forceUnwrapPattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      const varName = match[1];

      // Skip common false positives
      if (['try', 'as', 'NSObject'].includes(varName || '')) continue;

      issues.push({
        id: uuidv4(),
        type: 'null_reference',
        severity: 'medium',
        title: 'Force unwrap of optional',
        description: `Force unwrap of ${varName} may cause crash if nil`,
        file: filePath,
        line: lineNum,
        code: lines[lineNum - 1]?.trim(),
        context: 'Force unwrap',
        possibleCause: 'Optional value may be nil at runtime',
        reproducibility: 'intermittent',
        suggestion: 'Use if let, guard let, or nil coalescing (??) instead',
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // Kotlin null checks
  if (platform === 'android') {
    // Not-null assertion
    const notNullPattern = /(\w+)!!/g;
    let match;
    while ((match = notNullPattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      issues.push({
        id: uuidv4(),
        type: 'null_reference',
        severity: 'medium',
        title: 'Not-null assertion operator',
        description: `Not-null assertion on ${match[1]} may throw NPE`,
        file: filePath,
        line: lineNum,
        code: lines[lineNum - 1]?.trim(),
        context: 'Not-null assertion',
        possibleCause: 'Value may be null at runtime',
        reproducibility: 'intermittent',
        suggestion: 'Use safe call (?.) or null check',
        detectedAt: new Date().toISOString(),
      });
    }
  }

  return issues;
}

function detectTypeMismatches(filePath: string, content: string, platform: Platform): LogicErrorInfo[] {
  const issues: LogicErrorInfo[] = [];
  const lines = content.split('\n');

  // Check for 'any' type usage (TypeScript)
  if (platform === 'react-native' || platform === 'web') {
    const anyPattern = /:\s*any\b/g;
    let match;
    while ((match = anyPattern.exec(content)) !== null) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      issues.push({
        id: uuidv4(),
        type: 'type_mismatch',
        severity: 'low',
        title: 'Usage of any type',
        description: 'Using any type bypasses TypeScript type checking',
        file: filePath,
        line: lineNum,
        code: lines[lineNum - 1]?.trim(),
        context: 'Type annotation',
        possibleCause: 'May hide type errors that would be caught at compile time',
        reproducibility: 'always',
        suggestion: 'Replace any with specific type or unknown',
        detectedAt: new Date().toISOString(),
      });
    }

    // Type assertion misuse
    const assertionPattern = /as\s+\w+(?:\[\])?\s*(?![\w<])/g;
    while ((match = assertionPattern.exec(content)) !== null) {
      // This is informational only
    }
  }

  return issues;
}

function detectAdvancedLogicErrors(filePath: string, content: string, platform: Platform): LogicErrorInfo[] {
  const issues: LogicErrorInfo[] = [];
  const lines = content.split('\n');

  // Check for infinite loops
  const infiniteLoopPattern = /while\s*\(\s*true\s*\)|\bfor\s*\(\s*;\s*;\s*\)/g;
  let match;
  while ((match = infiniteLoopPattern.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    const afterMatch = content.substring(match.index, match.index + 200);

    if (!afterMatch.includes('break') && !afterMatch.includes('return')) {
      issues.push({
        id: uuidv4(),
        type: 'state_inconsistency',
        severity: 'critical',
        title: 'Potential infinite loop',
        description: 'Loop without apparent exit condition',
        file: filePath,
        line: lineNum,
        code: lines[lineNum - 1]?.trim(),
        context: 'Loop control',
        possibleCause: 'Loop may never terminate',
        reproducibility: 'always',
        suggestion: 'Add break condition or refactor loop',
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // Check for dead code after return
  const deadCodePattern = /return[^;]*;\s*\n\s*[a-zA-Z]/g;
  while ((match = deadCodePattern.exec(content)) !== null) {
    const lineNum = content.substring(0, match.index).split('\n').length;
    issues.push({
      id: uuidv4(),
      type: 'state_inconsistency',
      severity: 'low',
      title: 'Dead code after return',
      description: 'Code after return statement is unreachable',
      file: filePath,
      line: lineNum + 1,
      context: 'Unreachable code',
      possibleCause: 'Code after return will never execute',
      reproducibility: 'always',
      suggestion: 'Remove unreachable code',
      detectedAt: new Date().toISOString(),
    });
  }

  return issues;
}

function getExtensions(platform: Platform): string[] {
  switch (platform) {
    case 'ios': return ['.swift'];
    case 'android': return ['.kt', '.java'];
    case 'flutter': return ['.dart'];
    case 'react-native':
    case 'web': return ['.tsx', '.ts', '.jsx', '.js'];
    default: return ['.ts', '.js'];
  }
}

function generateRecommendations(issues: LogicErrorInfo[], appStructure: AppStructure): string[] {
  const recommendations: string[] = [];
  const issueTypes = new Set(issues.map(i => i.type));

  if (issueTypes.has('race_condition')) {
    recommendations.push('Implement proper async/await patterns with cancellation support');
    recommendations.push('Use React useEffect cleanup or AbortController for async operations');
  }

  if (issueTypes.has('state_inconsistency')) {
    recommendations.push('Consider using state machines for complex state logic');
    recommendations.push('Implement proper error boundaries and state recovery');
  }

  if (issueTypes.has('null_reference')) {
    recommendations.push('Enable strict null checks in TypeScript/Swift/Kotlin');
    recommendations.push('Use optional chaining and nullish coalescing operators');
  }

  if (issueTypes.has('type_mismatch')) {
    recommendations.push('Avoid using any type - prefer unknown or specific types');
    recommendations.push('Enable stricter TypeScript compiler options');
  }

  if (issues.filter(i => i.severity === 'critical' || i.severity === 'high').length > 5) {
    recommendations.push('Consider code review focused on async patterns and state management');
  }

  return recommendations;
}

export default detectLogicErrors;
