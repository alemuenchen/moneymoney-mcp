// Hierarchy reconstruction for accounts and categories.
//
// MoneyMoney's AppleScript dictionary returns a flat list of accounts (or
// categories) with a numeric `indentation` field; the parent of an item at
// indent N is the most recent preceding item at indent N-1. This module
// rebuilds the tree from that representation and derives:
//
//   - parentUuid:   the immediate parent's UUID (null for top-level items)
//   - path:         the full chain of names (e.g. "Business > Office > IT")
//   - rootName:     the top-level ancestor's name (e.g. "Business")
//   - parentGroupName: only for accounts — the immediate parent group name
//   - parentPath:   only for accounts — the chain of groups (excluding leaf)
//   - isClosed:     only for accounts — heuristic from the parent group name(s)
//
// Both account and category trees are cached in memory with a short TTL
// (60s by default) so that consecutive tools don't re-build them on every
// call. Cache invalidation: external code that knows the upstream library
// state changed should call `invalidateHierarchyCache()`.

import type { Account, Category } from "moneymoney";

const HIERARCHY_TTL_MS = 60_000;

// Heuristic: account groups whose name matches one of these keywords are
// treated as "archived" and their accounts are flagged isClosed=true. Default
// covers the most common DE/EN/IT terms; configurable via the env var
// MONEYMONEY_CLOSED_KEYWORDS (comma-separated). Matching is case-insensitive
// and word-bounded ("Archive" matches, "Architecture" does not).
const DEFAULT_CLOSED_KEYWORDS = [
  "closed",
  "archived",
  "archive",
  "geschlossen",
  "archiv",
  "archiviert",
  "inaktiv",
  "chiuso",
  "chiusi",
  "chiusa",
  "chiuse",
  "inattivo",
  "inattivi",
  "inattiva",
  "inattive",
];

