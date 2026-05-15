import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listCategories } from "../lib/moneymoney-client.js";
import { handleToolError } from "./shared.js";

export function registerListCategories(server: McpServer): void {
  server.registerTool(
    "moneymoney_list_categories",
    {
      title: "List MoneyMoney Categories",
      description:
        "Returns all categories from MoneyMoney with names, UUIDs, and optional budget information.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async () => {
      try {
        const categories = await listCategories();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(categories, null, 2) }],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
