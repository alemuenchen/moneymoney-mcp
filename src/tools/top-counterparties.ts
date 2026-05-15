import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTopCounterparties } from "../lib/analytics.js";
import { handleToolError } from "./shared.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerTopCounterparties(server: McpServer): void {
  server.registerTool(
    "moneymoney_top_counterparties",
    {
      title: "Top MoneyMoney Counterparties by Amount",
      description:
        "Ranks counterparties by absolute total amount in a date range. Returns top N (default 10, max 100) " +
        "with count, total, average, first/last seen. Filter by direction ('expenses'/'income'/'all') and " +
        "optionally by account_name (leaf or group), category_path_prefix (e.g. 'Business' for business only). " +
        "By default excludes closed-archive accounts. " +
        "A counterparty paid in more than one currency is returned as separate rows (one per currency) " +
        "so totals are never summed across currencies.",
      inputSchema: z.object({
        from_date: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD").describe("Start date YYYY-MM-DD"),
        to_date: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD").optional().describe("End date YYYY-MM-DD; defaults to today"),
        account_name: z.string().optional().describe("Restrict to one account (leaf or group)"),
        limit: z.number().int().positive().max(100).optional().describe("Top N (default 10, max 100)"),
        direction: z.enum(["expenses", "income", "all"]).optional().describe("Sign filter; default 'all'"),
        category_path_prefix: z
          .string()
          .optional()
          .describe("Restrict to one branch of the category tree (segment-aware, e.g. 'Business')"),
        include_closed: z.boolean().optional().describe("Include closed-archive accounts. Default false."),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ from_date, to_date, account_name, limit, direction, category_path_prefix, include_closed }) => {
      try {
        const top = await getTopCounterparties({
          from: from_date,
          to: to_date,
          accountName: account_name,
          limit,
          direction,
          categoryPathPrefix: category_path_prefix,
          includeClosed: include_closed ?? false,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ count: top.length, counterparties: top }, null, 2),
            },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    },
  );
}
