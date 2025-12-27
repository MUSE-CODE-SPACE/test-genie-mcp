// ============================================
// Enhanced AST Analyzer
// Deep code analysis using ts-morph
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import { Platform, ComponentInfo, ApiInfo, LifecycleInfo, StateInfo, PropInfo } from '../types.js';

// ============================================
// Types
// ============================================
export interface FunctionInfo {
  name: string;
  path: string;
  line: number;
  parameters: { name: string; type: string; optional: boolean }[];
  returnType: string;
  async: boolean;
  complexity: number;
  linesOfCode: number;
  dependencies: string[];
  calls: string[];
  isExported: boolean;
}

export interface ClassInfo {
  name: string;
  path: string;
  line: number;
  extends?: string;
  implements: string[];
  properties: { name: string; type: string; visibility: string; static: boolean }[];
  methods: FunctionInfo[];
  isExported: boolean;
}

export interface ImportInfo {
  module: string;
  imports: { name: string; alias?: string }[];
  isDefault: boolean;
  isNamespace: boolean;
  line: number;
}

export interface CodeAnalysisResult {
  functions: FunctionInfo[];
  classes: ClassInfo[];
  imports: ImportInfo[];
  exports: string[];
  hooks: HookInfo[];
  components: ComponentInfo[];
  apis: ApiInfo[];
  complexity: {
    average: number;
    max: number;
    total: number;
  };
  issues: CodeIssue[];
  metrics: {
    totalLines: number;
    codeLines: number;
    commentLines: number;
    blankLines: number;
    functionCount: number;
    classCount: number;
  };
}

export interface HookInfo {
  type: 'useState' | 'useEffect' | 'useCallback' | 'useMemo' | 'useRef' | 'useContext' | 'custom';
  name: string;
  line: number;
  dependencies?: string[];
  hasCleanup?: boolean;
  initialValue?: string;
}

export interface CodeIssue {
  type: 'error' | 'warning' | 'info';
  category: 'memory' | 'performance' | 'security' | 'style' | 'logic';
  message: string;
  line: number;
  column?: number;
  file: string;
  suggestion?: string;
}

// ============================================
// AST Parser (Using regex patterns for compatibility)
// In production, would use ts-morph or @babel/parser
// ============================================
export function analyzeTypeScript(filePath: string, content: string): CodeAnalysisResult {
  const functions = extractFunctions(content, filePath);
  const classes = extractClasses(content, filePath);
  const imports = extractImports(content);
  const exports = extractExports(content);
  const hooks = extractReactHooks(content, filePath);
  const components = extractReactComponents(content, filePath);
  const apis = extractApiCalls(content);
  const issues = analyzeCodeIssues(content, filePath);
  const metrics = calculateMetrics(content, functions, classes);

  const complexities = functions.map(f => f.complexity);
  const complexity = {
    average: complexities.length > 0 ? complexities.reduce((a, b) => a + b, 0) / complexities.length : 0,
    max: complexities.length > 0 ? Math.max(...complexities) : 0,
    total: complexities.reduce((a, b) => a + b, 0),
  };

  return {
    functions,
    classes,
    imports,
    exports,
    hooks,
    components,
    apis,
    complexity,
    issues,
    metrics,
  };
}

// ============================================
// Function Extraction
// ============================================
function extractFunctions(content: string, filePath: string): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  const lines = content.split('\n');

  // Arrow functions
  const arrowFuncRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(async\s*)?\(([^)]*)\)(?:\s*:\s*([^=>]+))?\s*=>/g;

  let match;
  while ((match = arrowFuncRegex.exec(content)) !== null) {
    const name = match[1] || 'anonymous';
    const isAsync = !!match[2];
    const params = parseParameters(match[3] || '');
    const returnType = match[4]?.trim() || 'void';
    const line = getLineNumber(content, match.index);
    const body = extractFunctionBody(content, match.index);

    functions.push({
      name,
      path: filePath,
      line,
      parameters: params,
      returnType,
      async: isAsync,
      complexity: calculateCyclomaticComplexity(body),
      linesOfCode: body.split('\n').length,
      dependencies: extractDependencies(body),
      calls: extractFunctionCalls(body),
      isExported: content.substring(Math.max(0, match.index - 10), match.index).includes('export'),
    });
  }

  // Regular functions
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/g;

  while ((match = funcRegex.exec(content)) !== null) {
    const name = match[1] || 'anonymous';
    const isAsync = content.substring(Math.max(0, match.index - 10), match.index).includes('async');
    const params = parseParameters(match[2] || '');
    const returnType = match[3]?.trim() || 'void';
    const line = getLineNumber(content, match.index);
    const body = extractFunctionBody(content, match.index);

    functions.push({
      name,
      path: filePath,
      line,
      parameters: params,
      returnType,
      async: isAsync,
      complexity: calculateCyclomaticComplexity(body),
      linesOfCode: body.split('\n').length,
      dependencies: extractDependencies(body),
      calls: extractFunctionCalls(body),
      isExported: content.substring(Math.max(0, match.index - 10), match.index).includes('export'),
    });
  }

  return functions;
}

