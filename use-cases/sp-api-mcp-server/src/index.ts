#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { logger } from "./utils/logger.js";
import { CatalogLoader } from "./catalog/catalog-loader.js";
import { ExecuteApiTool } from "./tools/execute-api-tool.js";
import { ExploreCatalogTool, exploreCatalogSchema } from "./tools/explore-catalog-tool.js";
import { createAuthenticatorFromEnv } from "./auth/sp-api-auth.js";
import * as dotenv from 'dotenv';
import { z } from 'zod';
import http from 'http';

dotenv.config();

async function createServer() {
  const server = new McpServer({
    name: "amazon-sp-api",
    version: "0.1.0"
  });

  const catalogLoader = new CatalogLoader();
  const catalog = await catalogLoader.loadCatalog();
  const authenticator = createAuthenticatorFromEnv();
  const executeTool = new ExecuteApiTool(catalog, authenticator);
  const exploreTool = new ExploreCatalogTool(catalog);

  server.tool(
    "execute-sp-api",
    "Execute Amazon Selling Partner API requests with specified endpoint and parameters",
    {
      endpoint: z.string().describe("The specific SP-API endpoint to use (required)"),
      parameters: z.record(z.any()).describe("Complete set of API parameters"),
      method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional().describe("HTTP method"),
      additionalHeaders: z.record(z.string()).optional().describe("Additional request headers"),
      rawMode: z.boolean().optional().default(false).describe("Return raw response if true"),
      generateCode: z.boolean().optional().default(false).describe("Generate code snippet if true"),
      region: z.string().optional().default("us-east-1").describe("AWS region for the request")
    },
    async (params) => {
      const result = await executeTool.execute(params);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "explore-sp-api-catalog",
    "Get information about SP-API endpoints and parameters",
    exploreCatalogSchema.shape,
    async (params) => {
      const result = await exploreTool.execute(params);
      return { content: [{ type: "text", text: result }] };
    }
  );

  return server;
}

async function main() {
  try {
    logger.info('Starting Amazon SP-API MCP Server...');

    const isHttp = process.env.MCP_TRANSPORT === 'http' || process.env.PORT;

    if (isHttp) {
      // Remote HTTP mode for Railway / cloud deployment
      const port = parseInt(process.env.PORT || '8080', 10);

      const httpServer = http.createServer(async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          });
          res.end();
          return;
        }

        if (req.url === '/health') {
          res.writeHead(200);
          res.end('OK');
          return;
        }

        const server = await createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless
        });

        res.on('close', () => transport.close());
        await server.connect(transport);
        await transport.handleRequest(req, res);
      });

      httpServer.listen(port, () => {
        logger.info(`Amazon SP-API MCP Server running on HTTP port ${port}`);
      });

    } else {
      // Local stdio mode
      const server = await createServer();
      const transport = new StdioServerTransport();
      await server.connect(transport);
      logger.info('Amazon SP-API MCP Server running on stdio');
    }

  } catch (error) {
    logger.error('Fatal error in main():', error);
    process.exit(1);
  }
}

main();
