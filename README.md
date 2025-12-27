# Test Genie MCP

AI-powered App Test Automation MCP Server

앱 테스트 자동화를 위한 MCP 서버입니다. 시나리오 생성부터 테스트 실행, 문제 검출, 수정 제안 및 적용까지 전체 테스트 파이프라인을 자동화합니다.

## Features

### Phase 1: Analysis & Scenario Generation
- **analyze_app_structure**: 앱 코드베이스 분석 (화면, 컴포넌트, API, 상태관리)
- **generate_scenarios**: AI 기반 테스트 시나리오 자동 생성
- **create_test_plan**: 테스트 계획 수립 및 스케줄링

### Phase 2: Test Execution
- **run_scenario_test**: 개별 시나리오 테스트 실행
- **run_simulation**: 사용자 행동 시뮬레이션 (랜덤/패턴 기반)
- **run_stress_test**: 스트레스/부하 테스트

### Phase 3: Issue Detection
- **detect_memory_leaks**: 메모리 릭 감지 (힙 분석, 순환 참조)
- **detect_logic_errors**: 논리적 오류 검출 (레이스 컨디션, 상태 불일치)

### Phase 4: Fix Suggestions & Application
- **suggest_fixes**: AI 기반 수정 방안 제안
- **confirm_fix**: 수정 사항 사용자 확인
- **apply_fix**: 확인된 수정 사항 적용
- **rollback_fix**: 적용된 수정 롤백

### Phase 5: Full Automation
- **run_full_automation**: 전체 파이프라인 자동 실행
- **generate_report**: 상세 보고서 생성 (Markdown, HTML, JSON)

### Enhanced Analysis (v2.0)
- **analyze_performance**: 성능 심층 분석 (렌더링, 연산, 네트워크, 번들)
- **analyze_code_deep**: AST 기반 코드 분석 (복잡도, 훅, 의존성)
- **generate_cicd_config**: CI/CD 설정 자동 생성 (GitHub Actions, Jenkins, GitLab CI)

## Supported Platforms

| Platform | Language | Test Framework |
|----------|----------|----------------|
| iOS | Swift, Objective-C | XCTest, XCUITest |
| Android | Kotlin, Java | Espresso, UI Automator |
| Flutter | Dart | flutter_test |
| React Native | TypeScript, JavaScript | Detox, Jest |
| Web | TypeScript, JavaScript | Playwright, Puppeteer |

## Installation

```bash
npm install -g test-genie-mcp
```

Or install from source:

```bash
git clone https://github.com/MUSE-CODE-SPACE/test-genie-mcp.git
cd test-genie-mcp
npm install
npm run build
```

## Usage with Claude Desktop

Add to your Claude Desktop config (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "test-genie": {
      "command": "npx",
      "args": ["test-genie-mcp"]
    }
  }
}
```

## Example Usage

### Full Automation
```
User: "자동화 테스트해줘"

Claude will:
1. Analyze your app structure
2. Generate test scenarios
3. Execute tests
4. Detect issues (memory leaks, logic errors)
5. Suggest fixes
6. Wait for your confirmation
7. Apply approved fixes
8. Generate report
```

### Step-by-Step

```
# Analyze app
analyze_app_structure(projectPath: "/path/to/app")

# Generate scenarios
generate_scenarios(projectPath: "/path/to/app", testTypes: ["e2e", "unit"])

# Detect memory leaks
detect_memory_leaks(projectPath: "/path/to/app")

# Get fix suggestions
suggest_fixes(projectPath: "/path/to/app")

# Confirm and apply fix
confirm_fix(fixId: "xxx", action: "approve")
apply_fix(fixId: "xxx")
```

## Fix Confirmation Workflow

When issues are detected, Test Genie will:

1. **Suggest Fixes**: Generate AI-powered fix suggestions with confidence scores
2. **Show Diff**: Display exactly what will change
3. **Await Confirmation**: Wait for user approval
4. **Apply Fix**: Only apply after explicit approval
5. **Backup**: Automatically create backups before applying

Example confirmation prompt:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 Fix Suggestion #abc123
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 File: src/screens/HomeScreen.tsx:45
📝 Title: Fix: useEffect missing cleanup
🎯 Confidence: 90%

📄 Current Code:
┌──────────────────────────────────────────
│ useEffect(() => {
│   const subscription = api.subscribe();
│ }, []);
└──────────────────────────────────────────

✨ Suggested Fix:
┌──────────────────────────────────────────
│ useEffect(() => {
│   const subscription = api.subscribe();
│   return () => subscription.unsubscribe();
│ }, []);
└──────────────────────────────────────────

Actions: [✅ Approve]  [❌ Reject]  [✏️ Modify]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Tools Reference

| Tool | Description |
|------|-------------|
| `analyze_app_structure` | Analyze codebase structure |
| `generate_scenarios` | Generate test scenarios |
| `create_test_plan` | Create test plan |
| `run_scenario_test` | Run single scenario |
| `run_simulation` | Run user simulation |
| `run_stress_test` | Run stress test |
| `detect_memory_leaks` | Detect memory leaks |
| `detect_logic_errors` | Detect logic errors |
| `suggest_fixes` | Generate fix suggestions |
| `confirm_fix` | Confirm/reject fix |
| `apply_fix` | Apply confirmed fix |
| `rollback_fix` | Rollback applied fix |
| `run_full_automation` | Run full automation pipeline |
| `generate_report` | Generate test report |
| `get_pending_fixes` | Get pending confirmations |
| `get_test_history` | Get test history |
| `analyze_performance` | Deep performance analysis |
| `analyze_code_deep` | AST-based code analysis |
| `generate_cicd_config` | Generate CI/CD configuration |

## Platform-Specific Features

### iOS
- XCTest, XCUITest integration
- Instruments profiling (Time Profiler, Allocations, Leaks)
- Simulator management
- Screenshot & video recording

### Android
- Gradle test integration
- Espresso, UI Automator support
- Android Profiler (CPU, Memory, Network)
- LeakCanary integration
- ADB device management

### Flutter
- flutter_test, integration_test
- Golden tests (snapshot testing)
- Performance profiling
- Memory analysis

### React Native
- Jest, React Native Testing Library
- Detox E2E testing
- Performance monitoring
- Memory leak detection

### Web
- Playwright, Cypress support
- Lighthouse performance audits
- Accessibility testing (axe-core)
- Visual regression testing
- Load testing (K6 integration)

## License

MIT

## Author

Yoonkyoung Gong
