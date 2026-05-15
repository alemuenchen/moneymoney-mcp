import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildTree,
  deriveAccountClosure,
  resolveAccountUuids,
  categoryPathStartsWith,
  invalidateHierarchyCache,
  __test__,
  type AccountHierarchy,
  type CategoryHierarchy,
} from "../src/lib/hierarchy.js";
import type { Account, Category } from "moneymoney";

// Build minimal Account/Category fixtures: only the fields the tree builder
// actually reads. The rest are stubs typed via `as unknown as Account`.
function acc(name: string, indent: number, group: boolean, uuid?: string): Account {
  return {
    name,
    indentation: indent,
    group,
    uuid: uuid ?? `uuid-${name}`,
    accountNumber: "",
    bankCode: "",
    balance: [],
    currency: "EUR",
    icon: Buffer.alloc(0),
    owner: "",
    portfolio: false,
    type: group ? ("Account group" as Account["type"]) : ("Other" as Account["type"]),
  };
}

function cat(name: string, indent: number, group: boolean, uuid?: string): Category {
  return {
    name,
    indentation: indent,
    group,
    uuid: uuid ?? `cat-${name}`,
    currency: "EUR",
    icon: Buffer.alloc(0),
    rules: "",
    default: false as const,
    budget: { amount: 0, available: 0, period: "monthly" },
  } as unknown as Category;
}

beforeEach(() => {
  invalidateHierarchyCache();
});

describe("buildTree", () => {
  it("assigns parentUuid=null to top-level items", () => {
    const items = [acc("A", 0, true), acc("B", 0, true)];
    const tree = buildTree(items);
    expect(tree.get("uuid-A")?.parentUuid).toBeNull();
    expect(tree.get("uuid-B")?.parentUuid).toBeNull();
  });

  it("links children to most recent ancestor at indent-1", () => {
    const items = [
      acc("Personal", 0, true),
      acc("Checking 1", 1, false),
      acc("Checking 2", 1, false),
      acc("Personal closed", 1, true),
      acc("Old account", 2, false),
    ];
    const tree = buildTree(items);
    expect(tree.get("uuid-Checking 1")?.parentUuid).toBe("uuid-Personal");
    expect(tree.get("uuid-Personal closed")?.parentUuid).toBe("uuid-Personal");
    expect(tree.get("uuid-Old account")?.parentUuid).toBe("uuid-Personal closed");
  });

  it("computes full path with ' > ' separator", () => {
    const items = [
      acc("Business", 0, true),
      acc("Business closed", 1, true),
      acc("Old business account", 2, false),
    ];
    const tree = buildTree(items);
    expect(tree.get("uuid-Old business account")?.path).toBe(
      "Business > Business closed > Old business account",
    );
  });

  it("rootName is the top-level ancestor's name", () => {
    const items = [
      acc("Business", 0, true),
      acc("Business closed", 1, true),
      acc("Old business account", 2, false),
    ];
    const tree = buildTree(items);
    expect(tree.get("uuid-Old business account")?.rootName).toBe("Business");
  });
});

