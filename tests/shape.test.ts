import { describe, expect, it } from "vitest";
import { auditRule, shapeRule, typeAction } from "../src/lib/shape";
import type { Entry, RawRule } from "../src/lib/types";

const entry = (text: string, extra: Partial<Entry> = {}): Entry => ({
  text,
  pills: [],
  hasField: false,
  ...extra,
});

const raw = (over: Partial<RawRule> = {}): RawRule => ({
  id: "1",
  name: "R",
  project: "P",
  status: "Active",
  lastRun: null,
  when: [entry("Task is added to this project")],
  branches: [
    {
      kind: "Check if",
      if: [entry("A is set to X")],
      do: [entry("Move task to section S", { pills: ["S"] })],
    },
  ],
  ...over,
});

describe("shapeRule", () => {
  it("hoists the joiner into one all/any group and drops kind", () => {
    const shaped = shapeRule(
      raw({
        when: [entry("Task is added to this project"), entry("OR Surface Area is changed")],
        branches: [
          {
            kind: "Check if",
            if: [entry("A is set to X"), entry("AND B is set to Y")],
            do: [entry("Move task to section S", { pills: ["S"] })],
          },
        ],
      }),
    );
    expect(shaped.when).toEqual({
      any: ["Task is added to this project", "Surface Area is changed"],
    });
    expect(shaped.branches[0].if).toEqual({ all: ["A is set to X", "B is set to Y"] });
    expect(shaped.branches[0]).not.toHaveProperty("kind");
    expect(JSON.stringify(shaped)).not.toMatch(/"joiner"|"values":\[\]/);
  });

  it("splices expanded values into a truncated condition and flags unexpanded ones", () => {
    const full = shapeRule(
      raw({
        branches: [
          {
            kind: null,
            if: [entry("Surface Area is one of A, +25", { values: ["A", "B", "C"] })],
            do: [entry("Move task to section S", { pills: ["S"] })],
          },
        ],
      }),
    );
    expect(full.branches[0].if).toEqual({ all: ["Surface Area is one of A, B, C"] });

    const partial = shapeRule(
      raw({
        branches: [
          {
            kind: null,
            if: [entry("Surface Area is one of A", { incomplete: true, hiddenValueCount: 25 })],
            do: [],
          },
        ],
      }),
    );
    expect(partial.branches[0].if).toEqual({
      all: [{ condition: "Surface Area is one of A", incomplete: true, hiddenValueCount: 25 }],
    });
  });
});

const gid = (userGid: string) => ({ userGid, domainUserGid: "9" });

