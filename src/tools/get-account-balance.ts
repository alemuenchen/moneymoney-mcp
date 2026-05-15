import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAccountBalance } from "../lib/moneymoney-client.js";
import { handleToolError } from "./shared.js";

export function registerGetAccountBalance(server: McpServer): void {
  server.registerTool(
    "moneymoney_get_account_balance",
    {
      title: "Get MoneyMoney Account Balance",
      description:
        "Returns the balance of a single account by name. Lighter than list_accounts when the caller already knows which account to query.",
      inputSchema: z.object({
        account_name: z.string().describe("Exact name of the account"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ account_name }) => {
      try {
        const result = await getAccountBalance(account_name);
        if (!result) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error_type: "not_found",
                  error: `Account "${account_name}" not found.`,
                  hint: "Use moneymoney_list_accounts to see available account names.",
                }),
              },
            ],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return handleToolError(err);
      }
    },
  );
}
