import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchTransactions } from "../lib/moneymoney-client.js";
import { handleToolError } from "./shared.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerGetTransactions(server: McpServer): void {
  server.registerTool(
    "moneymoney_get_transactions",
    {
      title: "Get MoneyMoney Transactions",
      description:
        "Exports transactions filtered by date range and optionally by account name (or account-group name — " +
        "passing a group like 'Personal' or 'Business' expands to all leaf accounts inside the group). " +
        "BY DEFAULT excludes transactions on closed-archive accounts (see moneymoney_list_accounts for the " +
        "keyword list). Pass include_closed=true to include the full history. With resolve_category=true " +
        "(default), each transaction is enriched with categoryName, categoryPath (e.g. 'Business > Office " +
        "> IT'), and categoryRoot (e.g. 'Business'), so the LLM can disambiguate categories with the same " +
        "leaf name appearing in different branches of the tree. The response is capped at `limit` " +
        "transactions (default 1000); when more match, `truncated` is true — narrow the date range or use " +
        "moneymoney_search_transactions with filters instead. " +
        "HISTORICAL/ARCHIVE ANALYSIS: pass include_closed=true — transactions from past years often live on " +
        "accounts that have since been archived/closed, which the default excludes, so omitting it can " +
        "drastically undercount older periods.",
      inputSchema: z.object({
        from_date: z
          .string()
          .regex(ISO_DATE_RE, "must be YYYY-MM-DD")
          .describe("Start date in ISO 8601 format (YYYY-MM-DD)"),
        to_date: z
          .string()
          .regex(ISO_DATE_RE, "must be YYYY-MM-DD")
          .optional()
          .describe("End date in ISO 8601 format (YYYY-MM-DD). Defaults to today."),
        account_name: z
          .string()
          .optional()
          .describe("Filter by account name. May be a leaf account or a group; group names expand to all leaf accounts inside."),
        include_closed: z
          .boolean()
          .optional()
          .describe("Include transactions on closed-archive accounts. Default false."),
        resolve_category: z
          .boolean()
          .optional()
          .describe("Enrich each transaction with categoryName/categoryPath/categoryRoot. Default true."),
        limit: z
          .number()
          .int()
          .positive()
          .max(10000)
          .optional()
          .describe("Maximum transactions to return (default 1000, max 10000). The response sets truncated=true if more matched."),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ from_date, to_date, account_name, include_closed, resolve_category, limit }) => {
      try {
        const all = await fetchTransactions({
          from: from_date,
          to: to_date,
          accountName: account_name,
          includeClosed: include_closed ?? false,
          resolveCategory: resolve_category ?? true,
        });
        const effectiveLimit = limit ?? 1000;
        const transactions = all.slice(0, effectiveLimit);
        const truncated = all.length > transactions.length;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  count: transactions.length,
                  total_matched: all.length,
                  truncated,
                  limit: effectiveLimit,
                  transactions,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    },
  );
}
