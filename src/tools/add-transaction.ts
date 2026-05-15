import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTransaction } from "../lib/moneymoney-client.js";
import { checkWritesEnabled, handleToolError } from "./shared.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerAddTransaction(server: McpServer): void {
  server.registerTool(
    "moneymoney_add_transaction",
    {
      title: "Add MoneyMoney Transaction",
      description:
        "Adds a transaction to an OFFLINE account in MoneyMoney (manual / cash / portfolio / clearing accounts). " +
        "Online banking accounts cannot accept manual transactions and the call will be rejected. " +
        "Requires MONEYMONEY_ENABLE_WRITES=true.",
      inputSchema: z.object({
        account_name: z.string().min(1).describe("Exact name of the offline account"),
        amount: z
          .number()
          .finite()
          .refine((n) => n !== 0, "amount must be non-zero")
          .describe("Transaction amount (positive=income, negative=expense). Must be non-zero."),
        purpose: z.string().describe("Transaction purpose/description"),
        name: z.string().min(1).describe("Beneficiary or payer name"),
        booking_date: z
          .string()
          .regex(ISO_DATE_RE, "must be YYYY-MM-DD")
          .optional()
          .describe("Booking date in ISO 8601 format (YYYY-MM-DD). Defaults to today."),
        category_id: z
          .string()
          .optional()
          .describe(
            "Category UUID. The MoneyMoney scripting API accepts the UUID returned by " +
              "moneymoney_list_categories. If supplied but unrecognized, the transaction is " +
              "still created but a warning is returned and the category is not applied.",
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ account_name, amount, purpose, name, booking_date, category_id }) => {
      const writeCheck = checkWritesEnabled();
      if (writeCheck) return writeCheck;

      try {
        const result = await createTransaction({
          accountName: account_name,
          amount,
          purpose,
          name,
          bookingDate: booking_date,
          categoryId: category_id,
        });
        const payload: Record<string, unknown> = {
          success: true,
          message: `Transaction added to account "${account_name}": ${amount} for "${name}"`,
          category_applied: result.categoryApplied,
        };
        if (result.warning) payload.warning = result.warning;
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(payload) },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    },
  );
}
