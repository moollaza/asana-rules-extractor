// A text digest of the dialog DOM, small enough to read in a chat, saved with
// every run so a bad extraction can be debugged without a fresh paste.
import { isCollapsed, peopleGidsIn, pillTexts, readText } from "./extract";
import { SEL } from "./selectors";

function describeNode(el: Element): string {
  const classes = [...el.classList]
    .filter((c) => !/^(Stack|Box|Surface|HighlightSol|Typography)_/.test(c))
    .join(".");
  return `${el.tagName.toLowerCase()}${classes ? "." + classes : ""}`;
}

export function dumpDigest(doc: Document, url: string): string {
  const dialog = doc.querySelector(SEL.dialog);
  const lines = [`url: ${url}`, `dialog: ${dialog ? "found" : "MISSING"}`];
  if (!dialog) {
    const rows = [...doc.querySelectorAll(SEL.ruleRow)];
    lines.push("", `rule rows in pane: ${rows.length}`);
    rows.forEach((r) =>
      lines.push(`  row: ${r.querySelector(SEL.ruleRowName)?.textContent?.trim()}`),
    );
    return lines.join("\n");
  }

  for (const [key, selector] of Object.entries(SEL)) {
    lines.push(`SEL.${key} -> ${dialog.querySelectorAll(selector).length}`);
  }

  lines.push("", "cards in document order:");
  dialog.querySelectorAll(SEL.card).forEach((card, i) => {
    const own = card.querySelector(SEL.cardKind)?.textContent?.trim() ?? "";
    const group = card.closest(SEL.multiCard);
    const header = group?.querySelector(SEL.multiCardHeader)?.textContent?.trim() ?? "";
    const joiner = group?.querySelector(SEL.evaluationType)?.textContent?.trim() ?? "";
    const title = card.querySelector(SEL.cardTitle);
    lines.push(
      `  [${i}] ownKind=${JSON.stringify(own)} groupHeader=${JSON.stringify(header)}` +
        ` joiner=${JSON.stringify(joiner)} collapsed=${isCollapsed(card)}`,
      `       text=${JSON.stringify(title ? readText(title) : null)}`,
      `       pills=${JSON.stringify(pillTexts(card))} gids=${JSON.stringify(peopleGidsIn(card))}`,
    );
  });

  const pane = doc.querySelector(SEL.pane);
  lines.push("", `side pane: ${pane ? describeNode(pane) : "MISSING"}`);
  if (pane) {
    lines.push(`  children: ${[...pane.children].map(describeNode).join(", ") || "(empty)"}`);
    lines.push(`  text: ${JSON.stringify(pane.textContent?.trim().slice(0, 300))}`);
  }
  return lines.join("\n");
}

export function dumpHtml(doc: Document): string {
  const dialog = doc.querySelector(SEL.dialog);
  const pane = doc.querySelector(SEL.pane);
  return [
    dialog ? `<!-- dialog -->\n${dialog.outerHTML}` : "<!-- no dialog -->",
    pane ? `\n\n<!-- side pane -->\n${pane.outerHTML}` : "",
  ].join("");
}