describe("typeAction", () => {
  it("prefers the object pill for section/project actions", () => {
    expect(typeAction(entry("Move task to section Search", { pills: ["Search"] }))).toEqual({
      move_to_section: "Search",
    });
    expect(typeAction(entry("Add to an additional project Bugs", { pills: ["Bugs"] }))).toEqual({
      add_to_project: "Bugs",
    });
  });

  it("turns a Use AI pill into { useAI: true } instead of a project named 'Use AI'", () => {
    expect(
      typeAction(entry("Add to an additional project Use AI", { pills: [], useAi: true })),
    ).toEqual({ add_to_project: { useAI: true } });
    expect(
      typeAction(entry("Add to an additional project Use AI", { useAi: true })),
    ).not.toHaveProperty("incomplete");
  });

  it("keeps the literal text for set_task_name even when it contains a pill", () => {
    expect(
      typeAction(entry('Set task name to "⭐ Report: {Task name}"', { pills: ["Task name"] })),
    ).toEqual({
      set_task_name: '"⭐ Report: {Task name}"',
    });
  });

  it("pairs a name with a gid only when the DOM tied them together", () => {
    expect(
      typeAction(
        entry("Add collaborators", { people: ["Ann"], gids: [gid("1")], gidsPaired: true }),
      ),
    ).toEqual({ add_collaborators: { Ann: "1" } });
    expect(
      typeAction(
        entry("Add collaborators", { people: ["Ann", "Bob"], gids: [gid("1"), gid("2")] }),
      ),
    ).toEqual({ add_collaborators: { names: ["Ann", "Bob"], gids: ["1", "2"] } });
    expect(
      typeAction(
        entry("Add collaborators", { people: ["Ann", "Bob", "Cy"], gids: [gid("1"), gid("2")] }),
      ),
    ).toEqual({ add_collaborators: { names: ["Ann", "Bob", "Cy"], gids: ["1", "2"] } });
    expect(typeAction(entry("Add collaborators Diego", { people: ["Diego"] }))).toEqual({
      add_collaborators: "Diego",
    });
  });

  it("never merges two collaborator cards and keeps action order", () => {
    const shaped = shapeRule(
      raw({
        branches: [
          {
            kind: null,
            if: [],
            do: [
              entry("Add collaborators", { people: ["Ann"] }),
              entry("Move task to section S", { pills: ["S"] }),
              entry("Add collaborators", { people: ["Bob"] }),
            ],
          },
        ],
      }),
    );
    expect(shaped.branches[0].do).toEqual([
      { add_collaborators: "Ann" },
      { move_to_section: "S" },
      { add_collaborators: "Bob" },
    ]);
  });

  it("keeps unknown actions readable with their values, marked untyped", () => {
    expect(typeAction(entry("Frobnicate the widget"))).toEqual({
      action: "Frobnicate the widget",
      untyped: true,
    });
    expect(typeAction(entry("Add tags Urgent", { pills: ["Urgent"] }))).toEqual({
      action: "Add tags Urgent",
      untyped: true,
      values: ["Urgent"],
    });
  });
});

describe("auditRule", () => {
  const ok = { cardsOnScreen: 3, placeholders: 0, dirty: false };

  it("is silent on a complete rule", () => {
    const r = raw();
    expect(auditRule(r, shapeRule(r), ok)).toEqual([]);
  });

  it("flags a group that mixes AND and OR", () => {
    const r = raw({
      when: [entry("A is changed"), entry("OR B is changed"), entry("AND C is changed")],
    });
    expect(auditRule(r, shapeRule(r), { ...ok, cardsOnScreen: 5 })).toEqual([
      "trigger mixes AND and OR; all/any is unreliable",
    ]);
  });

  it("reports every way a read can be wrong", () => {
    const r = raw({
      when: [],
      branches: [
        {
          kind: null,
          if: [entry("A is one of X", { incomplete: true, hiddenValueCount: 3 })],
          do: [entry("Frobnicate")],
        },
      ],
    });
    const problems = auditRule(r, shapeRule(r), { cardsOnScreen: 5, placeholders: 2, dirty: true });
    expect(problems).toEqual([
      "captured 2 of 5 cards on screen",
      '2 cards still show "Unspecified" (rule may not have finished loading)',
      "SAVE BUTTON IS ENABLED: the rule looks modified; do not save, close the dialog",
      "no trigger found",
      "1 entries still have hidden values",
    ]);
  });
});

describe("otherwise branch", () => {
  it("counts the Otherwise card as captured so a complete read is not SUSPECT", () => {
    const r = raw({
      branches: [
        {
          kind: "Check if",
          if: [entry("A is set to X")],
          do: [entry("Move task to section S", { pills: ["S"] })],
        },
        { kind: "Otherwise", if: [], do: [entry("Move task to section T", { pills: ["T"] })] },
      ],
    });
    // 1 trigger + 1 condition + 1 action + 1 Otherwise card + 1 action = 5 cards
    expect(auditRule(r, shapeRule(r), { cardsOnScreen: 5, placeholders: 0, dirty: false })).toEqual(
      [],
    );
  });

  it("shapes the catch-all as if: 'otherwise'", () => {
    const shaped = shapeRule(
      raw({
        branches: [
          { kind: "Otherwise", if: [], do: [entry("Move task to section S", { pills: ["S"] })] },
        ],
      }),
    );
    expect(shaped.branches[0]).toEqual({ if: "otherwise", do: [{ move_to_section: "S" }] });
  });
});

