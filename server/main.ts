// deno-lint-ignore-file require-await
import { withRuntime } from "@deco/workers-runtime";
import { toolFactories } from "./tools";
import {
  createStepFromTool,
  createTool,
  createWorkflow,
} from "@deco/workers-runtime/mastra";
import { z } from "zod";
import type { Env as DecoEnv } from "./deco.gen.ts";

interface Env extends DecoEnv {
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
}

const createMyTool = (_env: Env) =>
  createTool({
    id: "MY_TOOL",
    description: "Say hello",
    inputSchema: z.object({ name: z.string() }),
    outputSchema: z.object({ message: z.string() }),
    execute: async ({ context }) => ({
      message: `Hello, ${context.name}!`,
    }),
  });

const createMyWorkflow = (env: Env) => {
  const step = createStepFromTool(createMyTool(env));

  return createWorkflow({
    id: "MY_WORKFLOW",
    inputSchema: z.object({ name: z.string() }),
    outputSchema: z.object({ message: z.string() }),
  })
    .then(step)
    .commit();
};

const fallbackToView = (viewPath: string = "/") => (req: Request, env: Env) => {
  const LOCAL_URL = "http://localhost:4000";
  const url = new URL(req.url);
  const useDevServer = (req.headers.get("origin") || req.headers.get("host"))
    ?.includes("localhost");

  const request = new Request(
    useDevServer
      ? new URL(`${url.pathname}${url.search}`, LOCAL_URL)
      : new URL(viewPath, req.url),
    req,
  );

  return useDevServer ? fetch(request) : env.ASSETS.fetch(request);
};

const { Workflow, ...baseRuntime } = withRuntime<Env>({
  workflows: [createMyWorkflow],
  tools: [createMyTool, ...toolFactories],
  fetch: fallbackToView("/"),
});

export { Workflow };

// Expose MCP tools list for self type generation
import { zodToJsonSchema } from "zod-to-json-schema";

const TOOLS_PATH = "/mcp/tools";

async function listTools(env: Env) {
  const factories = [createMyTool, ...toolFactories];
  return factories.map((f) => {
    const tool = f(env as any);
    const inputSchema = tool.inputSchema && "_def" in tool.inputSchema
      ? zodToJsonSchema(tool.inputSchema as z.ZodTypeAny)
      : { type: "object", properties: {} };
    const outputSchema = tool.outputSchema && "_def" in tool.outputSchema
      ? zodToJsonSchema(tool.outputSchema as z.ZodTypeAny)
      : { type: "object", properties: {} };
    return {
      name: tool.id,
      description: tool.description,
      inputSchema,
      outputSchema,
    };
  });
}

const runtime = {
  ...baseRuntime,
  fetch: (req: Request, env: Env, ctx: any) => {
    const url = new URL(req.url);
    if (url.pathname === TOOLS_PATH) {
      return (async () => {
        try {
          const tools = await listTools(env);
          return new Response(JSON.stringify({ tools }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
            return new Response(
              JSON.stringify({ error: (err as Error).message }),
              { status: 500, headers: { "content-type": "application/json" } },
            );
        }
      })();
    }
    return (baseRuntime as any).fetch(req, env, ctx);
  },
};

export default runtime;
