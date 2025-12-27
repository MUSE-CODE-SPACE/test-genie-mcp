// ============================================
// Suggest Fixes Tool
// ============================================

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import {
  DetectedIssue,
  FixSuggestion,
  ImpactInfo,
  AlternativeFix,
  Platform,
} from '../../types.js';
import { saveFixes } from '../../storage/index.js';
import { generateDiff } from '../../utils/codeParser.js';

interface SuggestFixesParams {
  issues: DetectedIssue[];
  projectPath: string;
  platform: Platform;
  autoGenerate?: boolean;
  maxSuggestions?: number;
}

interface SuggestFixesResult {
  suggestions: FixSuggestion[];
  summary: {
    totalSuggestions: number;
    byConfidence: { high: number; medium: number; low: number };
    bySeverity: Record<string, number>;
  };
}

export function suggestFixes(params: SuggestFixesParams): SuggestFixesResult {
  const {
    issues,
    projectPath,
    platform,
    autoGenerate = true,
    maxSuggestions = 50,
  } = params;

  const suggestions: FixSuggestion[] = [];

  // Generate fix suggestions for each issue
  for (const issue of issues.slice(0, maxSuggestions)) {
    const suggestion = generateFixSuggestion(issue, platform, projectPath);
    if (suggestion) {
      suggestions.push(suggestion);
    }
  }

  // Save suggestions
  saveFixes(suggestions, projectPath);

  // Generate summary
  const byConfidence = { high: 0, medium: 0, low: 0 };
  const bySeverity: Record<string, number> = {};

  for (const s of suggestions) {
    if (s.confidence >= 80) byConfidence.high++;
    else if (s.confidence >= 50) byConfidence.medium++;
    else byConfidence.low++;

    const severity = issues.find(i => i.id === s.issueId)?.severity || 'unknown';
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
  }

  return {
    suggestions,
    summary: {
      totalSuggestions: suggestions.length,
      byConfidence,
      bySeverity,
    },
  };
}

