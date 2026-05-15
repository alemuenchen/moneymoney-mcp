import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getRecurringTransactions } from "../lib/analytics.js";
import { handleToolError } from "./shared.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerGetRecurring(server: McpServer): void {
  server.registerTool(
    "moneymoney_get_recurring",
    {
      title: "Identify Recurring MoneyMoney Transactions",
      description:
        "Identifies recurring transactions (subscriptions, salaries, rent) by clustering on counterparty name " +
        "and similar amounts (±5% tolerance). Returns each pattern with cadence (weekly/biweekly/monthly/" +
        "quarterly/yearly/irregular), count, total, date range. Patterns with fewer than min_occurrences " +
        "(default 2) hits are excluded. Optionally filter by account_name (leaf or group) and " +
        "category_path_prefix (e.g. 'Personal' for personal subscriptions only). By default excludes " +
        "closed-archive accounts.",
      inputSchema: z.object({
        from_date: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD").describe("Start date YYYY-MM-DD"),
        to_date: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD").optional().describe("End date YYYY-MM-DD; defaults to today"),
        account_name: z.string().optional().describe("Restrict to one account (leaf or group)"),
        min_occurrences: z.number().int().positive().optional().describe("Min hits for a pattern. Default 2."),
        category_path_prefix: z.string().optional().describe("Restrict to a category subtree"),
        include_closed: z.boolean().optional().describe("Include closed-archive accounts. Default false."),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ from_date, to_date, account_name, min_occurrences, category_path_prefix, include_closed }) => {
      try {
        const recurring = await getRecurringTransactions({
          from: from_date,
          to: to_date,
          accountName: account_name,
          minOccurrences: min_occurrences,
          categoryPathPrefix: category_path_prefix,
          includeClosed: include_closed ?? false,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ count: recurring.length, recurring }, null, 2),
            },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    },
  );
}
