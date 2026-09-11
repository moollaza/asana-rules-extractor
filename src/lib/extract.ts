// Reads one rule dialog into a RawRule. Everything here is synchronous and
// takes the dialog element as input, so it can run against fixture HTML in
// tests. Anything that needs clicking (expanding truncated lists) happens in the
// content script and is handed in through `expanded`.
import { SEL } from "./selectors";
import type {
  AiInstructions,
  Entry,
  ObjectRef,
  PersonGid,
  RawBranch,
  RawRule,
  UnknownPeople,
} from "./types";

/** Values read from the side pane after clicking a card, keyed by card. */
export interface Expanded {
  names: WeakMap<Element, string[]>;
  values: WeakMap<Element, string[]>;
}

export const emptyExpanded = (): Expanded => ({ names: new WeakMap(), values: new WeakMap() });

/**
 * Visible text of a node with spaces between elements, so pills don't run
 * together ("Surface Areais set to"). Skips facepiles (avatars plus a bare
 * count digit) and SVGs (avatar <title>s read as "avatar body avatar eyes").
 */
export function readText(node: Element): string {
  const parts: string[] = [];
  const walk = (el: Element) => {
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        parts.push(child.textContent ?? "");
      } else if (child instanceof Element) {
        if (child.closest(SEL.facepile) || child.tagName.toLowerCase() === "svg") continue;
        if (child instanceof HTMLImageElement && child.alt) parts.push(child.alt);
        else walk(child);
      }
    }
  };
  walk(node);
  return parts
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([:,.])/g, "$1")
    .trim();
}

// --- People -------------------------------------------------------------------

/**
 * Asana renders a person's name only when the action names exactly one. Past
 * that it draws avatars alone, with a count badge past two, so most collaborator
 * cards carry no names in the DOM at all.
 */
export function renderedNames(card: Element): string[] {
  return [...card.querySelectorAll(SEL.personName)]
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean);
}

export const hasPeopleWidget = (card: Element): boolean => Boolean(card.querySelector(SEL.people));

export const isCollapsed = (card: Element): boolean =>
  hasPeopleWidget(card) && renderedNames(card).length === 0;

/**
 * Profile photo URLs carry the user's gid, in one of two shapes seen so far:
 *   .../profile_photos/<asset>/<userGid>.<domainUserGid>.<hash>_27x27.png
 *   .../profile_photos/<userGid>/<hash>_27x27.png
 * Only people with a photo have one; default (initials) avatars carry nothing.
 */
export function peopleGidsIn(card: Element): PersonGid[] {
  const gids: PersonGid[] = [];
  for (const img of card.querySelectorAll(SEL.avatarImage)) {
    const url = img.getAttribute("href") ?? img.getAttribute("src") ?? "";
    const dotted = url.match(/profile_photos\/\d+\/(\d+)\.(\d+)\./);
    if (dotted) {
      gids.push({ userGid: dotted[1], domainUserGid: dotted[2] });
      continue;
    }
    const plain = url.match(/profile_photos\/(\d+)\/[0-9a-f]{16,}/);
    if (plain) gids.push({ userGid: plain[1], domainUserGid: null });
  }
  return gids;
}

function collaborators(card: Element, expanded: Expanded): string[] | UnknownPeople | null {
  if (!hasPeopleWidget(card)) return null;

  const fromPane = expanded.names.get(card);
  if (fromPane) return fromPane;

  const rendered = renderedNames(card);
  if (rendered.length) return rendered;

  const badge = card.querySelector(`${SEL.facepile} ${SEL.countAvatar}`)?.textContent?.trim();
  const gids = peopleGidsIn(card);
  return { namesUnavailable: true, count: badge ? Number(badge) : gids.length || null, gids };
}

// --- Pills --------------------------------------------------------------------

/**
 * A condition matching many enum values renders one pill plus a "+25" badge, so
 * the card shows 1 of 26 values. Left unexpanded the rule reads as narrow when
 * it is broad: an inverted meaning, not a missing detail.
 */
export function truncatedBy(card: Element): number {
  const title = card.querySelector(SEL.cardTitle);
  if (!title) return 0;
  for (const el of title.querySelectorAll("*")) {
    const match = el.textContent?.trim().match(/^\+(\d+)$/);
    if (match && !el.firstElementChild) return Number(match[1]);
  }
  return 0;
}

