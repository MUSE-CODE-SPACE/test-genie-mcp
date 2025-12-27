// ============================================
// Generate Report Tool
// ============================================

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import {
  TestReport,
  ReportSection,
  AutomationResult,
  TestResult,
  DetectedIssue,
  FixSuggestion,
} from '../../types.js';

interface GenerateReportParams {
  automationResult: AutomationResult;
  format?: 'markdown' | 'html' | 'json';
  sections?: ('summary' | 'details' | 'issues' | 'fixes' | 'recommendations')[];
  outputPath?: string;
  includeCharts?: boolean;
}

interface GenerateReportResult {
  report: TestReport;
  content: string;
  outputPath?: string;
}

export function generateReport(params: GenerateReportParams): GenerateReportResult {
  const {
    automationResult,
    format = 'markdown',
    sections = ['summary', 'details', 'issues', 'fixes', 'recommendations'],
    outputPath,
    includeCharts = true,
  } = params;

  const reportSections: ReportSection[] = [];

  // Generate each section
  if (sections.includes('summary')) {
    reportSections.push(generateSummarySection(automationResult));
  }

  if (sections.includes('details')) {
    reportSections.push(generateDetailsSection(automationResult));
  }

  if (sections.includes('issues')) {
    reportSections.push(generateIssuesSection(automationResult));
  }

  if (sections.includes('fixes')) {
    reportSections.push(generateFixesSection(automationResult));
  }

  if (sections.includes('recommendations')) {
    reportSections.push(generateRecommendationsSection(automationResult));
  }

  const report: TestReport = {
    id: uuidv4(),
    title: `Test Automation Report - ${automationResult.config.platform}`,
    format,
    sections: reportSections,
    generatedAt: new Date().toISOString(),
  };

  // Generate content based on format
  let content: string;
  switch (format) {
    case 'html':
      content = generateHtmlReport(report, automationResult, includeCharts);
      break;
    case 'json':
      content = JSON.stringify({ report, automationResult }, null, 2);
      break;
    case 'markdown':
    default:
      content = generateMarkdownReport(report, automationResult);
      break;
  }

  // Save to file if path provided
  let savedPath: string | undefined;
  if (outputPath) {
    const extension = format === 'html' ? '.html' : format === 'json' ? '.json' : '.md';
    savedPath = outputPath.endsWith(extension) ? outputPath : outputPath + extension;

    const dir = path.dirname(savedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(savedPath, content);
  }

  return {
    report,
    content,
    outputPath: savedPath,
  };
}

function generateSummarySection(result: AutomationResult): ReportSection {
  const { summary } = result;
  const passRate = summary.totalScenarios > 0
    ? ((summary.passedScenarios / summary.totalScenarios) * 100).toFixed(1)
    : '0';

  const content = `
## Summary

| Metric | Value |
|--------|-------|
| Platform | ${result.config.platform} |
| Duration | ${summary.duration.toFixed(1)}s |
| Total Scenarios | ${summary.totalScenarios} |
| Passed | ${summary.passedScenarios} (${passRate}%) |
| Failed | ${summary.failedScenarios} |
| Issues Found | ${summary.totalIssues} |
| Critical Issues | ${summary.criticalIssues} |
| Fixes Applied | ${summary.fixesApplied} |
| Coverage | ${summary.coveragePercent}% |
`.trim();

  return {
    title: 'Summary',
    type: 'summary',
    content,
  };
}

function generateDetailsSection(result: AutomationResult): ReportSection {
  const { testResults } = result;

  let content = `
## Test Details

### Test Results by Scenario

| Scenario | Status | Duration |
|----------|--------|----------|
`;

  for (const test of testResults.slice(0, 50)) {
    const statusIcon = test.status === 'passed' ? '✅' : test.status === 'failed' ? '❌' : '⏭️';
    content += `| ${test.scenarioName.substring(0, 40)} | ${statusIcon} ${test.status} | ${test.duration}ms |\n`;
  }

  if (testResults.length > 50) {
    content += `\n*... and ${testResults.length - 50} more scenarios*\n`;
  }

  // Failed tests details
  const failedTests = testResults.filter(t => t.status === 'failed');
  if (failedTests.length > 0) {
    content += `
### Failed Tests

`;
    for (const test of failedTests.slice(0, 10)) {
      content += `#### ${test.scenarioName}\n\n`;
      content += `- **Error**: ${test.error?.message || 'Unknown error'}\n`;
      content += `- **Failed Step**: ${test.steps.find(s => s.status === 'failed')?.action || 'Unknown'}\n`;
      if (test.error?.stackTrace) {
        content += `\n\`\`\`\n${test.error.stackTrace.substring(0, 500)}\n\`\`\`\n`;
      }
      content += '\n';
    }
  }

  return {
    title: 'Test Details',
    type: 'details',
    content: content.trim(),
  };
}

function generateIssuesSection(result: AutomationResult): ReportSection {
  const { detectedIssues } = result;

  let content = `
## Detected Issues

Total: ${detectedIssues.length} issues

### By Severity

`;

  const bySeverity: Record<string, DetectedIssue[]> = {};
  for (const issue of detectedIssues) {
    if (!bySeverity[issue.severity]) {
      bySeverity[issue.severity] = [];
    }
    bySeverity[issue.severity]!.push(issue);
  }

  const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
  const severityEmoji: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
    info: '🔵',
  };

  for (const severity of severityOrder) {
    const issues = bySeverity[severity];
    if (issues && issues.length > 0) {
      content += `#### ${severityEmoji[severity] || ''} ${severity.charAt(0).toUpperCase() + severity.slice(1)} (${issues.length})\n\n`;

      for (const issue of issues.slice(0, 5)) {
        content += `- **${issue.title}**\n`;
        content += `  - File: \`${issue.file}:${issue.line}\`\n`;
        content += `  - ${issue.description}\n`;
        if (issue.suggestion) {
          content += `  - 💡 ${issue.suggestion}\n`;
        }
        content += '\n';
      }

      if (issues.length > 5) {
        content += `*... and ${issues.length - 5} more ${severity} issues*\n\n`;
      }
    }
  }

  return {
    title: 'Detected Issues',
    type: 'issues',
    content: content.trim(),
  };
}