function generateFixSuggestion(
  issue: DetectedIssue,
  platform: Platform,
  projectPath: string
): FixSuggestion | null {
  // Read the original file
  let originalCode = '';
  try {
    const fileContent = fs.readFileSync(issue.file, 'utf-8');
    const lines = fileContent.split('\n');
    const startLine = Math.max(0, issue.line - 3);
    const endLine = Math.min(lines.length, issue.line + 5);
    originalCode = lines.slice(startLine, endLine).join('\n');
  } catch {
    originalCode = issue.code || '';
  }

  // Generate fix based on issue type
  const fix = generateFixCode(issue, platform, originalCode);
  if (!fix) return null;

  const diff = generateDiff(fix.original, fix.suggested);

  // Calculate impact
  const impact = analyzeImpact(issue, projectPath);

  // Generate alternatives
  const alternatives = generateAlternatives(issue, platform);

  return {
    id: uuidv4(),
    issueId: issue.id,
    title: `Fix: ${issue.title}`,
    description: issue.suggestion || `Resolve ${issue.type} issue`,
    confidence: fix.confidence,
    file: issue.file,
    line: issue.line,
    originalCode: fix.original,
    suggestedCode: fix.suggested,
    diff,
    impact,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

function generateFixCode(
  issue: DetectedIssue,
  platform: Platform,
  originalCode: string
): { original: string; suggested: string; confidence: number } | null {
  switch (issue.type) {
    case 'memory_leak':
      return generateMemoryLeakFix(issue, platform, originalCode);
    case 'retain_cycle':
      return generateRetainCycleFix(issue, platform, originalCode);
    case 'unclosed_resource':
      return generateResourceCleanupFix(issue, platform, originalCode);
    case 'race_condition':
      return generateRaceConditionFix(issue, platform, originalCode);
    case 'state_inconsistency':
      return generateStateConsistencyFix(issue, platform, originalCode);
    case 'null_reference':
      return generateNullCheckFix(issue, platform, originalCode);
    default:
      return null;
  }
}

function generateMemoryLeakFix(
  issue: DetectedIssue,
  platform: Platform,
  originalCode: string
): { original: string; suggested: string; confidence: number } | null {
  let suggested = originalCode;
  let confidence = 85;

  if (platform === 'react-native' || platform === 'web') {
    // useEffect without cleanup
    if (issue.title.includes('useEffect')) {
      if (originalCode.includes('addEventListener')) {
        suggested = originalCode.replace(
          /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{/,
          'useEffect(() => {\n    const abortController = new AbortController();'
        );
        suggested = suggested.replace(
          /\}\s*,\s*\[/,
          `\n    return () => {\n      abortController.abort();\n      // Cleanup event listeners here\n    };\n  }, [`
        );
      } else if (originalCode.includes('setInterval')) {
        suggested = originalCode.replace(
          /(const\s+\w+\s*=\s*setInterval)/,
          '$1'
        );
        if (!suggested.includes('return')) {
          suggested = suggested.replace(
            /\}\s*,\s*\[/,
            `\n    return () => clearInterval(intervalId);\n  }, [`
          );
        }
      } else if (originalCode.includes('subscribe')) {
        suggested = originalCode.replace(
          /\}\s*,\s*\[/,
          `\n    return () => subscription.unsubscribe();\n  }, [`
        );
      }
    }
  }

  if (platform === 'ios') {
    // NotificationCenter
    if (issue.title.includes('NotificationCenter')) {
      if (!originalCode.includes('removeObserver')) {
        suggested = originalCode + `\n\n    deinit {\n        NotificationCenter.default.removeObserver(self)\n    }`;
      }
    }

    // Timer
    if (issue.title.includes('Timer')) {
      if (!originalCode.includes('invalidate')) {
        suggested = originalCode + `\n\n    deinit {\n        timer?.invalidate()\n        timer = nil\n    }`;
      }
    }
  }

  if (platform === 'flutter') {
    // StreamSubscription
    if (issue.title.includes('StreamSubscription')) {
      if (!originalCode.includes('cancel')) {
        suggested = originalCode + `\n\n  @override\n  void dispose() {\n    subscription?.cancel();\n    super.dispose();\n  }`;
      }
    }

    // AnimationController
    if (issue.title.includes('AnimationController')) {
      if (!originalCode.includes('dispose')) {
        suggested = originalCode + `\n\n  @override\n  void dispose() {\n    controller.dispose();\n    super.dispose();\n  }`;
      }
    }
  }

  if (suggested === originalCode) {
    return null;
  }

  return { original: originalCode, suggested, confidence };
}

function generateRetainCycleFix(
  issue: DetectedIssue,
  platform: Platform,
  originalCode: string
): { original: string; suggested: string; confidence: number } | null {
  let suggested = originalCode;
  let confidence = 90;

  if (platform === 'ios') {
    // Add weak self to closure
    if (issue.title.includes('closure')) {
      suggested = originalCode.replace(
        /\{\s*(\n?\s*self\.)/,
        '{ [weak self] in\n        guard let self = self else { return }\n        self.'
      );
    }

    // Make delegate weak
    if (issue.title.includes('Delegate')) {
      suggested = originalCode.replace(
        /var\s+(\w*delegate\w*)\s*:\s*/i,
        'weak var $1: '
      );
    }
  }

  if (platform === 'react-native' || platform === 'web') {
    // This is typically handled by the memory leak fix for useEffect
    return null;
  }

  if (suggested === originalCode) {
    return null;
  }

  return { original: originalCode, suggested, confidence };
}

function generateResourceCleanupFix(
  issue: DetectedIssue,
  platform: Platform,
  originalCode: string
): { original: string; suggested: string; confidence: number } | null {
  let suggested = originalCode;
  let confidence = 85;

  if (platform === 'flutter') {
    const controllerMatch = originalCode.match(/(\w+Controller)\s+(\w+)/);
    if (controllerMatch) {
      const controllerName = controllerMatch[2];
      suggested = originalCode + `\n\n  @override\n  void dispose() {\n    ${controllerName}.dispose();\n    super.dispose();\n  }`;
    }
  }

  if (platform === 'android') {
    if (issue.title.includes('BroadcastReceiver')) {
      suggested = originalCode + `\n\n    override fun onDestroy() {\n        super.onDestroy()\n        unregisterReceiver(receiver)\n    }`;
    }
  }

  if (suggested === originalCode) {
    return null;
  }

  return { original: originalCode, suggested, confidence };
}

function generateRaceConditionFix(
  issue: DetectedIssue,
  platform: Platform,
  originalCode: string
): { original: string; suggested: string; confidence: number } | null {
  let suggested = originalCode;
  let confidence = 75;

  if (platform === 'react-native' || platform === 'web') {
    if (issue.title.includes('mount check')) {
      // Add isMounted check
      suggested = `const isMountedRef = useRef(true);\n\nuseEffect(() => {\n  return () => { isMountedRef.current = false; };\n}, []);\n\n` + originalCode;

      suggested = suggested.replace(
        /setState\s*\(/g,
        'if (isMountedRef.current) setState('
      );
    }

    if (issue.title.includes('Multiple setState')) {
      // Combine setState calls
      suggested = originalCode.replace(
        /setState\s*\(\s*\{([^}]+)\}\s*\)\s*;\s*setState\s*\(\s*\{([^}]+)\}\s*\)/g,
        'setState({ $1, $2 })'
      );
      confidence = 70;
    }
  }

  if (platform === 'flutter') {
    if (issue.title.includes('mounted')) {
      suggested = originalCode.replace(
        /await\s+([^;]+);\s*(\n\s*)setState/g,
        'await $1;\n    if (!mounted) return;$2setState'
      );
    }
  }

  if (suggested === originalCode) {
    return null;
  }

  return { original: originalCode, suggested, confidence };
}

function generateStateConsistencyFix(
  issue: DetectedIssue,
  platform: Platform,
  originalCode: string
): { original: string; suggested: string; confidence: number } | null {
  let suggested = originalCode;
  let confidence = 70;

  if (platform === 'react-native' || platform === 'web') {
    if (issue.title.includes('stale')) {
      // Add useEffect to sync with props
      const propMatch = originalCode.match(/useState\s*\(\s*props\.(\w+)\s*\)/);
      if (propMatch) {
        const propName = propMatch[1];
        suggested = originalCode + `\n\nuseEffect(() => {\n  setValue(props.${propName});\n}, [props.${propName}]);`;
      }
    }
  }

  if (suggested === originalCode) {
    return null;
  }

  return { original: originalCode, suggested, confidence };
}

function generateNullCheckFix(
  issue: DetectedIssue,
  platform: Platform,
  originalCode: string
): { original: string; suggested: string; confidence: number } | null {
  let suggested = originalCode;
  let confidence = 85;

  if (platform === 'react-native' || platform === 'web') {
    // Replace force unwrap with optional chaining
    suggested = originalCode.replace(/(\w+)!\./g, '$1?.');
  }

  if (platform === 'ios') {
    // Replace force unwrap with guard or if let
    const forceUnwrapMatch = originalCode.match(/(\w+)!/);
    if (forceUnwrapMatch) {
      const varName = forceUnwrapMatch[1];
      suggested = originalCode.replace(
        new RegExp(`(\\w+)!`),
        `${varName}` // Just remove the !, the user needs to add proper handling
      );
      suggested = `guard let ${varName} = ${varName} else { return }\n` + suggested;
    }
  }

  if (platform === 'android') {
    // Replace !! with safe call
    suggested = originalCode.replace(/(\w+)!!/g, '$1?');
  }

  if (suggested === originalCode) {
    return null;
  }

  return { original: originalCode, suggested, confidence };
}

function analyzeImpact(issue: DetectedIssue, projectPath: string): ImpactInfo {
  // Analyze affected files
  const filesAffected = [issue.file];
  const testsAffected: string[] = [];

  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (issue.severity === 'critical') riskLevel = 'high';
  else if (issue.severity === 'high') riskLevel = 'medium';

  // Check for breaking changes
  const breakingChange = issue.type === 'type_mismatch' || issue.type === 'state_inconsistency';

  return {
    filesAffected,
    testsAffected,
    riskLevel,
    breakingChange,
    requiresRetest: true,
  };
}

function generateAlternatives(issue: DetectedIssue, platform: Platform): AlternativeFix[] {
  const alternatives: AlternativeFix[] = [];

  if (issue.type === 'memory_leak' && platform === 'ios') {
    alternatives.push({
      description: 'Use unowned instead of weak',
      suggestedCode: '{ [unowned self] in\n    self.doSomething()\n}',
      diff: '',
      tradeoffs: 'Faster than weak, but crashes if self is deallocated',
    });
  }

  if (issue.type === 'null_reference') {
    alternatives.push({
      description: 'Use default value with nil coalescing',
      suggestedCode: 'value ?? defaultValue',
      diff: '',
      tradeoffs: 'Simpler but may hide issues if default is not appropriate',
    });
  }

  if (issue.type === 'race_condition') {
    alternatives.push({
      description: 'Use AbortController for cancellation',
      suggestedCode: 'const controller = new AbortController();\nfetch(url, { signal: controller.signal });',
      diff: '',
      tradeoffs: 'More explicit but requires handling abort errors',
    });
  }

  return alternatives;
}

export default suggestFixes;
