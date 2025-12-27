// ============================================
// Performance Analyzer
// Static and runtime performance analysis
// ============================================

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Platform } from '../types.js';
import { analyzeTypeScript, CodeAnalysisResult } from './astAnalyzer.js';

const execAsync = promisify(exec);

// ============================================
// Types
// ============================================
export interface PerformanceIssue {
  type: 'critical' | 'major' | 'minor';
  category: 'rendering' | 'computation' | 'memory' | 'network' | 'bundle';
  title: string;
  description: string;
  file: string;
  line?: number;
  impact: string;
  suggestion: string;
  estimatedGain?: string;
}

export interface RenderingAnalysis {
  issues: PerformanceIssue[];
  expensiveComponents: {
    name: string;
    file: string;
    reason: string;
    renderCount?: number;
  }[];
  memoizationOpportunities: {
    component: string;
    file: string;
    suggestion: string;
  }[];
}

export interface ComputationAnalysis {
  issues: PerformanceIssue[];
  heavyFunctions: {
    name: string;
    file: string;
    complexity: number;
    suggestion: string;
  }[];
  optimizationOpportunities: {
    location: string;
    type: string;
    suggestion: string;
  }[];
}

export interface NetworkAnalysis {
  issues: PerformanceIssue[];
  apiCalls: {
    endpoint: string;
    file: string;
    line: number;
    hasErrorHandling: boolean;
    hasRetry: boolean;
    hasCaching: boolean;
  }[];
  suggestions: string[];
}

export interface BundleAnalysis {
  issues: PerformanceIssue[];
  largeImports: {
    module: string;
    file: string;
    estimatedSize?: string;
    alternative?: string;
  }[];
  unusedExports: string[];
  treeShakingOpportunities: string[];
}

export interface PerformanceReport {
  projectPath: string;
  platform: Platform;
  analyzedAt: string;
  summary: {
    criticalIssues: number;
    majorIssues: number;
    minorIssues: number;
    performanceScore: number;
  };
  rendering: RenderingAnalysis;
  computation: ComputationAnalysis;
  network: NetworkAnalysis;
  bundle: BundleAnalysis;
  recommendations: {
    priority: 'high' | 'medium' | 'low';
    category: string;
    description: string;
    estimatedImpact: string;
  }[];
}

// ============================================
// Main Analysis Function
// ============================================
export async function analyzePerformance(
  projectPath: string,
  platform: Platform
): Promise<PerformanceReport> {
  const extensions = getExtensionsForPlatform(platform);
  const files = getAllSourceFiles(projectPath, extensions);

  const allIssues: PerformanceIssue[] = [];
  const rendering = await analyzeRendering(files, platform);
  const computation = await analyzeComputation(files, platform);
  const network = await analyzeNetwork(files);
  const bundle = await analyzeBundle(projectPath, files, platform);

  // Collect all issues
  allIssues.push(...rendering.issues);
  allIssues.push(...computation.issues);
  allIssues.push(...network.issues);
  allIssues.push(...bundle.issues);

  // Calculate performance score
  const criticalCount = allIssues.filter(i => i.type === 'critical').length;
  const majorCount = allIssues.filter(i => i.type === 'major').length;
  const minorCount = allIssues.filter(i => i.type === 'minor').length;

  let score = 100;
  score -= criticalCount * 15;
  score -= majorCount * 5;
  score -= minorCount * 1;
  score = Math.max(0, Math.min(100, score));

  // Generate recommendations
  const recommendations = generateRecommendations(rendering, computation, network, bundle);

  return {
    projectPath,
    platform,
    analyzedAt: new Date().toISOString(),
    summary: {
      criticalIssues: criticalCount,
      majorIssues: majorCount,
      minorIssues: minorCount,
      performanceScore: score,
    },
    rendering,
    computation,
    network,
    bundle,
    recommendations,
  };
}