function generateFixesSection(result: AutomationResult): ReportSection {
  const { fixSuggestions, appliedFixes } = result;

  let content = `
## Fix Suggestions

Total Suggestions: ${fixSuggestions.length}
Applied: ${appliedFixes.length}

### Applied Fixes

`;

  const applied = fixSuggestions.filter(f => f.status === 'applied');
  if (applied.length > 0) {
    for (const fix of applied) {
      content += `#### ✅ ${fix.title}\n\n`;
      content += `- File: \`${fix.file}:${fix.line}\`\n`;
      content += `- Confidence: ${fix.confidence}%\n`;
      content += '\n```diff\n' + fix.diff + '\n```\n\n';
    }
  } else {
    content += '*No fixes have been applied yet.*\n\n';
  }

  // Pending fixes
  const pending = fixSuggestions.filter(f => f.status === 'pending');
  if (pending.length > 0) {
    content += `### Pending Fixes (${pending.length})\n\n`;

    for (const fix of pending.slice(0, 10)) {
      content += `#### ⏳ ${fix.title}\n\n`;
      content += `- File: \`${fix.file}:${fix.line}\`\n`;
      content += `- Confidence: ${fix.confidence}%\n`;
      content += `- Description: ${fix.description}\n`;
      content += '\n';
    }

    if (pending.length > 10) {
      content += `*... and ${pending.length - 10} more pending fixes*\n`;
    }
  }

  return {
    title: 'Fix Suggestions',
    type: 'fixes',
    content: content.trim(),
  };
}