function parseParameters(paramString: string): { name: string; type: string; optional: boolean }[] {
  if (!paramString.trim()) return [];

  const params: { name: string; type: string; optional: boolean }[] = [];
  const paramParts = paramString.split(',');

  for (const part of paramParts) {
    const match = part.trim().match(/(\w+)(\?)?(?::\s*(.+))?/);
    if (match) {
      params.push({
        name: match[1] || 'param',
        type: match[3]?.trim() || 'any',
        optional: !!match[2],
      });
    }
  }

  return params;
}

function extractFunctionBody(content: string, startIndex: number): string {
  let braceCount = 0;
  let started = false;
  let bodyStart = startIndex;
  let bodyEnd = startIndex;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];

    if (char === '{' || char === '(') {
      if (!started) {
        bodyStart = i;
        started = true;
      }
      braceCount++;
    } else if (char === '}' || char === ')') {
      braceCount--;
      if (started && braceCount === 0) {
        bodyEnd = i + 1;
        break;
      }
    }
  }

  return content.substring(bodyStart, bodyEnd);
}

function calculateCyclomaticComplexity(body: string): number {
  let complexity = 1;

  // Count decision points
  const decisionPatterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\?\s*[^:]+\s*:/g, // Ternary
    /\|\|/g,
    /&&/g,
  ];

  for (const pattern of decisionPatterns) {
    const matches = body.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
}

function extractDependencies(body: string): string[] {
  const deps: Set<string> = new Set();

  // Extract variable references
  const refRegex = /\b(?:this\.|props\.|state\.)(\w+)/g;
  let match;
  while ((match = refRegex.exec(body)) !== null) {
    deps.add(match[1] || '');
  }

  return Array.from(deps);
}

