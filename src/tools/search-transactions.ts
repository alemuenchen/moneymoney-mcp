import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchTransactions } from "../lib/moneymoney-client.js";
import { handleToolError } from "./shared.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerSearchTransactions(server: McpServer): void {
  server.registerTool(
    "moneymoney_search_transactions",
    {
      title: "Search MoneyMoney Transactions",
      description:
        "Searches transactions by date range with optional filters: counterparty name (substring), purpose " +
        "(substring), amount range, exact category UUID, OR category path prefix (segment-aware: 'Business' " +
        "matches every category whose path begins with 'Business > ...'). Useful to separate business expenses " +
        "(category_path_prefix='Business') from personal ones (category_path_prefix='Personal') without " +
        "enumerating every UUID. By default excludes closed-archive accounts (include_closed=false). With " +
        "resolve_category=true (default), each result includes categoryName/categoryPath/categoryRoot.",
      inputSchema: z.object({
        from_date: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD").describe("Start date YYYY-MM-DD"),
        to_date: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD").optional().describe("End date YYYY-MM-DD; defaults to today"),
        account_name: z.string().optional().describe("Filter by account name (leaf or group)"),
        name_contains: z.string().optional().describe("Case-insensitive substring on counterparty name"),
        purpose_contains: z.string().optional().describe("Case-insensitive substring on transaction purpose"),
        min_amount: z.number().optional().describe("Inclusive minimum signed amount"),
        max_amount: z.number().optional().describe("Inclusive maximum signed amount"),
        category_uuid: z.string().optional().describe("Exact category UUID"),
        category_path_prefix: z
          .string()
          .optional()
          .describe(
            "Category path prefix (segment-aware, e.g. 'Business' or 'Travel > Flights'). " +
              "Use list_categories to see paths. Mutually compatible with category_uuid (both apply).",
          ),
        include_closed: z.boolean().optional().describe("Include closed-archive accounts. Default false."),
        resolve_category: z.boolean().optional().describe("Enrich each tx with categoryName/Path/Root. Default true."),
        limit: z.number().int().positive().max(5000).optional().describe("Max results (default 500, max 5000)"),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async (args) => {
      try {
        const transactions = await searchTransactions({
          from: args.from_date,
          to: args.to_date,
          accountName: args.account_name,
          nameContains: args.name_contains,
          purposeContains: args.purpose_contains,
          minAmount: args.min_amount,
          maxAmount: args.max_amount,
          categoryUuid: args.category_uuid,
          categoryPathPrefix: args.category_path_prefix,
          includeClosed: args.include_closed ?? false,
          resolveCategory: args.resolve_category ?? true,
          limit: args.limit,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { count: transactions.length, transactions },
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
