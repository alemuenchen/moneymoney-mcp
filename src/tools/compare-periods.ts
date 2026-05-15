import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { comparePeriods } from "../lib/analytics.js";
import { handleToolError } from "./shared.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerComparePeriods(server: McpServer): void {
  server.registerTool(
    "moneymoney_compare_periods",
    {
      title: "Compare MoneyMoney Periods",
      description:
        "Compares two date ranges side by side, grouped by category or counterparty name. Each row reports " +
        "totalA, totalB, delta, deltaPct, sorted by absolute delta. With group_by='category' the labels are " +
        "the human category PATH (e.g. 'Business > Office > IT'), not raw UUIDs — " +
        "no need to cross-reference list_categories. Optionally filter by account_name and " +
        "category_path_prefix (e.g. 'Business' to compare only business spend). Default excludes " +
        "closed-archive accounts. Aggregate totals are reported per currency in summaryByCurrency.",
      inputSchema: z.object({
        period_a_from: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD").describe("Start of period A"),
        period_a_to: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD").optional().describe("End of period A; default today"),
        period_b_from: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD").describe("Start of period B"),
        period_b_to: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD").optional().describe("End of period B; default today"),
        account_name: z.string().optional().describe("Restrict to one account (leaf or group)"),
        group_by: z.enum(["category", "counterparty"]).optional().describe("Default 'category'"),
        category_path_prefix: z.string().optional().describe("Restrict to a category subtree"),
        include_closed: z.boolean().optional().describe("Include closed-archive accounts. Default false."),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ period_a_from, period_a_to, period_b_from, period_b_to, account_name, group_by, category_path_prefix, include_closed }) => {
      try {
        const result = await comparePeriods({
          periodA: { from: period_a_from, to: period_a_to },
          periodB: { from: period_b_from, to: period_b_to },
          accountName: account_name,
          groupBy: group_by,
          categoryPathPrefix: category_path_prefix,
          includeClosed: include_closed ?? false,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return handleToolError(err);
      }
    },
  );
}
