import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCategoryTotal } from "../lib/moneymoney-client.js";
import { handleToolError } from "./shared.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerGetCategoryTotal(server: McpServer): void {
  server.registerTool(
    "moneymoney_get_category_total",
    {
      title: "Get MoneyMoney Category Total",
      description:
        "Sums transactions for a category over a date range. Specify EITHER category_uuid (single category) " +
        "OR category_path_prefix (entire subtree, e.g. 'Business > Office' for the office bucket, or " +
        "'Business' for the entire business branch). Path prefix matching is segment-aware. Optionally " +
        "restrict by account_name. Default excludes closed-archive accounts. Totals are reported per " +
        "currency in totalsByCurrency; the scalar totalAmount/currency are present only when all matching " +
        "transactions share one currency. " +
        "For historical/archive analysis pass include_closed=true (past-year data often lives on now-closed " +
        "accounts, otherwise old totals are undercounted).",
      inputSchema: z
        .object({
          category_uuid: z.string().optional().describe("UUID of one specific category"),
          category_path_prefix: z
            .string()
            .optional()
            .describe("Path prefix for an entire subtree (e.g. 'Business > Office')"),
          from_date: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD").describe("Start date YYYY-MM-DD"),
          to_date: z.string().regex(ISO_DATE_RE, "must be YYYY-MM-DD").optional().describe("End date YYYY-MM-DD; defaults to today"),
          account_name: z.string().optional().describe("Restrict to one account (leaf or group)"),
          include_closed: z.boolean().optional().describe("Include closed-archive accounts. Default false."),
        })
        .refine((v) => v.category_uuid || v.category_path_prefix, {
          message: "Provide either category_uuid or category_path_prefix.",
        }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
      },
    },
    async ({ category_uuid, category_path_prefix, from_date, to_date, account_name, include_closed }) => {
      try {
        const result = await getCategoryTotal({
          categoryUuid: category_uuid,
          categoryPathPrefix: category_path_prefix,
          from: from_date,
          to: to_date,
          accountName: account_name,
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
