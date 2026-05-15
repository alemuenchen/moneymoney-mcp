#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListAccounts, registerListActiveAccounts } from "./tools/list-accounts.js";
import { registerGetAccountBalance } from "./tools/get-account-balance.js";
import { registerGetTransactions } from "./tools/get-transactions.js";
import { registerSearchTransactions } from "./tools/search-transactions.js";
import { registerListCategories } from "./tools/list-categories.js";
import { registerGetCategoryTotal } from "./tools/get-category-total.js";
import { registerGetPortfolio } from "./tools/get-portfolio.js";
import { registerGetRecurring } from "./tools/get-recurring.js";
import { registerTopCounterparties } from "./tools/top-counterparties.js";
import { registerComparePeriods } from "./tools/compare-periods.js";
import { registerAddTransaction } from "./tools/add-transaction.js";
import { registerCreateTransfer } from "./tools/create-transfer.js";
import { ensureLogDir, logger } from "./lib/logger.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

await ensureLogDir();

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, "..", "package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version: string };
const VERSION = pkg.version;

const server = new McpServer({
  name: "moneymoney",
  version: VERSION,
});

// Read tools (always available)
registerListAccounts(server);
registerListActiveAccounts(server);
registerGetAccountBalance(server);
registerGetTransactions(server);
registerSearchTransactions(server);
registerListCategories(server);
registerGetCategoryTotal(server);
registerGetPortfolio(server);

// Analytics tools (read-only aggregations on top of get_transactions)
registerGetRecurring(server);
registerTopCounterparties(server);
registerComparePeriods(server);

// Write tools (gated by MONEYMONEY_ENABLE_WRITES at call time)
registerAddTransaction(server);
registerCreateTransfer(server);

const transport = new StdioServerTransport();
await server.connect(transport);

logger.info("MoneyMoney MCP server started", {
  version: VERSION,
  writesEnabled: process.env.MONEYMONEY_ENABLE_WRITES === "true",
});
