import { describe, expect, it } from "vitest";
import {
  dialogUsesAi,
  emptyExpanded,
  extractRule,
  isDirty,
  needsExpanding,
  placeholderCount,
  readInstructions,
  readText,
} from "../src/lib/extract";
import { SEL } from "../src/lib/selectors";
import { cards, dialog, instructionsEditor, mount, multiCard } from "./fixtures/rule-dialog";

const URL = "https://app.asana.com/1/1/project/2/rules/1234567890";

describe("extractRule", () => {
  it("reads metadata and groups cards by kind label in document order", () => {
    const el = mount(
      dialog(
        multiCard("When", "Or", [cards.trigger, cards.fieldChanged]) +
          cards.enumCondition +
          cards.moveToSection +
          cards.truncated +
          cards.onePerson,
      ),
    );
    const rule = extractRule(el, emptyExpanded(), URL);

    expect(rule).toMatchObject({
      id: "1234567890",
      name: "Test Rule",
      project: "Fixture Project",
      status: "Active",
      lastRun: "Last run yesterday",
    });
    expect(rule.when.map((e) => e.text)).toEqual([
      "Task is added to this project",
      "OR Area is changed",
    ]);
    expect(rule.branches).toHaveLength(2);
    expect(rule.branches[0].if[0].text).toBe("Area is set to Billing");
    expect(rule.branches[0].do[0].pills).toEqual(["Search"]);
    expect(rule.branches[1].do[0].people).toEqual(["Ada Lovelace"]);
  });

  it("excludes field-name pills from value pills", () => {
    const el = mount(dialog(cards.enumCondition));
    const rule = extractRule(el, emptyExpanded(), URL);
    expect(rule.branches[0].if[0]).toMatchObject({
      pills: ["Billing"],
      hasField: true,
      field: "Area",
    });
  });

  it("marks truncated lists incomplete unless expanded values are supplied", () => {
    const el = mount(dialog(cards.truncated));
    const card = el.querySelector(SEL.card)!;
    expect(needsExpanding(card)).toBe(true);

    const bare = extractRule(el, emptyExpanded(), URL).branches[0].if[0];
    expect(bare).toMatchObject({ incomplete: true, hiddenValueCount: 25 });

    const expanded = emptyExpanded();
    expanded.values.set(card, ["Alpha", "Beta", "Gamma"]);
    const full = extractRule(el, expanded, URL).branches[0].if[0];
    expect(full.values).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(full.incomplete).toBeUndefined();
  });

  it("never lets a collapsed facepile pass as an empty collaborator list", () => {
    const el = mount(dialog(cards.threePeople));
    const card = el.querySelector(SEL.card)!;
    expect(needsExpanding(card)).toBe(true);
    const entry = extractRule(el, emptyExpanded(), URL).branches[0].do[0];
    expect(entry.incomplete).toBe(true);
    expect(entry.people).toMatchObject({ namesUnavailable: true, count: 3 });
    expect(entry.gids?.map((g) => g.userGid)).toEqual(["1200000000000002", "1200000000000003"]);
  });

  it("gives a rule with only actions a branch with an empty if", () => {
    const rule = extractRule(
      mount(dialog(cards.trigger + cards.moveToSection)),
      emptyExpanded(),
      URL,
    );
    expect(rule.branches).toEqual([expect.objectContaining({ if: [], do: [expect.anything()] })]);
  });

  it("detects placeholders and a dirty Save button", () => {
    const el = mount(dialog(cards.placeholder, { dirty: true }));
    expect(placeholderCount(el)).toBe(1);
    expect(isDirty(el)).toBe(true);
    expect(isDirty(mount(dialog(cards.trigger)))).toBe(false);
  });
});

