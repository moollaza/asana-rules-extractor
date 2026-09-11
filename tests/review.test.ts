import { describe, expect, it } from "vitest";
import { actionParts, conditionText, renderReview, valueText } from "../src/lib/review";
import type { Rule, RuleSet } from "../src/lib/types";
import routeRule from "./fixtures/route-rule.json";

const rule = routeRule as unknown as Rule;
const texts = (root: Element, selector: string) =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent?.replace(/\s+/g, " ").trim());

describe("valueText", () => {
  it("names every action value shape", () => {
    expect(valueText("Search")).toBe("Search");
    expect(valueText(["A", "B"])).toBe("A, B");
    expect(valueText({ useAI: true })).toBe("AI decides (see instructions)");
    expect(valueText({ names: ["Ann", "Bob"], gids: ["1", "2"] })).toBe("Ann, Bob");
    expect(valueText({ Ann: "1" })).toBe("Ann");
    expect(valueText({ namesUnavailable: true, count: 2, gids: [] })).toBe(
      "2 people (names not shown)",
    );
    expect(valueText({ field: "Priority", value: "High" })).toBe("Priority → High");
  });
});

describe("actionParts", () => {
  it("labels typed, set_field, untyped and incomplete actions", () => {
    expect(actionParts({ move_to_section: "Search" })).toEqual({
      label: "Move to section",
      value: "Search",
      flags: [],
    });
    expect(actionParts({ set_field: { field: "Priority", value: "High" } })).toEqual({
      label: "Set Priority",
      value: "High",
      flags: [],
    });
    expect(actionParts({ action: "Frobnicate", untyped: true, values: ["x"] })).toEqual({
      label: "Frobnicate",
      value: "x",
      flags: [],
    });
    expect(
      actionParts({
        add_collaborators: { namesUnavailable: true, count: 3, gids: [] },
        incomplete: true,
        text: "Add collaborators",
      }),
    ).toMatchObject({ label: "Add collaborators", flags: ["incomplete"] });
  });
});

describe("conditionText", () => {
  it("renders plain, expanded and incomplete conditions", () => {
    expect(conditionText("A is set to X")).toBe("A is set to X");
    expect(conditionText({ condition: "A is one of", values: ["X", "Y"] })).toBe(
      "A is one of X, Y",
    );
    expect(
      conditionText({ condition: "A is one of X", incomplete: true, hiddenValueCount: 25 }),
    ).toBe("A is one of X (+25 hidden)");
  });
});

describe("renderReview", () => {
  it("renders one row per rule, branch and action from a fixture shaped like a real rule", () => {
    const root = renderReview(rule);
    expect(root.querySelectorAll(".rv-rule")).toHaveLength(1);
    expect(root.querySelectorAll(".rv-branch:not(.rv-ai)")).toHaveLength(rule.branches.length);
    const actions = rule.branches.reduce((n, b) => n + b.do.length, 0);
    expect(root.querySelectorAll(".rv-action")).toHaveLength(actions);
    expect(texts(root, ".rv-rule-summary .rv-name")).toEqual(["Route Tasks by Area"]);
    expect(root.querySelector(".rv-rule")?.hasAttribute("open")).toBe(true);
    expect(texts(root, ".rv-when .rv-conds li")).toEqual([
      "Task is added to this project",
      "Area is changed",
    ]);
    expect(texts(root, ".rv-action-value")).toContain("AI decides (see instructions)");
    expect(root.querySelector(".rv-ai-text")?.textContent).toContain("Help Docs");
    expect(root.querySelectorAll(".rv-flag")).toHaveLength(0);
  });

  it("marks failed and suspect rules and keeps rules collapsed in a set", () => {
    const set: RuleSet = {
      project: "P",
      rules: [
        { ...rule, warnings: ["captured 3 of 4 cards on screen"] },
        { name: "Broken", error: "dialog did not open for this rule" },
      ],
    };
    const root = renderReview(set);
    expect(root.querySelector(".rv-project")?.textContent).toBe("P");
    expect(texts(root, ".rv-rule-summary .rv-flag")).toEqual(["1 warning", "failed"]);
    expect(texts(root, ".rv-warnings li")).toEqual(["captured 3 of 4 cards on screen"]);
    expect(root.querySelector(".rv-error")?.textContent).toBe("dialog did not open for this rule");
    expect(root.querySelector(".rv-rule[open]")).toBeNull();
  });

  it("labels branch kinds: If, Otherwise if, Otherwise, Always", () => {
    const root = renderReview({
      ...rule,
      aiInstructions: undefined,
      branches: [
        { if: { all: ["A is set to X"] }, do: [] },
        { if: { any: ["B is set to Y", "C is set to Z"] }, do: [] },
        { if: "otherwise", do: [] },
        { if: { all: [] }, do: [] },
      ],
    });
    expect(texts(root, ".rv-branch-summary .rv-kw")).toEqual([
      "If",
      "Otherwise if",
      "Otherwise",
      "Always",
    ]);
    expect(texts(root, ".rv-branch-summary")[1]).toBe(
      "Otherwise if B is set to Y OR C is set to Z0 actions",
    );
  });
});
