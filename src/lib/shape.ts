// Turns a RawRule into the flat shape an agent reads: one `all`/`any` group per
// condition set, one sentence per condition, one `{type: value}` per action.
// An action with no typed key is kept in full as `{action, values, untyped}`; a
// rule whose card count doesn't add up gets `warnings`. A "Use AI" value becomes
// `{ useAI: true }` and the rule carries the `aiInstructions` the AI reads. Never let a selector miss read as
// "this rule has no branches".
import type { Action, Condition, ConditionGroup, Entry, RawBranch, RawRule, Rule } from "./types";

/** Action types whose value is the object pill in the card, not the card text. */
const PILL_VALUED = new Set([
  "move_to_section",
  "add_to_project",
  "set_field",
  "set_assignee",
  "add_collaborators",
]);

export const ACTIONS: [RegExp, string][] = [
  [/^Add collaborators\b ?(.*)$/, "add_collaborators"],
  [/^Set assignee to\b ?(.*)$/, "set_assignee"],
  [/^Move task to section (.+)$/, "move_to_section"],
  [/^Add to an additional project (.+)$/, "add_to_project"],
  [/^Set task name to (.+)$/, "set_task_name"],
  [/^Add comment in task (.+)$/, "add_comment"],
  [/^Set (.+?) to (.+)$/, "set_field"],
];

/** "Area is one of X" / "Issue Type is not set to Spam". */
export const CONDITION =
  /^(.+?) (is set to|is not set to|is one of|is not one of|is empty|is not empty|is changed|does not contain|contains) ?(.*)$/;

function splitJoiner(text: string): { joiner: "AND" | "OR" | null; text: string } {
  const match = text.match(/^(AND|OR) (.*)$/s);
  return match ? { joiner: match[1] as "AND" | "OR", text: match[2] } : { joiner: null, text };
}

function conditionString(entry: Entry): Condition {
  const { text } = splitJoiner(entry.text);
  // Values expanded from the side pane, or people names (a facepile renders no
  // text), are spliced back in after the operator.
  const expanded = entry.values ?? (Array.isArray(entry.people) ? entry.people : null);
  if (expanded) {
    const match = text.match(CONDITION);
    if (match) return `${entry.field ?? match[1]} ${match[2]} ${expanded.join(", ")}`;
    // Unknown phrasing: keep the sentence and the full list side by side rather
    // than dropping what the pane showed.
    return { condition: text, values: expanded };
  }
  if (entry.incomplete) {
    return { condition: text, incomplete: true, hiddenValueCount: entry.hiddenValueCount };
  }
  return text;
}

/** Distinct joiners seen in one group; more than one means the group is ambiguous. */
export const joinersIn = (entries: Entry[]): string[] => [
  ...new Set(
    entries.map((e) => splitJoiner(e.text).joiner).filter((j): j is "AND" | "OR" => Boolean(j)),
  ),
];

export function conditionGroup(entries: Entry[]): ConditionGroup {
  const joiner = joinersIn(entries)[0];
  const conditions = entries.map(conditionString);
  return joiner === "OR" ? { any: conditions } : { all: conditions };
}

/**
 * Name paired with gid only when the DOM ties them together (`gidsPaired`).
 * Otherwise names and gids are kept as two lists: a wrong pairing would look
 * exactly as confident as a right one.
 */
function peopleValue(entry: Entry): unknown {
  const people = entry.people;
  if (!people) return null;
  if (!Array.isArray(people)) return people;
  const gids = (entry.gids ?? []).map((g) => g.userGid);
  if (entry.gidsPaired && gids.length === 1 && people.length === 1) {
    return { [people[0]]: gids[0] };
  }
  return gids.length ? { names: people, gids } : people;
}