describe("deriveAccountClosure", () => {
  function buildHier(items: Account[]): AccountHierarchy {
    return { tree: buildTree(items), list: items };
  }

  it("flags accounts under 'Personal closed' as closed", () => {
    const items = [
      acc("Personal", 0, true),
      acc("Checking 1", 1, false),
      acc("Personal closed", 1, true),
      acc("Old account", 2, false),
    ];
    const h = buildHier(items);
    expect(deriveAccountClosure("uuid-Checking 1", h).isClosed).toBe(false);
    expect(deriveAccountClosure("uuid-Old account", h).isClosed).toBe(true);
  });

  it("flags accounts under 'Business closed' as closed", () => {
    const items = [
      acc("Business", 0, true),
      acc("Wallet", 1, false),
      acc("Business closed", 1, true),
      acc("Old business account", 2, false),
    ];
    const h = buildHier(items);
    expect(deriveAccountClosure("uuid-Wallet", h).isClosed).toBe(false);
    expect(deriveAccountClosure("uuid-Old business account", h).isClosed).toBe(true);
  });

  it("matches English / Italian / German / archive variants", () => {
    const variants = ["closed", "Archived", "Archive", "Inattivo", "chiuse"];
    for (const v of variants) {
      const items = [acc("Root", 0, true), acc(`Group ${v}`, 1, true), acc("X", 2, false)];
      const h = buildHier(items);
      expect(deriveAccountClosure("uuid-X", h).isClosed).toBe(true);
    }
  });

  it("does NOT match partial words ('Business' contains no closed token)", () => {
    const items = [
      acc("Business", 0, true),
      acc("Business office", 1, true),
      acc("X", 2, false),
    ];
    const h = buildHier(items);
    expect(deriveAccountClosure("uuid-X", h).isClosed).toBe(false);
  });

  it("returns parentGroupName as the immediate parent group", () => {
    const items = [
      acc("Business", 0, true),
      acc("Business closed", 1, true),
      acc("Old business account", 2, false),
    ];
    const h = buildHier(items);
    const closure = deriveAccountClosure("uuid-Old business account", h);
    expect(closure.parentGroupName).toBe("Business closed");
    expect(closure.parentPath).toBe("Business > Business closed");
  });

  it("top-level accounts have null parents and are open", () => {
    const items = [acc("Solo", 0, false)];
    const h = buildHier(items);
    const closure = deriveAccountClosure("uuid-Solo", h);
    expect(closure.parentGroupName).toBeNull();
    expect(closure.parentPath).toBeNull();
    expect(closure.isClosed).toBe(false);
  });

  it("flags the archive group itself (own name in path matches)", () => {
    // Surfaced during 1.3.0 testing: the group "Personal closed" itself
    // showed up as active because the closure keyword wasn't in its
    // parentPath ("Personal"), only in its own name. Now we match on the
    // full path including own name.
    const items = [
      acc("Personal", 0, true),
      acc("Personal closed", 1, true),
      acc("Old account", 2, false),
    ];
    const h = buildHier(items);
    expect(deriveAccountClosure("uuid-Personal closed", h).isClosed).toBe(true);
    expect(deriveAccountClosure("uuid-Personal", h).isClosed).toBe(false);
    expect(deriveAccountClosure("uuid-Old account", h).isClosed).toBe(true);
  });
});

describe("resolveAccountUuids", () => {
  function buildHier(items: Account[]): AccountHierarchy {
    return { tree: buildTree(items), list: items };
  }

  it("matches a leaf account by exact name", () => {
    const items = [acc("Personal", 0, true), acc("Checking 1", 1, false)];
    const r = resolveAccountUuids("Checking 1", buildHier(items));
    expect(r.uuids).toEqual(["uuid-Checking 1"]);
    expect(r.isGroup).toBe(false);
  });

  it("expands a group name to all leaf accounts inside", () => {
    const items = [
      acc("Personal", 0, true),
      acc("Checking 1", 1, false),
      acc("Checking 2", 1, false),
      acc("Personal closed", 1, true),
      acc("Old checking", 2, false),
    ];
    const r = resolveAccountUuids("Personal", buildHier(items));
    expect(r.isGroup).toBe(true);
    expect(r.uuids.sort()).toEqual(
      ["uuid-Checking 1", "uuid-Checking 2", "uuid-Old checking"].sort(),
    );
  });

  it("matches case-insensitively", () => {
    const items = [acc("Personal", 0, true), acc("Checking 1", 1, false)];
    const r = resolveAccountUuids("checking 1", buildHier(items));
    expect(r.uuids).toEqual(["uuid-Checking 1"]);
  });

  it("handles names with spaces and accented characters", () => {
    const items = [
      acc("Personal", 0, true),
      acc("Foreign account TR", 1, false),
    ];
    const r = resolveAccountUuids("Foreign account TR", buildHier(items));
    expect(r.uuids).toEqual(["uuid-Foreign account TR"]);
  });

  it("returns empty for nonexistent name", () => {
    const items = [acc("Personal", 0, true)];
    const r = resolveAccountUuids("Nonexistent", buildHier(items));
    expect(r.uuids).toEqual([]);
    expect(r.matchedNode).toBeNull();
  });

  it("prefers leaf when both leaf and group share a name", () => {
    // Edge case: an account named "Business" both as group and as leaf
    const items = [
      acc("Business", 0, true, "uuid-group"),
      acc("Business", 1, false, "uuid-leaf"),
    ];
    const r = resolveAccountUuids("Business", buildHier(items));
    expect(r.isGroup).toBe(false);
    expect(r.uuids).toEqual(["uuid-leaf"]);
  });
});