function buildClosedRegex(): RegExp {
  const raw = process.env.MONEYMONEY_CLOSED_KEYWORDS;
  // Distinguish "unset" (use defaults) from "set to empty" (disable heuristic).
  const keywords = raw === undefined
    ? DEFAULT_CLOSED_KEYWORDS
    : raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  if (keywords.length === 0) {
    return /(?!)/; // never matches
  }
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Suffix tolerance: allow inflectional endings (German "geschlossen" →
  // "Geschlossene Konten", Italian "chiuso" → already covered by listing
  // forms explicitly). The trailing letter class is unicode-friendly.
  return new RegExp(`\\b(?:${escaped.join("|")})[\\p{L}]*\\b`, "iu");
}

let cachedClosedRe: RegExp | null = null;
function getClosedRegex(): RegExp {
  if (cachedClosedRe === null) cachedClosedRe = buildClosedRegex();
  return cachedClosedRe;
}

/** Test helper: drop the cached regex so the next call re-reads
 *  MONEYMONEY_CLOSED_KEYWORDS from process.env. Production code never needs
 *  this — env vars are stable across the server's lifetime. */
export function resetClosedKeywordsCache(): void {
  cachedClosedRe = null;
}

// ---------------------------------------------------------------------------
// Generic tree builder
// ---------------------------------------------------------------------------

interface Hierarchical {
  uuid: string;
  name: string;
  indentation: number;
  group?: boolean;
}

export interface TreeNode<T extends Hierarchical> {
  item: T;
  parentUuid: string | null;
  path: string;          // "A > B > C"
  rootName: string;      // "A"
}

export function buildTree<T extends Hierarchical>(items: T[]): Map<string, TreeNode<T>> {
  // stack[i] holds the most recent item at indentation level i.
  const stack: T[] = [];
  const out = new Map<string, TreeNode<T>>();

  for (const item of items) {
    const indent = item.indentation ?? 0;
    while (stack.length > indent) stack.pop();

    const parent = indent > 0 ? stack[indent - 1] : undefined;
    const parentNode = parent ? out.get(parent.uuid) : undefined;
    const path = parentNode ? `${parentNode.path} > ${item.name}` : item.name;
    const rootName = parentNode ? parentNode.rootName : item.name;

    out.set(item.uuid, {
      item,
      parentUuid: parent?.uuid ?? null,
      path,
      rootName,
    });

    if (stack.length <= indent) stack.push(item);
    else stack[indent] = item;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Account hierarchy (closed inference, group expansion)
// ---------------------------------------------------------------------------

export interface AccountHierarchy {
  /** Tree built from `Account[]`. */
  tree: Map<string, TreeNode<Account>>;
  /** Original list, in the same order as returned by upstream. */
  list: Account[];
}

interface AccountClosure {
  parentGroupName: string | null;
  parentPath: string | null; // chain of group names without the leaf
  isClosed: boolean;
}

export function deriveAccountClosure(
  uuid: string,
  hierarchy: AccountHierarchy,
): AccountClosure {
  const node = hierarchy.tree.get(uuid);
  if (!node) {
    return { parentGroupName: null, parentPath: null, isClosed: false };
  }
  const parentNode = node.parentUuid ? hierarchy.tree.get(node.parentUuid) : undefined;
  const parentGroupName = parentNode?.item.name ?? null;
  const parentPath = parentNode?.path ?? null;

  // isClosed: any node — leaf account OR group — is closed if the
  // closure keyword appears anywhere along its FULL path (own name
  // + ancestors). Two cases:
  //   - leaf account under "Personal closed" → matches via "closed" in path
  //   - the group "Personal closed" itself → also matches, since its own
  //     name contains the keyword. Without this, archive containers
  //     appear as active in list_active_accounts.
  // The regex uses word boundaries, so a keyword like "archive" matches
  // "Archive 2020" but not "Architecture".
  const isClosed = getClosedRegex().test(node.path);

  return { parentGroupName, parentPath, isClosed };
}

/** Return all leaf-account UUIDs (group=false) descending from `name`. If
 *  `name` matches a leaf, returns just its UUID. If it matches a group,
 *  returns every leaf inside it. Case-insensitive exact match on name.
 *  Returns an empty array if nothing matches. */
export function resolveAccountUuids(
  name: string,
  hierarchy: AccountHierarchy,
): { uuids: string[]; matchedNode: TreeNode<Account> | null; isGroup: boolean } {
  const target = name.trim().toLowerCase();
  const matches: TreeNode<Account>[] = [];
  for (const node of hierarchy.tree.values()) {
    if ((node.item.name || "").toLowerCase() === target) {
      matches.push(node);
    }
  }
  if (matches.length === 0) {
    return { uuids: [], matchedNode: null, isGroup: false };
  }

  // If multiple matches, prefer a leaf account over a group — common case is
  // an account and a group sharing the name. If still ambiguous, take the
  // first leaf.
  matches.sort((a, b) => {
    const ag = a.item.group ? 1 : 0;
    const bg = b.item.group ? 1 : 0;
    return ag - bg;
  });
  const matched = matches[0]!;

  if (!matched.item.group) {
    return { uuids: [matched.item.uuid], matchedNode: matched, isGroup: false };
  }

  // Expand group to descendants (only leaf accounts).
  const uuids: string[] = [];
  // The list is in tree order; descendants are the items immediately after
  // matched whose indentation > matched.indentation, until we hit one with
  // indentation <= matched.indentation.
  const matchedIndex = hierarchy.list.findIndex((a) => a.uuid === matched.item.uuid);
  if (matchedIndex < 0) {
    return { uuids: [], matchedNode: matched, isGroup: true };
  }
  const groupIndent = matched.item.indentation ?? 0;
  for (let i = matchedIndex + 1; i < hierarchy.list.length; i++) {
    const a = hierarchy.list[i]!;
    const indent = a.indentation ?? 0;
    if (indent <= groupIndent) break;
    if (!a.group) uuids.push(a.uuid);
  }
  return { uuids, matchedNode: matched, isGroup: true };
}

// ---------------------------------------------------------------------------
// Category hierarchy (path-prefix filter)
// ---------------------------------------------------------------------------

export interface CategoryHierarchy {
  tree: Map<string, TreeNode<Category>>;
  list: Category[];
}

/** Test whether a category UUID's path begins with `prefix` (case-insensitive,
 *  using the canonical " > " separator). Matching is segment-aware — the
 *  prefix must align with a complete segment so that "Per" doesn't match
 *  "Personal". */
export function categoryPathStartsWith(
  uuid: string,
  prefix: string,
  hierarchy: CategoryHierarchy,
): boolean {
  const node = hierarchy.tree.get(uuid);
  if (!node) return false;
  const trimmed = prefix.trim();
  if (!trimmed) return true;

  const lcPath = node.path.toLowerCase();
  const lcPrefix = trimmed.toLowerCase();
  if (lcPath === lcPrefix) return true;
  return lcPath.startsWith(lcPrefix + " > ");
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let _accountCache: { stamp: number; value: AccountHierarchy } | null = null;
let _categoryCache: { stamp: number; value: CategoryHierarchy } | null = null;

export function invalidateHierarchyCache(): void {
  _accountCache = null;
  _categoryCache = null;
}

export async function getAccountHierarchy(
  loader: () => Promise<Account[]>,
): Promise<AccountHierarchy> {
  const now = Date.now();
  if (_accountCache && now - _accountCache.stamp < HIERARCHY_TTL_MS) {
    return _accountCache.value;
  }
  const list = await loader();
  const tree = buildTree(list);
  const value: AccountHierarchy = { tree, list };
  _accountCache = { stamp: now, value };
  return value;
}

export async function getCategoryHierarchy(
  loader: () => Promise<Category[]>,
): Promise<CategoryHierarchy> {
  const now = Date.now();
  if (_categoryCache && now - _categoryCache.stamp < HIERARCHY_TTL_MS) {
    return _categoryCache.value;
  }
  const list = await loader();
  const tree = buildTree(list);
  const value: CategoryHierarchy = { tree, list };
  _categoryCache = { stamp: now, value };
  return value;
}

// Re-exports for tests
export const __test__ = { getClosedRegex, buildClosedRegex };