export const needsExpanding = (card: Element): boolean =>
  isCollapsed(card) || truncatedBy(card) > 0;

/**
 * The pill in a card ("Duck Player") is the referenced object, so read it off
 * the element rather than regexing the concatenated text. Field-name pills
 * ("Surface Area") are excluded: the testid sits on a span inside the pill.
 */
export function pillTexts(card: Element): string[] {
  const title = card.querySelector(SEL.cardTitle);
  if (!title) return [];
  const groups = title.querySelectorAll(SEL.valuePills);
  const scope = groups.length ? [...groups] : [title];
  return scope
    .flatMap((el) => [...el.querySelectorAll(SEL.pill)])
    .filter(
      (pill) =>
        !pill.closest(SEL.fieldPill) &&
        !pill.querySelector(SEL.fieldPillLabel) &&
        !pill.closest(SEL.useAiPill),
    )
    .map((pill) => pill.textContent?.trim() ?? "")
    .filter((text) => text && !/^\+\d+$/.test(text));
}

export const usesAi = (card: Element): boolean =>
  Boolean(card.querySelector(`${SEL.cardTitle} ${SEL.useAiPill}`));

/** True when any card in the dialog hands its value to the AI. */
export const dialogUsesAi = (dialog: Element): boolean =>
  [...dialog.querySelectorAll(SEL.card)].some(usesAi);

// --- AI instructions ------------------------------------------------------------

/**
 * Flattens the Instructions rich-text editor to plain text: one line per
 * paragraph, "- " per list item, object pills inline by name. The pills' gids
 * are listed separately so an agent can resolve "Help Pages" unambiguously.
 */
export function readInstructions(editor: Element): AiInstructions {
  const references: ObjectRef[] = [];
  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    if (node.matches(SEL.objectPill)) {
      // Not textContent: the pill's icon <svg> carries a <title>.
      const name = [...node.childNodes].map(inline).join("").replace(/\s+/g, " ").trim();
      const gid = node.getAttribute("data-object-id") ?? "";
      const type =
        node
          .querySelector('[class*="WorkGraphObjectPill--"]')
          ?.className.match(/WorkGraphObjectPill--(?!medium|small|large|contents)([a-z]+)/)?.[1] ??
        "object";
      if (name && gid && !references.some((r) => r.gid === gid)) {
        references.push({ type, name, gid });
      }
      return name;
    }
    if (node.tagName.toLowerCase() === "svg") return "";
    return [...node.childNodes].map(inline).join("");
  };
  const lines: string[] = [];
  const block = (el: Element) => {
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      if (tag === "ol" || tag === "ul") {
        block(child);
      } else if (tag === "li") {
        const depth = Math.max(Number(child.getAttribute("data-list-indent") ?? "1") - 1, 0);
        const [head, ...nested] = [...child.children];
        if (head) lines.push(`${"  ".repeat(depth)}- ${inline(head).replace(/\s+/g, " ").trim()}`);
        nested.forEach(block);
      } else {
        lines.push(inline(child).replace(/\s+/g, " ").trim());
      }
    }
  };
  block(editor);
  return {
    text: lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    references,
  };
}

// --- Cards --------------------------------------------------------------------

export function describeCard(card: Element, expanded: Expanded): Entry | null {
  const title = card.querySelector(SEL.cardTitle);
  if (!title) return null;
  const entry: Entry = {
    text: readText(title),
    pills: pillTexts(card),
    hasField: Boolean(card.querySelector(`${SEL.cardTitle} ${SEL.fieldPill}`)),
  };
  const field = card.querySelector(`${SEL.cardTitle} ${SEL.fieldPillLabel}`)?.textContent?.trim();
  if (field) entry.field = field;
  if (usesAi(card)) entry.useAi = true;

  const values = expanded.values.get(card);
  const hidden = truncatedBy(card);
  if (values) {
    entry.values = values;
  } else if (hidden) {
    entry.incomplete = true;
    entry.hiddenValueCount = hidden;
  }

  const people = collaborators(card, expanded);
  if (people) {
    entry.people = people;
    if (!Array.isArray(people)) entry.incomplete = true;
    const gids = peopleGidsIn(card);
    if (gids.length) entry.gids = gids;
    // A name and a gid are only known to belong to the same person when Asana
    // renders them together in one avatar-and-name node (single collaborator).
    // Pane names and card avatars are independent lists in unrelated order.
    entry.gidsPaired = Boolean(
      Array.isArray(people) &&
      !expanded.names.has(card) &&
      people.length === 1 &&
      card.querySelectorAll(SEL.people).length === 1 &&
      gids.length === 1,
    );
  }
  return entry;
}