function generateRecommendationsSection(result: AutomationResult): ReportSection {
  const recommendations: string[] = [];
  const { summary, detectedIssues, testResults, simulationResult } = result;

  // Test coverage recommendations
  if (summary.coveragePercent < 80) {
    recommendations.push(`📊 **Increase Test Coverage**: Current coverage is ${summary.coveragePercent}%. Aim for at least 80%.`);
  }

  // Failure rate recommendations
  const failureRate = summary.totalScenarios > 0
    ? (summary.failedScenarios / summary.totalScenarios) * 100
    : 0;
  if (failureRate > 10) {
    recommendations.push(`🔴 **High Failure Rate**: ${failureRate.toFixed(1)}% of tests failed. Investigate and fix failing tests.`);
  }

  // Critical issues
  if (summary.criticalIssues > 0) {
    recommendations.push(`⚠️ **Critical Issues**: ${summary.criticalIssues} critical issues require immediate attention.`);
  }

  // Memory issues
  const memoryIssues = detectedIssues.filter(i => i.type === 'memory_leak' || i.type === 'retain_cycle');
  if (memoryIssues.length > 0) {
    recommendations.push(`🧠 **Memory Management**: ${memoryIssues.length} memory-related issues found. Review cleanup and lifecycle methods.`);
  }

  // Performance
  if (simulationResult && simulationResult.memoryPeakMB > 500) {
    recommendations.push(`📈 **High Memory Usage**: Peak memory was ${simulationResult.memoryPeakMB}MB. Consider optimizing resource usage.`);
  }

  if (simulationResult && simulationResult.cpuPeakPercent > 80) {
    recommendations.push(`⚡ **High CPU Usage**: Peak CPU was ${simulationResult.cpuPeakPercent}%. Optimize heavy computations.`);
  }

  // Pending fixes
  const pendingFixes = result.fixSuggestions.filter(f => f.status === 'pending');
  if (pendingFixes.length > 0) {
    recommendations.push(`🔧 **Pending Fixes**: ${pendingFixes.length} fix suggestions are awaiting review.`);
  }

  // General best practices
  recommendations.push(`📝 **Regular Testing**: Run automated tests regularly, ideally on every commit.`);
  recommendations.push(`🔄 **CI/CD Integration**: Consider integrating this automation into your CI/CD pipeline.`);

  let content = `
## Recommendations

`;

  for (let i = 0; i < recommendations.length; i++) {
    content += `${i + 1}. ${recommendations[i]}\n\n`;
  }

  return {
    title: 'Recommendations',
    type: 'recommendations',
    content: content.trim(),
  };
}

function generateMarkdownReport(report: TestReport, result: AutomationResult): string {
  let content = `# ${report.title}

Generated: ${new Date(report.generatedAt).toLocaleString()}

---

`;

  for (const section of report.sections) {
    content += section.content + '\n\n---\n\n';
  }

  content += `
## Appendix

### Configuration

\`\`\`json
${JSON.stringify(result.config, null, 2)}
\`\`\`

### Timestamps

- Started: ${result.startedAt}
- Completed: ${result.completedAt}
- Duration: ${result.summary.duration.toFixed(1)}s

---

*Report generated by Test Genie MCP*
`;

  return content;
}

function generateHtmlReport(report: TestReport, result: AutomationResult, includeCharts: boolean): string {
  const markdownContent = generateMarkdownReport(report, result);

  // Convert markdown to simple HTML
  let htmlContent = markdownContent
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(c => c.trim());
      return '<tr>' + cells.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
    })
    .replace(/---/g, '<hr>')
    .replace(/\n\n/g, '</p><p>');

  // Wrap in basic HTML structure
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${report.title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
      color: #333;
    }
    h1, h2, h3, h4 { color: #1a1a2e; }
    h1 { border-bottom: 2px solid #4a90a4; padding-bottom: 10px; }
    h2 { border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-top: 30px; }
    table { border-collapse: collapse; width: 100%; margin: 15px 0; }
    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
    th { background: #4a90a4; color: white; }
    tr:nth-child(even) { background: #f9f9f9; }
    code { background: #e8e8e8; padding: 2px 6px; border-radius: 3px; font-family: 'Monaco', monospace; }
    pre { background: #1a1a2e; color: #e8e8e8; padding: 15px; border-radius: 5px; overflow-x: auto; }
    pre code { background: none; }
    .summary-card { background: white; border-radius: 10px; padding: 20px; margin: 10px 0; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
    .status-passed { color: #28a745; }
    .status-failed { color: #dc3545; }
    .severity-critical { color: #dc3545; font-weight: bold; }
    .severity-high { color: #fd7e14; }
    .severity-medium { color: #ffc107; }
    .severity-low { color: #28a745; }
    hr { border: none; border-top: 1px solid #ddd; margin: 30px 0; }
    ul { padding-left: 20px; }
    li { margin: 5px 0; }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;
}

export default generateReport;