// ============================================
// Rendering Analysis
// ============================================
async function analyzeRendering(files: string[], platform: Platform): Promise<RenderingAnalysis> {
  const issues: PerformanceIssue[] = [];
  const expensiveComponents: RenderingAnalysis['expensiveComponents'] = [];
  const memoizationOpportunities: RenderingAnalysis['memoizationOpportunities'] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');

      // Check for inline object creation in JSX
      if (content.includes('style={{')) {
        const matches = content.matchAll(/style=\{\{[^}]+\}\}/g);
        for (const match of matches) {
          issues.push({
            type: 'major',
            category: 'rendering',
            title: 'Inline style object in render',
            description: 'Creating style objects inline causes new object creation on every render',
            file,
            line: getLineNumber(content, match.index || 0),
            impact: 'Unnecessary re-renders and garbage collection',
            suggestion: 'Move style object outside component or use useMemo',
            estimatedGain: '10-30% render performance improvement',
          });
        }
      }

      // Check for inline arrow functions in JSX
      const inlineArrowRegex = /on\w+=\{\s*\(\s*\)\s*=>/g;
      if (inlineArrowRegex.test(content)) {
        issues.push({
          type: 'major',
          category: 'rendering',
          title: 'Inline arrow function in render',
          description: 'Inline arrow functions create new function instances on every render',
          file,
          impact: 'May cause child component re-renders',
          suggestion: 'Use useCallback to memoize event handlers',
          estimatedGain: 'Prevents unnecessary child re-renders',
        });
      }

      // Check for missing React.memo on large components
      if (platform === 'react-native' || platform === 'web') {
        const componentMatch = content.match(/(?:export\s+)?(?:const|function)\s+(\w+)[^{]*(?:=>|{)[\s\S]{500,}/);
        if (componentMatch && !content.includes('React.memo') && !content.includes('memo(')) {
          const name = componentMatch[1] || 'Component';
          expensiveComponents.push({
            name,
            file,
            reason: 'Large component without memoization',
          });

          memoizationOpportunities.push({
            component: name,
            file,
            suggestion: `Wrap ${name} with React.memo() to prevent unnecessary re-renders`,
          });
        }
      }

      // Check for expensive operations in render
      const expensivePatterns = [
        { pattern: /\.filter\s*\(/, name: 'Array.filter' },
        { pattern: /\.map\s*\(/, name: 'Array.map' },
        { pattern: /\.reduce\s*\(/, name: 'Array.reduce' },
        { pattern: /JSON\.stringify/, name: 'JSON.stringify' },
        { pattern: /JSON\.parse/, name: 'JSON.parse' },
        { pattern: /new Date\s*\(/, name: 'Date creation' },
      ];

      for (const { pattern, name } of expensivePatterns) {
        // Check if inside render/return
        const returnIndex = content.indexOf('return');
        if (returnIndex > 0) {
          const afterReturn = content.substring(returnIndex);
          if (pattern.test(afterReturn)) {
            issues.push({
              type: 'minor',
              category: 'rendering',
              title: `${name} in render path`,
              description: `${name} called during render may impact performance`,
              file,
              impact: 'Computation on every render',
              suggestion: `Move ${name} to useMemo or calculate before render`,
            });
          }
        }
      }

      // Check for missing key prop in lists
      if (content.includes('.map') && !content.includes('key=')) {
        issues.push({
          type: 'major',
          category: 'rendering',
          title: 'Missing key prop in list rendering',
          description: 'List items without key prop cause inefficient reconciliation',
          file,
          impact: 'React cannot efficiently update list items',
          suggestion: 'Add unique key prop to each list item',
        });
      }

      // Flutter-specific checks
      if (platform === 'flutter') {
        // Check for rebuild on every setState
        if (content.includes('setState') && !content.includes('const ')) {
          issues.push({
            type: 'minor',
            category: 'rendering',
            title: 'setState may cause full widget rebuild',
            description: 'Consider using const constructors to prevent rebuilds',
            file,
            impact: 'Unnecessary widget rebuilds',
            suggestion: 'Use const constructors where possible',
          });
        }

        // Check for missing const in widget constructors
        const widgetRegex = /return\s+(?!const\s+)\w+\s*\(/g;
        if (widgetRegex.test(content)) {
          issues.push({
            type: 'minor',
            category: 'rendering',
            title: 'Widget without const constructor',
            description: 'Non-const widgets are rebuilt on every parent rebuild',
            file,
            impact: 'Unnecessary widget rebuilds',
            suggestion: 'Use const constructors for stateless widgets',
          });
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return { issues, expensiveComponents, memoizationOpportunities };
}

// ============================================
// Computation Analysis
// ============================================
async function analyzeComputation(files: string[], platform: Platform): Promise<ComputationAnalysis> {
  const issues: PerformanceIssue[] = [];
  const heavyFunctions: ComputationAnalysis['heavyFunctions'] = [];
  const optimizationOpportunities: ComputationAnalysis['optimizationOpportunities'] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const analysis = analyzeTypeScript(file, content);

      // Check for high complexity functions
      for (const func of analysis.functions) {
        if (func.complexity > 10) {
          heavyFunctions.push({
            name: func.name,
            file,
            complexity: func.complexity,
            suggestion: 'Consider breaking into smaller functions',
          });

          if (func.complexity > 20) {
            issues.push({
              type: 'major',
              category: 'computation',
              title: `High complexity function: ${func.name}`,
              description: `Cyclomatic complexity of ${func.complexity} exceeds recommended threshold`,
              file,
              line: func.line,
              impact: 'Hard to maintain and may indicate performance issues',
              suggestion: 'Refactor into smaller, more focused functions',
            });
          }
        }
      }

      // Check for nested loops
      const nestedLoopRegex = /for\s*\([^)]+\)[^{]*\{[^}]*for\s*\([^)]+\)/gs;
      if (nestedLoopRegex.test(content)) {
        issues.push({
          type: 'major',
          category: 'computation',
          title: 'Nested loops detected',
          description: 'Nested loops can cause O(n²) or worse complexity',
          file,
          impact: 'Performance degrades rapidly with data size',
          suggestion: 'Consider using Map/Set for lookups or restructuring algorithm',
        });
      }

      // Check for synchronous blocking operations
      const blockingPatterns = [
        { pattern: /fs\.readFileSync/, name: 'Synchronous file read' },
        { pattern: /fs\.writeFileSync/, name: 'Synchronous file write' },
        { pattern: /JSON\.parse\s*\([^)]*readFileSync/, name: 'Sync file read + JSON parse' },
      ];

      for (const { pattern, name } of blockingPatterns) {
        if (pattern.test(content)) {
          issues.push({
            type: 'major',
            category: 'computation',
            title: name,
            description: 'Synchronous operation blocks the event loop',
            file,
            impact: 'UI freezing and poor responsiveness',
            suggestion: 'Use async alternatives (readFile, writeFile)',
          });
        }
      }

      // Check for expensive regex in loops
      const regexInLoopRegex = /(?:for|while)\s*\([^)]+\)[^{]*\{[^}]*(?:\.match|\.replace|\.test)\s*\(/gs;
      if (regexInLoopRegex.test(content)) {
        optimizationOpportunities.push({
          location: file,
          type: 'regex',
          suggestion: 'Move regex pattern outside loop to avoid recompilation',
        });
      }

      // Check for unnecessary array spread
      if (content.includes('[...') && content.includes('.push(')) {
        optimizationOpportunities.push({
          location: file,
          type: 'array',
          suggestion: 'Consider using push() instead of spread for building arrays',
        });
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return { issues, heavyFunctions, optimizationOpportunities };
}

// ============================================
// Network Analysis
// ============================================
async function analyzeNetwork(files: string[]): Promise<NetworkAnalysis> {
  const issues: PerformanceIssue[] = [];
  const apiCalls: NetworkAnalysis['apiCalls'] = [];
  const suggestions: string[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');

      // Find fetch/axios calls
      const fetchRegex = /(?:fetch|axios\.(?:get|post|put|delete|patch))\s*\(\s*['"`]([^'"`]+)['"`]/g;
      let match;
      while ((match = fetchRegex.exec(content)) !== null) {
        const endpoint = match[1] || '';
        const line = getLineNumber(content, match.index);

        // Check for error handling
        const surroundingCode = content.substring(Math.max(0, match.index - 200), match.index + 500);
        const hasErrorHandling = surroundingCode.includes('.catch') || surroundingCode.includes('try');
        const hasRetry = surroundingCode.includes('retry') || surroundingCode.includes('Retry');
        const hasCaching = surroundingCode.includes('cache') || surroundingCode.includes('Cache');

        apiCalls.push({
          endpoint,
          file,
          line,
          hasErrorHandling,
          hasRetry,
          hasCaching,
        });

        if (!hasErrorHandling) {
          issues.push({
            type: 'major',
            category: 'network',
            title: 'API call without error handling',
            description: `fetch/axios call to ${endpoint} has no error handling`,
            file,
            line,
            impact: 'Unhandled network errors may crash the app',
            suggestion: 'Add .catch() or try/catch for error handling',
          });
        }
      }

      // Check for API calls in useEffect without abort controller
      if (content.includes('useEffect') && (content.includes('fetch') || content.includes('axios'))) {
        if (!content.includes('AbortController') && !content.includes('abortController')) {
          issues.push({
            type: 'minor',
            category: 'network',
            title: 'API call in useEffect without AbortController',
            description: 'API calls may complete after component unmounts',
            file,
            impact: 'Memory leaks and state updates on unmounted components',
            suggestion: 'Use AbortController to cancel requests on unmount',
          });
        }
      }

      // Check for waterfall requests
      const awaitFetchCount = (content.match(/await\s+(?:fetch|axios)/g) || []).length;
      if (awaitFetchCount > 2) {
        const hasPromiseAll = content.includes('Promise.all');
        if (!hasPromiseAll) {
          issues.push({
            type: 'major',
            category: 'network',
            title: 'Sequential API calls detected',
            description: `${awaitFetchCount} sequential await calls may cause waterfall requests`,
            file,
            impact: 'Increased loading time due to sequential requests',
            suggestion: 'Use Promise.all() for independent requests',
            estimatedGain: 'Reduce loading time by parallelizing requests',
          });
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Generate suggestions based on findings
  if (apiCalls.some(a => !a.hasCaching)) {
    suggestions.push('Consider implementing response caching for frequently called endpoints');
  }
  if (apiCalls.some(a => !a.hasRetry)) {
    suggestions.push('Add retry logic for critical API endpoints');
  }
  if (apiCalls.length > 10) {
    suggestions.push('Consider implementing request batching to reduce network overhead');
  }

  return { issues, apiCalls, suggestions };
}

// ============================================
// Bundle Analysis
// ============================================
async function analyzeBundle(
  projectPath: string,
  files: string[],
  platform: Platform
): Promise<BundleAnalysis> {
  const issues: PerformanceIssue[] = [];
  const largeImports: BundleAnalysis['largeImports'] = [];
  const unusedExports: string[] = [];
  const treeShakingOpportunities: string[] = [];

  // Known large libraries
  const largeLibraries: Record<string, { size: string; alternative?: string }> = {
    'moment': { size: '~300KB', alternative: 'date-fns or dayjs' },
    'lodash': { size: '~70KB', alternative: 'lodash-es with tree-shaking' },
    'rxjs': { size: '~50KB', alternative: 'Import only needed operators' },
    'chart.js': { size: '~200KB', alternative: 'react-chartjs-2 with lazy loading' },
    'd3': { size: '~250KB', alternative: 'Import only needed d3 modules' },
    'firebase': { size: '~300KB', alternative: 'Use modular Firebase SDK' },
    '@material-ui': { size: '~300KB', alternative: 'Import components individually' },
    'antd': { size: '~500KB', alternative: 'Use babel-plugin-import' },
  };

  const allImports: Map<string, string[]> = new Map();
  const allExports: Map<string, string[]> = new Map();

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');

      // Check for large library imports
      const importRegex = /import\s+(?:\*\s+as\s+\w+|\w+|\{[^}]+\})\s+from\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const module = match[1] || '';
        const baseName = module.split('/')[0] || module;

        // Track imports
        if (!allImports.has(baseName)) {
          allImports.set(baseName, []);
        }
        allImports.get(baseName)!.push(file);

        // Check for known large libraries
        if (largeLibraries[baseName]) {
          const lib = largeLibraries[baseName];
          if (!largeImports.some(i => i.module === baseName)) {
            largeImports.push({
              module: baseName,
              file,
              estimatedSize: lib?.size,
              alternative: lib?.alternative,
            });

            issues.push({
              type: 'minor',
              category: 'bundle',
              title: `Large library import: ${baseName}`,
              description: `${baseName} adds approximately ${lib?.size} to bundle`,
              file,
              impact: 'Increased bundle size and load time',
              suggestion: lib?.alternative || 'Consider alternatives or lazy loading',
            });
          }
        }

        // Check for full library imports that should be tree-shaken
        if (content.includes(`import ${baseName} from`) || content.includes(`import * as`)) {
          if (['lodash', 'rxjs', 'd3', 'ramda'].includes(baseName)) {
            treeShakingOpportunities.push(
              `${baseName} in ${file}: Import only used functions instead of entire library`
            );
          }
        }
      }

      // Track exports
      const exportRegex = /export\s+(?:const|let|var|function|class)\s+(\w+)/g;
      while ((match = exportRegex.exec(content)) !== null) {
        const name = match[1] || '';
        if (!allExports.has(file)) {
          allExports.set(file, []);
        }
        allExports.get(file)!.push(name);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Check for unused exports (basic check)
  for (const [exportFile, exports] of allExports.entries()) {
    for (const exp of exports) {
      let isUsed = false;
      for (const file of files) {
        if (file === exportFile) continue;
        try {
          const content = fs.readFileSync(file, 'utf-8');
          if (content.includes(exp)) {
            isUsed = true;
            break;
          }
        } catch {
          // Skip
        }
      }
      if (!isUsed && exp !== 'default') {
        unusedExports.push(`${exp} in ${exportFile}`);
      }
    }
  }

  // Check package.json for bundle-affecting issues
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      // Check for dev dependencies that might be bundled
      const devDeps = Object.keys(packageJson.devDependencies || {});
      const prodDeps = Object.keys(packageJson.dependencies || {});

      for (const [module, importFiles] of allImports.entries()) {
        if (devDeps.includes(module) && !prodDeps.includes(module)) {
          issues.push({
            type: 'minor',
            category: 'bundle',
            title: `Dev dependency imported in production code`,
            description: `${module} is a devDependency but imported in ${importFiles.join(', ')}`,
            file: importFiles[0] || '',
            impact: 'May cause build issues or unnecessary bundle size',
            suggestion: 'Move to dependencies or remove import',
          });
        }
      }
    }
  } catch {
    // Skip package.json analysis
  }

  return { issues, largeImports, unusedExports, treeShakingOpportunities };
}

// ============================================
// Recommendations Generator
// ============================================
function generateRecommendations(
  rendering: RenderingAnalysis,
  computation: ComputationAnalysis,
  network: NetworkAnalysis,
  bundle: BundleAnalysis
): PerformanceReport['recommendations'] {
  const recommendations: PerformanceReport['recommendations'] = [];

  // Rendering recommendations
  if (rendering.memoizationOpportunities.length > 0) {
    recommendations.push({
      priority: 'high',
      category: 'Rendering',
      description: `Add React.memo to ${rendering.memoizationOpportunities.length} components to prevent unnecessary re-renders`,
      estimatedImpact: '10-50% render performance improvement',
    });
  }

  if (rendering.issues.filter(i => i.title.includes('inline')).length > 3) {
    recommendations.push({
      priority: 'medium',
      category: 'Rendering',
      description: 'Refactor inline functions and objects to prevent re-creation on each render',
      estimatedImpact: 'Reduced garbage collection and smoother UI',
    });
  }

  // Computation recommendations
  if (computation.heavyFunctions.length > 0) {
    recommendations.push({
      priority: 'medium',
      category: 'Code Quality',
      description: `Refactor ${computation.heavyFunctions.length} high-complexity functions for better maintainability`,
      estimatedImpact: 'Improved code quality and potential performance gains',
    });
  }

  // Network recommendations
  if (network.issues.filter(i => i.title.includes('Sequential')).length > 0) {
    recommendations.push({
      priority: 'high',
      category: 'Network',
      description: 'Parallelize sequential API calls using Promise.all',
      estimatedImpact: 'Significant reduction in loading time',
    });
  }

  if (network.apiCalls.filter(a => !a.hasErrorHandling).length > 0) {
    recommendations.push({
      priority: 'high',
      category: 'Network',
      description: 'Add error handling to all API calls',
      estimatedImpact: 'Improved app stability and user experience',
    });
  }

  // Bundle recommendations
  if (bundle.largeImports.length > 0) {
    recommendations.push({
      priority: 'medium',
      category: 'Bundle Size',
      description: `Optimize ${bundle.largeImports.length} large library imports using tree-shaking or alternatives`,
      estimatedImpact: 'Reduced bundle size and faster load times',
    });
  }

  if (bundle.treeShakingOpportunities.length > 0) {
    recommendations.push({
      priority: 'low',
      category: 'Bundle Size',
      description: 'Enable tree-shaking for lodash, rxjs, and other libraries',
      estimatedImpact: '10-30% bundle size reduction',
    });
  }

  return recommendations;
}

// ============================================
// Helper Functions
// ============================================
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
  const skipDirs = ['node_modules', '.git', 'build', 'dist', 'Pods', '.gradle', 'DerivedData', '__tests__', 'test'];

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

function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length;
}

export default {
  analyzePerformance,
};