describe("people actions with no people node", () => {
  it("are marked incomplete instead of exporting an empty value", () => {
    expect(typeAction(entry("Add collaborators"))).toEqual({
      add_collaborators: [],
      incomplete: true,
      text: "Add collaborators",
    });
    expect(typeAction(entry("Set assignee to"))).toMatchObject({ incomplete: true });
    // Text after the label with no people widget still reads as the value.
    expect(typeAction(entry("Set assignee to Task creator"))).toEqual({
      set_assignee: "Task creator",
    });
  });
});

describe("expanded values on an unknown condition phrasing", () => {
  it("keeps the full list instead of the truncated sentence", () => {
    const shaped = shapeRule(
      raw({ when: [entry("Tags include A, +5", { values: ["A", "B", "C", "D", "E", "F"] })] }),
    );
    expect(shaped.when).toEqual({
      all: [{ condition: "Tags include A, +5", values: ["A", "B", "C", "D", "E", "F"] }],
    });
  });
});

describe("conditions with people", () => {
  it("splices collaborator names into the condition sentence", () => {
    const shaped = shapeRule(
      raw({
        branches: [
          {
            kind: "Check if",
            if: [entry("Assignee is set to", { people: ["Ada", "Grace"] })],
            do: [entry("Move task to section S", { pills: ["S"] })],
          },
        ],
      }),
    );
    expect(shaped.branches[0].if).toEqual({ all: ["Assignee is set to Ada, Grace"] });
  });
});

describe("set_field", () => {
  it("takes the field name from the field pill when the name contains ' to '", () => {
    expect(
      typeAction(entry("Set Ready to Ship to Yes", { pills: ["Yes"], field: "Ready to Ship" })),
    ).toEqual({ set_field: { field: "Ready to Ship", value: "Yes" } });
  });

  it("uses expanded pane values and keeps a failed expand marked incomplete", () => {
    expect(
      typeAction(entry("Set Tags to A, +5", { pills: ["A"], values: ["A", "B", "C"] })),
    ).toEqual({ set_field: { field: "Tags", value: ["A", "B", "C"] } });
    expect(
      typeAction(
        entry("Set Tags to A, +5", { pills: ["A"], incomplete: true, hiddenValueCount: 5 }),
      ),
    ).toMatchObject({ set_field: { field: "Tags", value: "A" }, incomplete: true });
    expect(typeAction(entry("Set Priority to High", { pills: ["High"] }))).toEqual({
      set_field: { field: "Priority", value: "High" },
    });
  });
});

describe("set_assignee", () => {
  it("wins over set_field when the assignee name renders inline", () => {
    expect(
      typeAction(
        entry("Set assignee to Ada Lovelace", {
          people: ["Ada Lovelace"],
          gids: [gid("1")],
          gidsPaired: true,
        }),
      ),
    ).toEqual({ set_assignee: { "Ada Lovelace": "1" } });
  });
});

describe("Use AI audit", () => {
  const aiRaw = (aiInstructions?: RawRule["aiInstructions"]) =>
    raw({
      ...(aiInstructions ? { aiInstructions } : {}),
      branches: [
        {
          kind: "Check if",
          if: [entry("A is set to X")],
          do: [entry("Add to an additional project Use AI", { useAi: true })],
        },
      ],
    });
  const dialogState = { cardsOnScreen: 3, placeholders: 0, dirty: false };

  it("carries aiInstructions onto the shaped rule and passes the audit", () => {
    const instructions = { text: "Pick the closest project", references: [] };
    const shaped = shapeRule(aiRaw(instructions));
    expect(shaped.aiInstructions).toEqual(instructions);
    expect(shaped.branches[0].do[0]).toEqual({ add_to_project: { useAI: true } });
    expect(auditRule(aiRaw(instructions), shaped, dialogState)).toEqual([]);
  });

  it("warns when a Use AI action has no instructions to go with it", () => {
    const shaped = shapeRule(aiRaw());
    expect(shaped).not.toHaveProperty("aiInstructions");
    expect(auditRule(aiRaw(), shaped, dialogState)).toEqual([
      '1 action(s) say "Use AI" but the Instructions card was not read',
    ]);
  });
});
