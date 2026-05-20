/**
 * McpServer factory — wires up the 20 tools from `toolRegistry`, plus the
 * resource set and prompt set, on a single `McpServer` instance.
 *
 * v3.0.0 migrates from the legacy low-level `Server` + manual request-handler
 * pattern to the SDK's high-level `McpServer.registerTool` /
 * `.resource` / `.prompt` API. This eliminates the 700-line `switch` in
 * v2.x's `src/index.ts` and makes the tool surface declarative.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import { TOOL_REGISTRY, getToolNames } from './toolRegistry.js';
import { ToolError } from '../security.js';
import {
  STATIC_RESOURCE_DESCRIPTORS,
  readIterationLogsIndex,
  readTestHistory,
  readIterationLog,
  readAppliedFixes,
} from './resources.js';
import { PROMPT_DESCRIPTORS, findPrompt } from './prompts.js';
import { z } from 'zod';

export const SERVER_NAME = 'test-genie-mcp';
export const SERVER_VERSION = '3.0.0';

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

function registerTools(server: McpServer): void {
  for (const tool of TOOL_REGISTRY) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputShape,
      },
      async (args: unknown) => {
        try {
          const result = await tool.handler(args);
          return {
            content: [{ type: 'text' as const, text: result.text }],
            isError: result.isError,
          };
        } catch (error) {
          if (error instanceof ToolError) {
            return {
              content: [{ type: 'text' as const, text: `Error [${error.code}]: ${error.message}` }],
              isError: true,
            };
          }
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }
}

function registerResources(server: McpServer): void {
  // Static: iteration-logs index.
  server.resource(
    'iteration-logs-index',
    'test-genie://iteration-logs',
    {
      description: STATIC_RESOURCE_DESCRIPTORS[0]!.description,
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [readIterationLogsIndex(uri.toString())],
    }),
  );

  // Templated: test-history/{projectPath}
  server.resource(
    'test-history',
    new ResourceTemplate('test-genie://test-history/{projectPath}', {
      list: undefined,
    }),
    {
      description: 'Last 100 test executions for the given project (projectPath URL-encoded).',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const projectPath = Array.isArray(variables.projectPath) ? variables.projectPath[0] : variables.projectPath;
      return { contents: [readTestHistory(uri.toString(), projectPath ?? '')] };
    },
  );

  // Templated: iteration-logs/{loopId}
  server.resource(
    'iteration-log',
    new ResourceTemplate('test-genie://iteration-logs/{loopId}', {
      list: undefined,
    }),
    {
      description: 'Full iterate-fix-loop log: per-iteration state, applied fixes, rollback reasons.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const loopId = Array.isArray(variables.loopId) ? variables.loopId[0] : variables.loopId;
      return { contents: [readIterationLog(uri.toString(), loopId ?? '')] };
    },
  );

  // Templated: applied-fixes/{projectPath}
  server.resource(
    'applied-fixes',
    new ResourceTemplate('test-genie://applied-fixes/{projectPath}', {
      list: undefined,
    }),
    {
      description: 'All applied fixes for the project, with backup paths and success flags.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const projectPath = Array.isArray(variables.projectPath) ? variables.projectPath[0] : variables.projectPath;
      return { contents: [readAppliedFixes(uri.toString(), projectPath ?? '')] };
    },
  );
}

function registerPrompts(server: McpServer): void {
  for (const descriptor of PROMPT_DESCRIPTORS) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const arg of descriptor.arguments) {
      const base = z.string().describe(arg.description);
      shape[arg.name] = arg.required ? base : base.optional();
    }

    server.prompt(descriptor.name, descriptor.description, shape, (args) => {
      const prompt = findPrompt(descriptor.name);
      if (!prompt) {
        throw new ToolError(`Prompt not found: ${descriptor.name}`, 'NOT_FOUND');
      }
      const result = prompt.build(args as Record<string, string | undefined>);
      return {
        description: result.description,
        messages: result.messages,
      };
    });
  }
}

export function getCapabilityCounts() {
  return {
    tools: TOOL_REGISTRY.length,
    // 1 static + 3 templated.
    resources: STATIC_RESOURCE_DESCRIPTORS.length + 3,
    prompts: PROMPT_DESCRIPTORS.length,
    toolNames: getToolNames(),
  };
}
