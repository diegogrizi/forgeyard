import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ForgeyardError } from "../core/errors.js";
import { NATIVE_TOOL_SCHEMAS } from "./protocol.js";
import { nativeError } from "./store.js";
import type { ProjectService } from "./service.js";

export const NATIVE_SERVER_INSTRUCTIONS =
  "Forgeyard is bound to this project, not an AI provider. Start with fy_context. " +
  "For an unprepared project inspect inputs, normalize intent/risk/needs, preview then apply. " +
  "For a new request create a requirement-linked fy_plan; obtain local human consent. " +
  "Use fy_next, record criteria, run every frozen gate, review, and fy_finalize. " +
  "Keep requestId stable on retry; refresh revision before mutations. Never self-approve. " +
  "Pause/reconcile uncertainty; the native client owns AI sessions.";

/** Low-level SDK API deliberately reuses the CLI's strict JSON Schemas. */
export function createNativeMcpServer(service: ProjectService): Server {
  const server = new Server({ name: "forgeyard", version: "0.1.0" }, {
    capabilities: { tools: {} }, instructions: NATIVE_SERVER_INSTRUCTIONS,
    enforceStrictCapabilities: true,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(NATIVE_TOOL_SCHEMAS).map(([name, tool]) => ({
    name, description: tool.description + " Arguments: {requestId, payload}. Preserve requestId only for identical retries.",
    inputSchema: { type: "object" as const, additionalProperties: false,
      properties: { requestId: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" },
        payload: tool.inputSchema }, required: ["requestId", "payload"] },
    annotations: { readOnlyHint: tool.readOnly, destructiveHint: !tool.readOnly, openWorldHint: false },
  })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = request.params.arguments;
      if (!args || Object.keys(args).some((key) => key !== "requestId" && key !== "payload"))
        throw nativeError("FY_PROTOCOL_INVALID", "Use exactly requestId and payload in native MCP calls.");
      if (Buffer.byteLength(JSON.stringify(args)) > 1_048_576)
        throw nativeError("FY_PROTOCOL_LIMIT", "The native request exceeds its bounded size.");
      const response = await service.execute({ protocolVersion: "0.2", requestId: args.requestId,
        tool: request.params.name, payload: args.payload });
      const serialized = JSON.stringify(response);
      if (Buffer.byteLength(serialized) > 1_048_576)
        throw nativeError("FY_PROTOCOL_LIMIT", "The native response exceeds its bounded size; narrow the inspection inputs.");
      return { content: [{ type: "text" as const, text: serialized }], structuredContent: { ...response } };
    } catch (error) {
      const failure = error instanceof ForgeyardError ? { code: error.code, message: error.message, remediation: error.remediation } :
        { code: "FY_NATIVE_FAILED", message: "The local native operation failed. No raw error or project content is disclosed." };
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ protocolVersion: "0.2", ok: false, error: failure }) }] };
    }
  });
  return server;
}

export async function serveNativeMcp(service: ProjectService, transport: Transport = new StdioServerTransport()): Promise<Server> {
  const server = createNativeMcpServer(service);
  server.onclose = () => { void service.shutdown(); };
  await server.connect(transport);
  return server;
}