/**
 * Asana nests the flowchart differently depending on whether a rule branches,
 * so grouping by container breaks on simple rules. Every card carries a kind
 * label ("When" / "Check if" / "Otherwise if" / "Do this"), on the card or on
 * the multi-config card wrapping it. Walk cards in document order, group by that.
 */
export function cardKind(card: Element): string | null {
  const own = card.querySelector(SEL.cardKind)?.textContent?.trim();
  if (own) return own;
  const group = card.closest(SEL.multiCard);
  return group?.querySelector(SEL.multiCardHeader)?.textContent?.trim() ?? null;
}

/** And/Or renders once per group; carried onto later entries as a text prefix. */
function joinerFor(card: Element): string | null {
  const group = card.closest(SEL.multiCard);
  return group?.querySelector(SEL.evaluationType)?.textContent?.trim().toUpperCase() ?? null;
}

function withJoiner(card: Element, entry: Entry): Entry {
  const joiner = joinerFor(card);
  return joiner ? { ...entry, text: `${joiner} ${entry.text}` } : entry;
}

export function extractFlow(
  dialog: Element,
  expanded: Expanded,
): Pick<RawRule, "when" | "branches"> {
  const when: Entry[] = [];
  const branches: RawBranch[] = [];
  let seenKind: string | null = null;
  let seenGroup: Element | null = null;

  for (const card of dialog.querySelectorAll(SEL.card)) {
    const kind: string | null = cardKind(card) ?? seenKind;
    const group = card.closest(SEL.multiCard);
    if (kind === "Otherwise") {
      // The catch-all else path: a card with no condition (and possibly no
      // title). It starts a branch on its own.
      branches.push({ kind, if: [], do: [] });
      seenKind = kind;
      seenGroup = group;
      continue;
    }
    const entry = describeCard(card, expanded);
    if (!entry) continue;

    if (kind === "When") {
      when.push(when.length ? withJoiner(card, entry) : entry);
    } else if (kind === "Check if" || kind === "Otherwise if") {
      // Extra AND/OR conditions of one branch share a multi-config group with
      // the branch's first condition. Anything else is a new branch, including
      // two consecutive "Otherwise if" branches that both have no actions.
      const current = branches.at(-1);
      const continues =
        current && seenKind === kind && group !== null && group === seenGroup && current.if.length;
      if (continues) current.if.push(withJoiner(card, entry));
      else branches.push({ kind, if: [entry], do: [] });
    } else if (kind === "Do this") {
      // A rule with no conditions still has actions: give them a branch with an
      // empty `if` rather than dropping them.
      let current = branches.at(-1);
      if (!current) {
        current = { kind: null, if: [], do: [] };
        branches.push(current);
      }
      current.do.push(entry);
    }
    if (kind) seenKind = kind;
    seenGroup = group;
  }
  return { when, branches };
}

export function extractRule(
  dialog: Element,
  expanded: Expanded,
  url: string,
  aiInstructions?: AiInstructions | null,
): RawRule {
  const text = (selector: string) => dialog.querySelector(selector)?.textContent?.trim() ?? null;
  return {
    ...(aiInstructions ? { aiInstructions } : {}),
    id: new URL(url).pathname.match(/\/rules\/(\d+)/)?.[1] ?? null,
    name: dialog.querySelector<HTMLInputElement>(SEL.ruleName)?.value?.trim() ?? null,
    project: text(SEL.containerName),
    status: text(SEL.status),
    lastRun: text(SEL.lastRun),
    ...extractFlow(dialog, expanded),
  };
}

// --- Dialog state -----------------------------------------------------------------

export const placeholderCount = (dialog: Element): number =>
  dialog.querySelectorAll(SEL.placeholderPill).length;

/** Asana enables Save only when the rule is dirty. This tool must never see that. */
export function isDirty(dialog: Element): boolean {
  const save = dialog.querySelector(SEL.saveButton);
  return Boolean(save && save.getAttribute("aria-disabled") !== "true");
}
