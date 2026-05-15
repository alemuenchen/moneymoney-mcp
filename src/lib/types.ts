// Serializable types for MCP tool responses (no Buffer, no Date objects)

export interface AccountResponse {
  name: string;
  accountNumber: string;
  bankCode: string;
  balance: { amount: number; currency: string }[];
  currency: string;
  type: string;
  owner: string;
  portfolio: boolean;
  group: boolean;
  uuid: string;
  /** Indentation level in MoneyMoney's account hierarchy (0 = root). */
  indentation: number;
  /** Name of the immediate parent group, or null if top-level. */
  parentGroupName: string | null;
  /** Full chain of group names from root down to (but not including) this
   *  account. Null if top-level. Useful to build a UI breadcrumb. */
  parentPath: string | null;
  /** Heuristic: true if any ancestor group name matches one of the closed-
   *  account keywords (default: "closed", "archived", "archive",
   *  "geschlossen", "archiv", "inaktiv", "chiuso", "inattivo" and inflections;
   *  configurable via env MONEYMONEY_CLOSED_KEYWORDS). These accounts hold
   *  historical transactions but are no longer operational; tools default to
   *  excluding them via include_closed=false. */
  isClosed: boolean;
}

export interface TransactionResponse {
  id: number;
  bookingDate: string; // ISO 8601
  valueDate: string;   // ISO 8601
  name: string;
  purpose?: string;
  amount: number;
  currency: string;
  booked: boolean;
  checkmark: boolean;
  comment?: string;
  bookingText?: string;
  accountUuid: string;
  categoryUuid: string;
  /** Optional category enrichment populated when resolve_category=true. */
  categoryName?: string;
  /** Full category path, e.g. "Business > Office > IT". */
  categoryPath?: string;
  /** Top-level category root name, e.g. "Business" or "Personal". */
  categoryRoot?: string;
}

export interface CategoryResponse {
  name: string;
  uuid: string;
  currency: string;
  group: boolean;
  indentation: number;
  default: boolean;
  budget?: {
    amount: number;
    available: number;
    period: string;
  };
  /** UUID of the immediate parent category. Null for top-level. */
  parentUuid: string | null;
  /** Full path from root to this category, separated by " > ".
   *  Resolves the duplicate-name problem common in larger MoneyMoney
   *  libraries: the same category name can appear in different branches
   *  with different UUIDs and different paths. */
  path: string;
  /** Top-level ancestor name. */
  rootName: string;
}

export interface SecurityResponse {
  name: string;
  isin: string;
  securityNumber: string;
  type: string;
  assetClass: string;
  market: string;
  quantity: number;
  price: number;
  currencyOfPrice: string;
  amount: number;
  currencyOfAmount: string;
  purchasePrice: number;
  currencyOfPurchasePrice: string;
  absoluteProfit: number;
  relativeProfit: number;
  currencyOfProfit: string;
  tradeTimestamp: string;
}

export interface PortfolioResponse {
  accountName?: string;
  securities: SecurityResponse[];
}
