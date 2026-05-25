#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseTrackingDocTool } from "./tools/parse-tracking-doc.js";
import { findTrackingMethodsTool } from "./tools/find-tracking-methods.js";
import { checkTrackingCoverageTool } from "./tools/check-tracking-coverage.js";

const server = new McpServer({
  name: "mcp-tracking-server",
  version: "1.0.0",
});

server.tool(
  parseTrackingDocTool.name,
  parseTrackingDocTool.description,
  parseTrackingDocTool.schema,
  parseTrackingDocTool.handler
);

server.tool(
  findTrackingMethodsTool.name,
  findTrackingMethodsTool.description,
  findTrackingMethodsTool.schema,
  findTrackingMethodsTool.handler
);

server.tool(
  checkTrackingCoverageTool.name,
  checkTrackingCoverageTool.description,
  checkTrackingCoverageTool.schema,
  checkTrackingCoverageTool.handler
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP Server 启动失败:", error);
  process.exit(1);
});
