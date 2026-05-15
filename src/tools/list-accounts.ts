import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listAccounts } from "../lib/moneymoney-client.js";
import { handleToolError } from "./shared.js";

export function registerListAccounts(server: McpServer): void {
  server.registerTool(
    "moneymoney_list_accounts",
    {
      title: "List MoneyMoney Accounts",
      description:
        "Returns accounts from MoneyMoney with name, number, bank, balance, currency, type, and hierarchy info " +
        "(parentGroupName, parentPath, isClosed). " +
        "BY DEFAULT closed-archive accounts are EXCLUDED — these are accounts whose ancestor group name matches " +
        "one of the closed-account keywords (default: 'closed', 'archived', 'archive', 'geschlossen', 'archiv', " +
        "'inaktiv', 'chiuso', 'inattivo' and inflections; configurable via env MONEYMONEY_CLOSED_KEYWORDS). " +
        "They retain historical transactions but are not operational. Set include_closed=true to include them; " +
        "or use moneymoney_list_active_accounts as a clearer shortcut for the default.",
      inputSchema: z.object({
        include_closed: z
          .boolean()
          .optional()
          .describe(
            "If true, include accounts archived under groups flagged as closed (default false).",
          ),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ include_closed }) => {
      try {
        const accounts = await listAccounts({ includeClosed: include_closed ?? false });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(accounts, null, 2) }],
        };
      } catch (err) {
        return handleToolError(err);
      }
    },
  );
}

export function registerListActiveAccounts(server: McpServer): void {
  server.registerTool(
    "moneymoney_list_active_accounts",
    {
      title: "List Active MoneyMoney Accounts",
      description:
        "Convenience shortcut for moneymoney_list_accounts with include_closed=false (the default). " +
        "Returns only operational accounts — those NOT archived under a group flagged as closed (see " +
        "moneymoney_list_accounts for the keyword list and the MONEYMONEY_CLOSED_KEYWORDS env override). " +
        "Recommended starting point for any query about current balances or new transactions. To inspect " +
        "historical archive accounts, call moneymoney_list_accounts with include_closed=true.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async () => {
      try {
        const accounts = await listAccounts({ includeClosed: false });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(accounts, null, 2) }],
        };
      } catch (err) {
        return handleToolError(err);
      }
    },
  );
}
