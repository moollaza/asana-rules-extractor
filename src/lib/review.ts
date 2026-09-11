// Renders a Result as nested <details> for reading in the popup: one row per
// rule, one per branch, one line per action. Pure DOM in, DOM out, so it runs
// under happy-dom in tests. The JSON stays the source of truth; this is a view.
import type { Action, Condition, ConditionGroup, Result, Rule } from "./types";
import { isFailed, rulesOf } from "./types";

type Child = Node | string | null | undefined | false;

function h(tag: string, className = "", ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const ACTION_LABELS: Record<string, string> = {
  move_to_section: "Move to section",
  add_to_project: "Add to project",
  add_collaborators: "Add collaborators",
  set_assignee: "Set assignee",
  set_task_name: "Set task name",
  add_comment: "Add comment",
  set_field: "Set field",
};

export function conditionText(condition: Condition): string {
  if (typeof condition === "string") return condition;
  if ("values" in condition) return `${condition.condition} ${condition.values.join(", ")}`;
  const hidden = condition.hiddenValueCount ? ` (+${condition.hiddenValueCount} hidden)` : "";
  return `${condition.condition}${hidden}`;
}

/** Human text for any action value shape produced by `typeAction`. */
export function valueText(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(valueText).join(", ");
  const obj = value as Record<string, unknown>;
  if (obj.useAI === true) return "AI decides (see instructions)";
  if (obj.namesUnavailable === true) {
    return obj.count ? `${obj.count} people (names not shown)` : "names not shown";
  }
  if (Array.isArray(obj.names)) return obj.names.map(String).join(", ");
  if ("field" in obj && "value" in obj) return `${obj.field} → ${valueText(obj.value)}`;
  // { "Ada Lovelace": "1200…" } single paired person, or any other name→gid map.
  const keys = Object.keys(obj);
  if (keys.length && keys.every((k) => typeof obj[k] === "string")) return keys.join(", ");
  return JSON.stringify(value);
}

export function actionParts(action: Action): { label: string; value: string; flags: string[] } {
  const flags: string[] = [];
  if (action.incomplete) flags.push("incomplete");
  if (action.untyped) {
    return { label: String(action.action ?? "Action"), value: valueText(action.values), flags };
  }
  const type = Object.keys(action).find(
    (k) => k in ACTION_LABELS || !["incomplete", "text"].includes(k),
  );
  if (!type) return { label: String(action.text ?? "Action"), value: "", flags };
  const value = action[type] as Record<string, unknown> | unknown;
  if (type === "set_field" && value && typeof value === "object" && "field" in value) {
    const v = value as { field: unknown; value: unknown };
    return { label: `Set ${v.field}`, value: valueText(v.value), flags };
  }
  const label = ACTION_LABELS[type] ?? type.replace(/_/g, " ");
  return { label, value: valueText(value), flags };
}

function conditionList(group: ConditionGroup): HTMLElement {
  const [joiner, conditions] = "any" in group ? ["any of", group.any] : ["all of", group.all];
  return h(
    "div",
    "rv-when",
    h("span", "rv-kw", "When", conditions.length > 1 ? h("span", "rv-joiner", joiner) : null),
    h("ul", "rv-conds", ...conditions.map((c) => h("li", "", conditionText(c)))),
  );
}

function actionRow(action: Action): HTMLElement {
  const { label, value, flags } = actionParts(action);
  return h(
    "li",
    "rv-action",
    h("span", "rv-action-label", label),
    value ? h("span", "rv-action-value", value) : null,
    ...flags.map((f) => h("span", "rv-flag", f)),
  );
}

function branchRow(branch: Rule["branches"][number], index: number): HTMLElement {
  const text = h("span", "rv-summary-text");
  if (branch.if === "otherwise") {
    text.append(h("span", "rv-kw", "Otherwise"));
  } else {
    const conditions = "any" in branch.if ? branch.if.any : branch.if.all;
    if (!conditions.length) text.append(h("span", "rv-kw", "Always"));
    else {
      text.append(h("span", "rv-kw", index === 0 ? "If" : "Otherwise if"));
      text.append(" ", conditions.map(conditionText).join("any" in branch.if ? " OR " : " AND "));
    }
  }
  const summary = h(
    "summary",
    "rv-branch-summary",
    text,
    h("span", "rv-count", plural(branch.do.length, "action")),
  );
  return h("details", "rv-branch", summary, h("ul", "rv-actions", ...branch.do.map(actionRow)));
}

function ruleRow(rule: Rule | { name: string; error: string }): HTMLElement {
  if (isFailed(rule)) {
    const text = h(
      "span",
      "rv-summary-text",
      h("span", "rv-name", rule.name),
      h("span", "rv-flag", "failed"),
    );
    return h(
      "details",
      "rv-rule rv-rule-failed",
      h("summary", "rv-rule-summary", text),
      h("p", "rv-error", rule.error),
    );
  }
  const warnings = rule.warnings?.length ?? 0;
  const summary = h(
    "summary",
    "rv-rule-summary",
    h(
      "span",
      "rv-summary-text",
      h("span", "rv-name", rule.name ?? "(unnamed)"),
      warnings ? h("span", "rv-flag", plural(warnings, "warning")) : null,
    ),
    h(
      "span",
      "rv-meta",
      [rule.status, plural(rule.branches.length, "branch")].filter(Boolean).join(" · "),
    ),
  );
  const ai = rule.aiInstructions;
  const body = h(
    "div",
    "rv-rule-body",
    warnings ? h("ul", "rv-warnings", ...(rule.warnings ?? []).map((w) => h("li", "", w))) : null,
    conditionList(rule.when),
    ...rule.branches.map(branchRow),
    ai
      ? h(
          "details",
          "rv-branch rv-ai",
          h(
            "summary",
            "rv-branch-summary",
            h("span", "rv-summary-text", h("span", "rv-kw", "AI instructions")),
          ),
          h("pre", "rv-ai-text", ai.text),
          ai.references.length
            ? h(
                "ul",
                "rv-conds",
                ...ai.references.map((r) => h("li", "", `${r.name} (${r.type} ${r.gid})`)),
              )
            : null,
        )
      : null,
  );
  return h("details", "rv-rule", summary, body);
}

export function renderReview(result: Result): HTMLElement {
  const rules = rulesOf(result);
  const root = h("div", "rv");
  if ("rules" in result && result.project) root.append(h("p", "rv-project", result.project));
  if (!rules.length) root.append(h("p", "rv-empty", "No rules."));
  root.append(...rules.map(ruleRow));
  // A single rule is the whole result: open it so the popup is not one collapsed line.
  if (rules.length === 1) root.querySelector("details")?.setAttribute("open", "");
  return root;
}