function extractFunctionCalls(body: string): string[] {
  const calls: Set<string> = new Set();

  const callRegex = /\b(\w+)\s*\(/g;
  let match;
  while ((match = callRegex.exec(body)) !== null) {
    const name = match[1] || '';
    // Exclude keywords and common constructs
    if (!['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'new'].includes(name)) {
      calls.add(name);
    }
  }

  return Array.from(calls);
}

// ============================================
// Class Extraction
// ============================================
function extractClasses(content: string, filePath: string): ClassInfo[] {
  const classes: ClassInfo[] = [];

  const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?\s*\{/g;

  let match;
  while ((match = classRegex.exec(content)) !== null) {
    const name = match[1] || 'Anonymous';
    const extendsClass = match[2];
    const implementsStr = match[3];
    const line = getLineNumber(content, match.index);

    const classBody = extractFunctionBody(content, match.index);
    const properties = extractClassProperties(classBody);
    const methods = extractClassMethods(classBody, filePath, line);

    classes.push({
      name,
      path: filePath,
      line,
      extends: extendsClass,
      implements: implementsStr ? implementsStr.split(',').map(s => s.trim()) : [],
      properties,
      methods,
      isExported: content.substring(Math.max(0, match.index - 10), match.index).includes('export'),
    });
  }

  return classes;
}

function extractClassProperties(classBody: string): { name: string; type: string; visibility: string; static: boolean }[] {
  const properties: { name: string; type: string; visibility: string; static: boolean }[] = [];

  const propRegex = /(private|protected|public)?\s*(static)?\s*(\w+)(?:\?)?(?::\s*([^;=]+))?(?:\s*=)?/g;

  let match;
  while ((match = propRegex.exec(classBody)) !== null) {
    const name = match[3] || '';
    // Skip methods
    if (classBody.substring(match.index, match.index + 100).includes('(')) continue;

    properties.push({
      name,
      type: match[4]?.trim() || 'any',
      visibility: match[1] || 'public',
      static: !!match[2],
    });
  }

  return properties;
}

function extractClassMethods(classBody: string, filePath: string, classLine: number): FunctionInfo[] {
  const methods: FunctionInfo[] = [];

  const methodRegex = /(private|protected|public)?\s*(static)?\s*(async)?\s*(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?\s*\{/g;

  let match;
  while ((match = methodRegex.exec(classBody)) !== null) {
    const name = match[4] || '';
    if (['constructor', 'if', 'for', 'while'].includes(name)) continue;

    const params = parseParameters(match[5] || '');
    const returnType = match[6]?.trim() || 'void';
    const methodBody = extractFunctionBody(classBody, match.index);

    methods.push({
      name,
      path: filePath,
      line: classLine + getLineNumber(classBody, match.index),
      parameters: params,
      returnType,
      async: !!match[3],
      complexity: calculateCyclomaticComplexity(methodBody),
      linesOfCode: methodBody.split('\n').length,
      dependencies: extractDependencies(methodBody),
      calls: extractFunctionCalls(methodBody),
      isExported: false,
    });
  }

  return methods;
}

// ============================================
// Import/Export Extraction
// ============================================
function extractImports(content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Named imports
  const namedImportRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = namedImportRegex.exec(content)) !== null) {
    const importsStr = match[1] || '';
    const importItems = importsStr.split(',').map(s => {
      const parts = s.trim().split(/\s+as\s+/);
      return {
        name: parts[0]?.trim() || '',
        alias: parts[1]?.trim(),
      };
    });

    imports.push({
      module: match[2] || '',
      imports: importItems,
      isDefault: false,
      isNamespace: false,
      line: getLineNumber(content, match.index),
    });
  }

  // Default imports
  const defaultImportRegex = /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
  while ((match = defaultImportRegex.exec(content)) !== null) {
    imports.push({
      module: match[2] || '',
      imports: [{ name: match[1] || '' }],
      isDefault: true,
      isNamespace: false,
      line: getLineNumber(content, match.index),
    });
  }

  // Namespace imports
  const namespaceImportRegex = /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
  while ((match = namespaceImportRegex.exec(content)) !== null) {
    imports.push({
      module: match[2] || '',
      imports: [{ name: match[1] || '' }],
      isDefault: false,
      isNamespace: true,
      line: getLineNumber(content, match.index),
    });
  }

  return imports;
}

function extractExports(content: string): string[] {
  const exports: Set<string> = new Set();

  // Named exports
  const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
  let match;
  while ((match = namedExportRegex.exec(content)) !== null) {
    exports.add(match[1] || '');
  }

  // Export list
  const exportListRegex = /export\s*\{([^}]+)\}/g;
  while ((match = exportListRegex.exec(content)) !== null) {
    const items = match[1]?.split(',') || [];
    for (const item of items) {
      const name = item.trim().split(/\s+as\s+/)[0]?.trim() || '';
      if (name) exports.add(name);
    }
  }

  // Default export
  if (content.includes('export default')) {
    exports.add('default');
  }

  return Array.from(exports);
}

// ============================================
// React Hooks Extraction
// ============================================
function extractReactHooks(content: string, filePath: string): HookInfo[] {
  const hooks: HookInfo[] = [];

  // useState
  const useStateRegex = /const\s*\[(\w+),\s*\w+\]\s*=\s*useState(?:<[^>]+>)?\s*\(([^)]*)\)/g;
  let match;
  while ((match = useStateRegex.exec(content)) !== null) {
    hooks.push({
      type: 'useState',
      name: match[1] || 'state',
      line: getLineNumber(content, match.index),
      initialValue: match[2]?.trim(),
    });
  }

  // useEffect
  const useEffectRegex = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}(?:,\s*\[([^\]]*)\])?\s*\)/gs;
  while ((match = useEffectRegex.exec(content)) !== null) {
    const body = match[1] || '';
    const deps = match[2]?.split(',').map(s => s.trim()).filter(Boolean) || [];

    hooks.push({
      type: 'useEffect',
      name: 'effect',
      line: getLineNumber(content, match.index),
      dependencies: deps,
      hasCleanup: body.includes('return'),
    });
  }

  // useCallback
  const useCallbackRegex = /const\s+(\w+)\s*=\s*useCallback\s*\([^,]+,\s*\[([^\]]*)\]\s*\)/g;
  while ((match = useCallbackRegex.exec(content)) !== null) {
    hooks.push({
      type: 'useCallback',
      name: match[1] || 'callback',
      line: getLineNumber(content, match.index),
      dependencies: match[2]?.split(',').map(s => s.trim()).filter(Boolean) || [],
    });
  }

  // useMemo
  const useMemoRegex = /const\s+(\w+)\s*=\s*useMemo\s*\([^,]+,\s*\[([^\]]*)\]\s*\)/g;
  while ((match = useMemoRegex.exec(content)) !== null) {
    hooks.push({
      type: 'useMemo',
      name: match[1] || 'memo',
      line: getLineNumber(content, match.index),
      dependencies: match[2]?.split(',').map(s => s.trim()).filter(Boolean) || [],
    });
  }

  // useRef
  const useRefRegex = /const\s+(\w+)\s*=\s*useRef(?:<[^>]+>)?\s*\(([^)]*)\)/g;
  while ((match = useRefRegex.exec(content)) !== null) {
    hooks.push({
      type: 'useRef',
      name: match[1] || 'ref',
      line: getLineNumber(content, match.index),
      initialValue: match[2]?.trim(),
    });
  }

  // Custom hooks
  const customHookRegex = /const\s+(?:\{[^}]+\}|\w+)\s*=\s*(use\w+)\s*\(/g;
  while ((match = customHookRegex.exec(content)) !== null) {
    const hookName = match[1] || '';
    if (!['useState', 'useEffect', 'useCallback', 'useMemo', 'useRef', 'useContext'].includes(hookName)) {
      hooks.push({
        type: 'custom',
        name: hookName,
        line: getLineNumber(content, match.index),
      });
    }
  }

  return hooks;
}