export function typeAction(entry: Entry): Action {
  const { text } = entry;
  for (const [pattern, type] of ACTIONS) {
    const match = text.match(pattern);
    if (!match) continue;
    const captured = match.slice(1).filter(Boolean);
    if (type === "set_field" && captured.length === 2) {
      // Expanded pane values (multi-select "+N") beat the visible text; a
      // failed expand must stay marked incomplete so the audit sees it.
      const values = entry.values ?? (entry.pills.length ? entry.pills : [captured[1]]);
      // The field pill is authoritative; the text split guesses at the first " to ".
      const typed: Action = {
        set_field: {
          field: entry.field ?? captured[0],
          value: values.length === 1 ? values[0] : values,
        },
      };
      if (entry.incomplete) Object.assign(typed, { incomplete: true, text });
      return typed;
    }
    let value: unknown;
    // "Use AI" is not an object name: the AI picks the value from the rule's
    // `aiInstructions` each time the rule runs.
    if (entry.useAi) value = { useAI: true };
    else if (entry.people) value = peopleValue(entry);
    else if (entry.values) value = entry.values;
    else if (PILL_VALUED.has(type) && entry.pills.length) value = entry.pills;
    else value = captured;
    if (Array.isArray(value) && value.length === 1) value = value[0];
    const typed: Action = { [type]: value };
    // A typed action with nothing in it (no people node found, no text after
    // the label) is a missed read, not an empty rule. Mark it so the audit sees it.
    const empty = value == null || (Array.isArray(value) && value.length === 0);
    if (entry.incomplete || empty) Object.assign(typed, { incomplete: true, text });
    return typed;
  }
  // No known phrasing: the card is still fully read, so keep it readable
  // rather than alarming. `untyped` lets the audit count these separately.
  const generic: Action = { action: text, untyped: true };
  if (entry.people) generic.people = peopleValue(entry);
  else if (entry.values) generic.values = entry.values;
  else if (entry.pills.length) generic.values = entry.pills;
  if (entry.incomplete) generic.incomplete = true;
  return generic;
}

export function shapeRule(rule: RawRule): Rule {
  const { when, branches, ...meta } = rule;
  return {
    ...meta,
    when: conditionGroup(when),
    branches: branches.map(({ kind, if: conds, do: actions }: RawBranch) => ({
      if: conds.length ? conditionGroup(conds) : kind === "Otherwise" ? "otherwise" : { all: [] },
      do: actions.map(typeAction),
    })),
  };
}

// --- Audit --------------------------------------------------------------------

export interface AuditInput {
  cardsOnScreen: number;
  placeholders: number;
  dirty: boolean;
}

const conditionsOf = (group: ConditionGroup | "otherwise"): Condition[] =>
  group === "otherwise" ? [] : Object.values(group).flat();

export const untypedCount = (shaped: Rule): number =>
  shaped.branches.flatMap((b) => b.do).filter((a) => a.untyped).length;

export function auditRule(raw: RawRule, shaped: Rule, dialog: AuditInput): string[] {
  const problems: string[] = [];
  // An "Otherwise" card carries no entry of its own but is a card on screen.
  const captured =
    raw.when.length +
    raw.branches.reduce(
      (sum, b) => sum + b.if.length + b.do.length + (b.kind === "Otherwise" ? 1 : 0),
      0,
    );
  if (captured !== dialog.cardsOnScreen) {
    problems.push(`captured ${captured} of ${dialog.cardsOnScreen} cards on screen`);
  }
  if (dialog.placeholders) {
    problems.push(
      `${dialog.placeholders} cards still show "Unspecified" (rule may not have finished loading)`,
    );
  }
  if (dialog.dirty) {
    problems.push("SAVE BUTTON IS ENABLED: the rule looks modified; do not save, close the dialog");
  }
  if (!raw.when.length) problems.push("no trigger found");
  if (!raw.branches.length) problems.push("no branches found");
  [raw.when, ...raw.branches.map((b) => b.if)].forEach((group, i) => {
    if (joinersIn(group).length > 1) {
      problems.push(`${i ? `branch ${i}` : "trigger"} mixes AND and OR; all/any is unreliable`);
    }
  });
  raw.branches.forEach((branch, i) => {
    if (!branch.do.length) problems.push(`branch ${i + 1} has no actions`);
  });
  const aiCards = raw.branches.flatMap((b) => b.do).filter((a) => a.useAi).length;
  if (aiCards && !raw.aiInstructions?.text) {
    problems.push(`${aiCards} action(s) say "Use AI" but the Instructions card was not read`);
  }

  const entries = [
    ...conditionsOf(shaped.when),
    ...shaped.branches.flatMap((b) => [...conditionsOf(b.if), ...b.do]),
  ].filter((entry): entry is Record<string, unknown> => typeof entry === "object");
  const incomplete = entries.filter((e) => e.incomplete).length;
  if (incomplete) problems.push(`${incomplete} entries still have hidden values`);

  return problems;
}
