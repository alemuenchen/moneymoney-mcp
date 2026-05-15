import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { initiateBankTransfer } from "../lib/moneymoney-client.js";
import { checkWritesEnabled, handleToolError } from "./shared.js";

export function registerCreateTransfer(server: McpServer): void {
  server.registerTool(
    "moneymoney_create_transfer",
    {
      title: "Create MoneyMoney Bank Transfer",
      description:
        "Opens a pre-filled SEPA bank transfer form in MoneyMoney (does NOT send it directly — the user must confirm in the MoneyMoney UI). Amount currency is the source account's currency (typically EUR for SEPA). Requires MONEYMONEY_ENABLE_WRITES=true.",
      inputSchema: z.object({
        from_account: z.string().min(1).describe("Source account IBAN, UUID, or exact name"),
        to_name: z.string().min(1).describe("Recipient name"),
        to_iban: z
          .string()
          .regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, "must be a valid IBAN (uppercase, no spaces)")
          .describe("Recipient IBAN (uppercase, no spaces, 15-34 chars)"),
        amount: z
          .number()
          .finite()
          .positive()
          .describe("Transfer amount (positive, in source-account currency)"),
        purpose: z.string().min(1).describe("Transfer purpose/description"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ from_account, to_name, to_iban, amount, purpose }) => {
      const writeCheck = checkWritesEnabled();
      if (writeCheck) return writeCheck;

      try {
        await initiateBankTransfer({
          fromAccount: from_account,
          toName: to_name,
          toIban: to_iban,
          amount,
          purpose,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: `Bank transfer form opened in MoneyMoney: ${amount} to "${to_name}" (${to_iban}). Confirm in the MoneyMoney UI to send.`,
              }),
            },
          ],
        };
      } catch (err) {
        return handleToolError(err);
      }
    }
  );
}