// ============================================
// React Component Extraction
// ============================================
function extractReactComponents(content: string, filePath: string): ComponentInfo[] {
  const components: ComponentInfo[] = [];

  // Functional components
  const funcCompRegex = /(?:export\s+)?(?:const|function)\s+(\w+)\s*(?::\s*(?:React\.)?FC(?:<[^>]+>)?)?[^{]*(?:=>|{)/g;

  let match;
  while ((match = funcCompRegex.exec(content)) !== null) {
    const name = match[1] || '';
    const line = getLineNumber(content, match.index);

    // Check if it returns JSX
    const body = extractFunctionBody(content, match.index);
    if (!body.includes('return') && !body.includes('<')) continue;
    if (!body.includes('<') || !/return[^<]*</.test(body)) {
      if (!content.substring(match.index, match.index + 200).includes('=>')) continue;
    }

    // Extract props
    const propsMatch = content.substring(match.index, match.index + 500).match(/\(\s*(?:\{([^}]+)\}|(\w+))\s*(?::\s*(\w+Props))?\s*\)/);
    const props: PropInfo[] = [];

    if (propsMatch && propsMatch[1]) {
      const propsStr = propsMatch[1];
      const propItems = propsStr.split(',');
      for (const item of propItems) {
        const propMatch = item.trim().match(/(\w+)(?:\s*=\s*[^,]+)?/);
        if (propMatch) {
          props.push({
            name: propMatch[1] || '',
            type: 'any',
            required: !item.includes('='),
          });
        }
      }
    }

    // Extract state
    const state: StateInfo[] = [];
    const stateRegex = /const\s*\[(\w+),\s*set\w+\]\s*=\s*useState(?:<([^>]+)>)?\s*\(([^)]*)\)/g;
    let stateMatch;
    while ((stateMatch = stateRegex.exec(body)) !== null) {
      state.push({
        name: stateMatch[1] || '',
        type: stateMatch[2]?.trim() || 'unknown',
        initialValue: stateMatch[3]?.trim(),
      });
    }

    // Extract lifecycle (useEffect)
    const lifecycle: LifecycleInfo[] = [];
    const effectRegex = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gs;
    let effectMatch;
    while ((effectMatch = effectRegex.exec(body)) !== null) {
      const effectBody = effectMatch[1] || '';
      const subscriptions: string[] = [];

      if (effectBody.includes('subscribe')) subscriptions.push('subscription');
      if (effectBody.includes('addEventListener')) subscriptions.push('eventListener');
      if (effectBody.includes('setInterval')) subscriptions.push('interval');
      if (effectBody.includes('setTimeout')) subscriptions.push('timeout');

      lifecycle.push({
        method: 'useEffect',
        hasCleanup: effectBody.includes('return'),
        subscriptions,
      });
    }

    // Extract dependencies
    const dependencies: string[] = [];
    const importRegex = /import\s+.*\s+from\s+['"]([^'"]+)['"]/g;
    let importMatch;
    while ((importMatch = importRegex.exec(content)) !== null) {
      dependencies.push(importMatch[1] || '');
    }

    components.push({
      name,
      path: filePath,
      type: 'component',
      props,
      state,
      lifecycle,
      dependencies,
    });
  }

  return components;
}