describe("branch boundaries", () => {
  it('keeps two consecutive action-less "Otherwise if" branches separate', () => {
    const el = mount(
      dialog(cards.trigger + cards.truncated + cards.truncated + cards.moveToSection),
    );
    const rule = extractRule(el, emptyExpanded(), URL);
    expect(rule.branches.map((b) => [b.if.length, b.do.length])).toEqual([
      [1, 0],
      [1, 1],
    ]);
  });

  it("joins conditions only inside one multi-config group", () => {
    const el = mount(
      dialog(
        cards.trigger +
          multiCard("Check if", "And", [cards.enumCondition, cards.fieldChanged]) +
          cards.moveToSection,
      ),
    );
    const rule = extractRule(el, emptyExpanded(), URL);
    expect(rule.branches).toHaveLength(1);
    expect(rule.branches[0].if.map((e) => e.text)).toEqual([
      "Area is set to Billing",
      "AND Area is changed",
    ]);
  });

  it("reads the gid from the undotted profile photo URL shape too", () => {
    const one = extractRule(mount(dialog(cards.onePersonPlainUrl)), emptyExpanded(), URL)
      .branches[0].do[0];
    expect(one.gids).toEqual([{ userGid: "1200000000000009", domainUserGid: null }]);
    expect(one.gidsPaired).toBe(true);
  });

  it("marks a gid as paired only for a single rendered person", () => {
    const one = extractRule(mount(dialog(cards.onePerson)), emptyExpanded(), URL).branches[0].do[0];
    expect(one.gidsPaired).toBe(true);
    const el = mount(dialog(cards.threePeople));
    const expanded = emptyExpanded();
    expanded.names.set(el.querySelector(SEL.card)!, ["A", "B"]);
    const many = extractRule(el, expanded, URL).branches[0].do[0];
    expect(many.gidsPaired).toBe(false);
  });
});

describe("catch-all Otherwise", () => {
  it("gets its own branch instead of feeding the previous one", () => {
    const el = mount(
      dialog(
        cards.trigger +
          cards.enumCondition +
          cards.moveToSection +
          cards.otherwise +
          cards.setTaskName,
      ),
    );
    const rule = extractRule(el, emptyExpanded(), URL);
    expect(rule.branches.map((b) => [b.kind, b.if.length, b.do.length])).toEqual([
      ["Check if", 1, 1],
      ["Otherwise", 0, 1],
    ]);
  });
});

describe("Otherwise card without a title", () => {
  it("still starts the catch-all branch", () => {
    const el = mount(
      dialog(
        cards.trigger +
          cards.enumCondition +
          cards.moveToSection +
          cards.otherwiseNoTitle +
          cards.setTaskName,
      ),
    );
    const rule = extractRule(el, emptyExpanded(), URL);
    expect(rule.branches.map((b) => [b.kind, b.if.length, b.do.length])).toEqual([
      ["Check if", 1, 1],
      ["Otherwise", 0, 1],
    ]);
  });
});

describe("readText", () => {
  it("separates adjacent elements with a space so word boundaries survive", () => {
    document.body.innerHTML = '<div id="r"><span>Rules</span><span>13</span></div>';
    expect(readText(document.getElementById("r")!)).toBe("Rules 13");
  });
});

describe("Use AI", () => {
  it("flags the card and keeps 'Use AI' out of the value pills", () => {
    const el = mount(dialog(cards.trigger + cards.useAiProject));
    expect(dialogUsesAi(el)).toBe(true);
    const action = extractRule(el, emptyExpanded(), URL).branches[0].do[0];
    expect(action.useAi).toBe(true);
    expect(action.pills).toEqual([]);
    expect(action.text).toBe("Add to an additional project Use AI");
    expect(dialogUsesAi(mount(dialog(cards.trigger + cards.moveToSection)))).toBe(false);
  });

  it("attaches the instructions to the raw rule only when given", () => {
    const el = mount(dialog(cards.trigger + cards.useAiProject));
    expect(extractRule(el, emptyExpanded(), URL)).not.toHaveProperty("aiInstructions");
    const given = { text: "do the thing", references: [] };
    expect(extractRule(el, emptyExpanded(), URL, given).aiInstructions).toEqual(given);
  });
});

describe("readInstructions", () => {
  it("flattens paragraphs and lists, inlines object pills by name, lists their gids", () => {
    document.body.innerHTML = instructionsEditor;
    const editor = document.querySelector(".ProseMirror")!;
    expect(readInstructions(editor)).toEqual({
      text: [
        'When Area is "Static":',
        "",
        "Determine if",
        "- the task is about our Help Pages project and add it there",
        "- Otherwise add to Homepage and Static Marketing Pages",
        "  - nested note",
      ].join("\n"),
      references: [
        { type: "project", name: "Help Pages", gid: "1116104605880867" },
        { type: "project", name: "Homepage and Static Marketing Pages", gid: "424903000459" },
      ],
    });
  });
});
