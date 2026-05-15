import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchPortfolio } from "../lib/moneymoney-client.js";
import { handleToolError } from "./shared.js";

export function registerGetPortfolio(server: McpServer): void {
  server.registerTool(
    "moneymoney_get_portfolio",
    {
      title: "Get MoneyMoney Portfolio",
      description:
        "Returns the securities portfolio from MoneyMoney with quantity, price, and market value for each position.",
      inputSchema: z.object({
        account_name: z
          .string()
          .optional()
          .describe("Filter portfolio by account name. If omitted, returns all positions."),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ account_name }) => {
      try {
        const portfolio = await fetchPortfolio(account_name);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(portfolio, null, 2) }],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