describe("categoryPathStartsWith", () => {
  function buildHier(items: Category[]): CategoryHierarchy {
    return { tree: buildTree(items), list: items };
  }

  it("matches direct prefix segment", () => {
    const items = [
      cat("Business", 0, true),
      cat("Business office", 1, true),
      cat("IT", 2, false, "cat-IT-Business"),
    ];
    const h = buildHier(items);
    expect(categoryPathStartsWith("cat-IT-Business", "Business", h)).toBe(true);
    expect(categoryPathStartsWith("cat-IT-Business", "Business > Business office", h)).toBe(true);
  });

  it("does NOT match partial-segment prefix", () => {
    const items = [
      cat("Business", 0, true),
      cat("Business office", 1, true),
      cat("IT", 2, false, "cat-IT-Business"),
    ];
    const h = buildHier(items);
    // "Alpe" is not a complete segment of "Business"
    expect(categoryPathStartsWith("cat-IT-Business", "Alpe", h)).toBe(false);
  });

  it("matches case-insensitively", () => {
    const items = [
      cat("Business", 0, true),
      cat("IT", 1, false, "cat-IT-Business"),
    ];
    const h = buildHier(items);
    expect(categoryPathStartsWith("cat-IT-Business", "business", h)).toBe(true);
    expect(categoryPathStartsWith("cat-IT-Business", "BUSINESS", h)).toBe(true);
  });

  it("returns false for unknown UUID", () => {
    const h = buildHier([cat("X", 0, true)]);
    expect(categoryPathStartsWith("nonexistent", "X", h)).toBe(false);
  });

  it("disambiguates duplicate names in different branches", () => {
    // The duplicate-name case: 'IT' appears
    // in TWO branches (Business > Business office vs Büro)
    const items = [
      cat("Business", 0, true),
      cat("Business office", 1, true),
      cat("IT", 2, false, "cat-IT-business"),
      cat("Büro", 0, true),
      cat("IT", 1, false, "cat-IT-personal"),
    ];
    const h = buildHier(items);
    // Filter to Business branch should match only the business one
    expect(categoryPathStartsWith("cat-IT-business", "Business", h)).toBe(true);
    expect(categoryPathStartsWith("cat-IT-personal", "Business", h)).toBe(false);
    expect(categoryPathStartsWith("cat-IT-personal", "Büro", h)).toBe(true);
    expect(categoryPathStartsWith("cat-IT-business", "Büro", h)).toBe(false);
  });
});

describe("closed-account heuristic (default keywords)", () => {
  const RE = __test__.getClosedRegex();
  it.each([
    ["Personal closed", true],
    ["Business archived", true],
    ["Closed accounts", true],
    ["Archived 2020", true],
    ["Archive group", true],
    ["Inattivo", true],
    ["Geschlossene Konten", true],
    ["Inaktiv 2019", true],
    ["Konten aktiv", false],
    ["Personal active", false],
    ["Travel Transfers", false],
    ["Conti correnti", false],
    ["Architecture", false], // contains 'arch' but word-bounded
    ["Alessandro", false],   // would false-match without word boundaries
  ])("%s → %s", (input, expected) => {
    expect(RE.test(input)).toBe(expected);
  });
});

describe("closed-account heuristic (env override)", () => {
  const ORIG = process.env.MONEYMONEY_CLOSED_KEYWORDS;
  afterEach(() => {
    process.env.MONEYMONEY_CLOSED_KEYWORDS = ORIG;
  });

  it("uses MONEYMONEY_CLOSED_KEYWORDS when set", () => {
    process.env.MONEYMONEY_CLOSED_KEYWORDS = "obsolete,legacy";
    const RE = __test__.buildClosedRegex();
    expect(RE.test("Obsolete accounts")).toBe(true);
    expect(RE.test("Legacy 2018")).toBe(true);
    // Defaults are NO LONGER active when the env is set explicitly.
    expect(RE.test("Closed")).toBe(false);
    expect(RE.test("Archived")).toBe(false);
  });

  it("disables the heuristic when env is set to empty", () => {
    process.env.MONEYMONEY_CLOSED_KEYWORDS = "";
    const RE = __test__.buildClosedRegex();
    expect(RE.test("Closed")).toBe(false);
    expect(RE.test("anything")).toBe(false);
  });

  it("trims whitespace and ignores empty entries", () => {
    process.env.MONEYMONEY_CLOSED_KEYWORDS = " foo ,, bar ,";
    const RE = __test__.buildClosedRegex();
    expect(RE.test("foo")).toBe(true);
    expect(RE.test("bar")).toBe(true);
  });

  it("escapes regex metacharacters in keywords", () => {
    process.env.MONEYMONEY_CLOSED_KEYWORDS = "a.b,c+d";
    const RE = __test__.buildClosedRegex();
    expect(RE.test("a.b")).toBe(true);
    expect(RE.test("aXb")).toBe(false); // dot is literal, not wildcard
    expect(RE.test("c+d")).toBe(true);
  });
});