// ============================================
// API Call Extraction
// ============================================
function extractApiCalls(content: string): ApiInfo[] {
  const apis: ApiInfo[] = [];

  // Fetch
  const fetchRegex = /fetch\s*\(\s*['"`]([^'"`]+)['"`](?:,\s*\{([^}]+)\})?\s*\)/g;
  let match;
  while ((match = fetchRegex.exec(content)) !== null) {
    const options = match[2] || '';
    const methodMatch = options.match(/method:\s*['"](\w+)['"]/);

    apis.push({
      endpoint: match[1] || '',
      method: (methodMatch?.[1]?.toUpperCase() as ApiInfo['method']) || 'GET',
      path: match[1] || '',
      errorHandling: content.includes('.catch') || content.includes('try'),
    });
  }

  // Axios
  const axiosRegex = /axios\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  while ((match = axiosRegex.exec(content)) !== null) {
    apis.push({
      endpoint: match[2] || '',
      method: (match[1]?.toUpperCase() as ApiInfo['method']) || 'GET',
      path: match[2] || '',
      errorHandling: content.includes('.catch') || content.includes('try'),
    });
  }

  return apis;
}

// ============================================
// Code Issue Detection
// ============================================
function analyzeCodeIssues(content: string, filePath: string): CodeIssue[] {
  const issues: CodeIssue[] = [];

  // Memory issues
  if (content.includes('addEventListener') && !content.includes('removeEventListener')) {
    const line = getLineNumber(content, content.indexOf('addEventListener'));
    issues.push({
      type: 'warning',
      category: 'memory',
      message: 'Event listener added but not removed',
      line,
      file: filePath,
      suggestion: 'Add removeEventListener in cleanup/unmount',
    });
  }

  if (content.includes('setInterval') && !content.includes('clearInterval')) {
    const line = getLineNumber(content, content.indexOf('setInterval'));
    issues.push({
      type: 'warning',
      category: 'memory',
      message: 'setInterval called but not cleared',
      line,
      file: filePath,
      suggestion: 'Store interval ID and call clearInterval in cleanup',
    });
  }

  // useEffect without cleanup
  const effectRegex = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)(?:\},\s*\[[^\]]*\])?/gs;
  let effectMatch;
  while ((effectMatch = effectRegex.exec(content)) !== null) {
    const body = effectMatch[1] || '';
    if ((body.includes('subscribe') || body.includes('addEventListener') || body.includes('setInterval')) && !body.includes('return')) {
      issues.push({
        type: 'error',
        category: 'memory',
        message: 'useEffect with subscription/listener missing cleanup function',
        line: getLineNumber(content, effectMatch.index),
        file: filePath,
        suggestion: 'Add return statement with cleanup logic',
      });
    }
  }

  // Performance issues
  if (content.includes('console.log') || content.includes('console.debug')) {
    const line = getLineNumber(content, content.indexOf('console.'));
    issues.push({
      type: 'info',
      category: 'performance',
      message: 'Console statement found - should be removed in production',
      line,
      file: filePath,
      suggestion: 'Remove console statements or use a logging library',
    });
  }

  // Object created in render
  const objectInRenderRegex = /return\s*\([^)]*\{[^}]*:[^}]*\}[^)]*\)/gs;
  if (objectInRenderRegex.test(content)) {
    issues.push({
      type: 'warning',
      category: 'performance',
      message: 'Possible object creation in render - may cause unnecessary re-renders',
      line: 1,
      file: filePath,
      suggestion: 'Use useMemo to memoize objects passed as props',
    });
  }

  // Security issues
  if (content.includes('dangerouslySetInnerHTML')) {
    const line = getLineNumber(content, content.indexOf('dangerouslySetInnerHTML'));
    issues.push({
      type: 'error',
      category: 'security',
      message: 'dangerouslySetInnerHTML usage detected - XSS risk',
      line,
      file: filePath,
      suggestion: 'Sanitize HTML content or avoid using dangerouslySetInnerHTML',
    });
  }

  if (content.includes('eval(')) {
    const line = getLineNumber(content, content.indexOf('eval('));
    issues.push({
      type: 'error',
      category: 'security',
      message: 'eval() usage detected - security risk',
      line,
      file: filePath,
      suggestion: 'Avoid using eval - use safer alternatives',
    });
  }

  // Logic issues
  const asyncWithoutAwaitRegex = /async\s+(?:function\s+\w+|\(\w*\)\s*=>|\w+\s*=\s*async)[^{]*\{([^}]+)\}/g;
  let asyncMatch;
  while ((asyncMatch = asyncWithoutAwaitRegex.exec(content)) !== null) {
    const body = asyncMatch[1] || '';
    if (!body.includes('await')) {
      issues.push({
        type: 'warning',
        category: 'logic',
        message: 'Async function without await - may be unnecessary',
        line: getLineNumber(content, asyncMatch.index),
        file: filePath,
        suggestion: 'Either add await or remove async keyword',
      });
    }
  }

  return issues;
}

// ============================================
// Metrics Calculation
// ============================================
function calculateMetrics(
  content: string,
  functions: FunctionInfo[],
  classes: ClassInfo[]
): {
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  functionCount: number;
  classCount: number;
} {
  const lines = content.split('\n');
  let codeLines = 0;
  let commentLines = 0;
  let blankLines = 0;
  let inMultiLineComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      blankLines++;
    } else if (inMultiLineComment) {
      commentLines++;
      if (trimmed.includes('*/')) {
        inMultiLineComment = false;
      }
    } else if (trimmed.startsWith('//')) {
      commentLines++;
    } else if (trimmed.startsWith('/*')) {
      commentLines++;
      if (!trimmed.includes('*/')) {
        inMultiLineComment = true;
      }
    } else {
      codeLines++;
    }
  }

  return {
    totalLines: lines.length,
    codeLines,
    commentLines,
    blankLines,
    functionCount: functions.length,
    classCount: classes.length,
  };
}

// ============================================
// Helper Functions
// ============================================
function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

// ============================================
// Full Project Analysis
// ============================================
export async function analyzeProject(projectPath: string, platform: Platform): Promise<{
  files: { path: string; analysis: CodeAnalysisResult }[];
  summary: {
    totalFiles: number;
    totalFunctions: number;
    totalClasses: number;
    totalComponents: number;
    avgComplexity: number;
    issueCount: { error: number; warning: number; info: number };
  };
}> {
  const extensions = getExtensionsForPlatform(platform);
  const files = getAllSourceFiles(projectPath, extensions);

  const results: { path: string; analysis: CodeAnalysisResult }[] = [];
  let totalFunctions = 0;
  let totalClasses = 0;
  let totalComponents = 0;
  let totalComplexity = 0;
  let complexityCount = 0;
  const issueCount = { error: 0, warning: 0, info: 0 };

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const analysis = analyzeTypeScript(filePath, content);

      results.push({ path: filePath, analysis });

      totalFunctions += analysis.functions.length;
      totalClasses += analysis.classes.length;
      totalComponents += analysis.components.length;

      if (analysis.complexity.average > 0) {
        totalComplexity += analysis.complexity.average;
        complexityCount++;
      }

      for (const issue of analysis.issues) {
        issueCount[issue.type]++;
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return {
    files: results,
    summary: {
      totalFiles: files.length,
      totalFunctions,
      totalClasses,
      totalComponents,
      avgComplexity: complexityCount > 0 ? totalComplexity / complexityCount : 0,
      issueCount,
    },
  };
}

function getExtensionsForPlatform(platform: Platform): string[] {
  switch (platform) {
    case 'ios':
      return ['.swift', '.m', '.mm'];
    case 'android':
      return ['.kt', '.java'];
    case 'flutter':
      return ['.dart'];
    case 'react-native':
    case 'web':
    default:
      return ['.ts', '.tsx', '.js', '.jsx'];
  }
}

function getAllSourceFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  const skipDirs = ['node_modules', '.git', 'build', 'dist', 'Pods', '.gradle', 'DerivedData'];

  function walk(currentDir: string) {
    try {
      const items = fs.readdirSync(currentDir);
      for (const item of items) {
        if (skipDirs.includes(item)) continue;

        const fullPath = path.join(currentDir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (extensions.some(ext => item.endsWith(ext))) {
          results.push(fullPath);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  walk(dir);
  return results;
}

export default {
  analyzeTypeScript,
  analyzeProject,
};
