// Injected on demand by the popup (chrome.scripting.executeScript), so an
// already-open Asana tab needs no reload. Owns the run: opens the Rules pane,
// walks every rule, expands truncated lists by clicking cards, reads the DOM,
// and reports progress on an on-page overlay because the popup closes as soon
// as the page is clicked.
//
// Read-only by construction: the only DOM interactions are clicking rule rows,
// cards, the pane/dialog close buttons, the Instructions toolbar button (and its
// Minimize) and the empty canvas, plus Escape.
// Nothing types, picks a typeahead option or touches Save.
import { dumpDigest, dumpHtml } from "../src/lib/digest";
import {
  type Expanded,
  dialogUsesAi,
  emptyExpanded,
  extractRule,
  isDirty,
  needsExpanding,
  placeholderCount,
  readInstructions,
  readText,
  truncatedBy,
} from "../src/lib/extract";
import { SEL } from "../src/lib/selectors";
import { auditRule, shapeRule, untypedCount } from "../src/lib/shape";
import type {
  AiInstructions,
  ContentRequest,
  FailedRule,
  Response,
  Result,
  Rule,
  RunOutcome,
  RunRecord,
  Snapshot,
  StateResponse,
} from "../src/lib/types";
import { rulesOf, isFailed } from "../src/lib/types";

type Kind = "ok" | "warn" | "error" | undefined;

class Stopped extends Error {
  constructor() {
    super("Stopped");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const paneOpen = () => {
  const pane = document.querySelector(SEL.pane);
  return Boolean(pane && pane.childElementCount > 0);
};

function panePills(): string[] | null {
  const pane = document.querySelector(SEL.pane);
  if (!pane) return null;
  // Same exclusion as pillTexts: a field-name pill ("Area") is not a value.
  const pills = [...pane.querySelectorAll(SEL.panePill)]
    .filter((pill) => !pill.closest(SEL.fieldPill) && !pill.querySelector(SEL.fieldPillLabel))
    .map((pill) => pill.textContent?.replace(/[×✕✖]/g, "").trim() ?? "")
    .filter(Boolean);
  return pills.length ? pills : null;
}

function pressEscape() {
  for (const target of [document.activeElement, document.body]) {
    target?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }),
    );
  }
}

const ruleRows = () => [...document.querySelectorAll<HTMLElement>(SEL.ruleRow)];
const rowName = (row: Element) => row.querySelector(SEL.ruleRowName)?.textContent?.trim() ?? "";

/** Hoist the project name once and drop it from each rule. */
function finishRuleSet(rules: (Rule | FailedRule)[]): Result {
  const project = rules.find((r): r is Rule => !isFailed(r) && Boolean(r.project))?.project ?? null;
  return { project, rules: rules.map((r) => (isFailed(r) ? r : { ...r, project: undefined })) };
}

// Unlisted (not declared in the manifest): the popup injects it with
// chrome.scripting.executeScript, so it loads only on demand.
export default defineUnlistedScript(() => {
  const run = {
    active: false,
    stopRequested: false,
    result: null as Result | null,
    stopped: false,
    log: [] as string[],
    snapshots: [] as Snapshot[],
    startedAt: null as Date | null,
  };

  const checkStop = () => {
    if (run.stopRequested) throw new Stopped();
  };

  // Background tabs get their timers throttled, so every wait is generous, and
  // every wait aborts as soon as a stop is requested.
  async function waitFor<T>(
    predicate: () => T | null | false | undefined,
    { timeout = 8000, interval = 100 } = {},
  ): Promise<T | null> {
    const deadline = Date.now() + timeout;
    for (;;) {
      checkStop();
      const value = predicate();
      if (value) return value;
      if (Date.now() >= deadline) return null;
      await sleep(interval);
    }
  }

  // --- Overlay ----------------------------------------------------------------

  const overlay = (() => {
    const ID = "asana-rules-extractor";
    const root = document.createElement("div");
    root.id = ID;
    root.innerHTML = `
      <div class="arj-head">
        <strong class="arj-title">Asana Rules Extractor</strong>
        <button class="arj-stop" type="button" hidden>Stop</button>
        <button class="arj-hide" type="button" aria-label="Hide">&times;</button>
      </div>
      <ol class="arj-log"></ol>`;
    const lines = root.querySelector<HTMLOListElement>(".arj-log")!;
    const stop = root.querySelector<HTMLButtonElement>(".arj-stop")!;
    stop.addEventListener("click", () => {
      run.stopRequested = true;
      log("Stop requested…");
    });
    root.querySelector(".arj-hide")!.addEventListener("click", () => root.remove());

    // Styles ride along inline: an extension-relative stylesheet URL breaks when
    // the extension is reloaded while an older copy of this script is on a page.
    const CSS = `
      #${ID} { position: fixed; bottom: 12px; right: 12px; z-index: 2147483647;
        display: flex; flex-direction: column; width: 380px; max-height: 60vh;
        font: 12px/1.45 ui-monospace, Menlo, monospace; color: rgba(255,255,255,.96);
        background: #1c1c1c; border-radius: 12px; box-shadow: 0 8px 24px rgb(0 0 0 / .35); }
      #${ID} .arj-head { display: flex; align-items: center; gap: 6px; padding: 8px 12px;
        border-bottom: 1px solid rgba(255,255,255,.09); }
      #${ID} .arj-title { flex: 1; font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif; }
      #${ID} button { padding: 4px 10px; font: 600 12px -apple-system, BlinkMacSystemFont, sans-serif;
        color: inherit; background: rgba(255,255,255,.12); border: 0; border-radius: 999px; cursor: pointer; }
      #${ID} button:hover { background: rgba(255,255,255,.18); }
      #${ID} .arj-stop { background: #ff5359; color: #000; }
      #${ID} .arj-hide { background: transparent; padding: 4px 8px; }
      #${ID} .arj-log { flex: 1; overflow-y: auto; margin: 0; padding: 8px 12px; list-style: none; }
      #${ID} .arj-log li { padding: 1px 0; white-space: pre-wrap; word-break: break-word; }
      #${ID} .arj-ok { color: #6fcf97; } #${ID} .arj-warn { color: #f2c94c; } #${ID} .arj-error { color: #ff8b7d; }`;

    return {
      show() {
        if (!document.getElementById(`${ID}-style`)) {
          const style = document.createElement("style");
          style.id = `${ID}-style`;
          style.textContent = CSS;
          document.head.appendChild(style);
        }
        if (!root.isConnected) document.body.appendChild(root);
      },
      append(text: string, kind: Kind) {
        const item = document.createElement("li");
        item.textContent = text;
        if (kind) item.className = `arj-${kind}`;
        lines.appendChild(item);
        lines.scrollTop = lines.scrollHeight;
      },
      reset: () => lines.replaceChildren(),
      hide() {
        root.remove();
        lines.replaceChildren();
      },
      setRunning: (running: boolean) => (stop.hidden = !running),
    };
  })();

  function log(text: string, kind?: Kind) {
    run.log.push(`${new Date().toISOString()} ${text}`);
    console.log("[asana-rules-extractor]", text);
    overlay.append(text, kind);
  }

  // --- Side pane --------------------------------------------------------------

  // If the pane from the previous card is still up when the next one is clicked,
  // a wait for "pane has pills" is satisfied by the stale pane and the second
  // card inherits the first card's names. So the pane must be provably closed
  // before each click; a pane that won't close is reported, not read.
  async function ensurePaneClosed(): Promise<boolean> {
    if (!paneOpen()) return true;
    const attempts = [
      () => document.querySelector<HTMLElement>(`${SEL.pane} ${SEL.paneClose}`)?.click(),
      pressEscape,
      () => document.querySelector<HTMLElement>(SEL.canvasScroller)?.click(),
    ];
    for (const attempt of attempts) {
      attempt();
      if (await waitFor(() => !paneOpen(), { timeout: 1500 })) return true;
    }
    return false;
  }

  // Cards that collapse people to avatars, or enum lists to "+N", only render
  // the full list in the side pane after a click. Open each, read, close.
  async function expandTruncatedCards(dialog: Element): Promise<Expanded> {
    const expanded = emptyExpanded();
    const cards = [...dialog.querySelectorAll<HTMLElement>(SEL.card)].filter(needsExpanding);
    const scroller = document.querySelector(SEL.canvasScroller);
    const scroll = { top: scroller?.scrollTop ?? 0, left: scroller?.scrollLeft ?? 0 };

    for (const card of cards) {
      checkStop();
      const hidden = truncatedBy(card);
      if (!(await ensurePaneClosed())) {
        log("  · side pane stuck open, skipping to avoid stale values", "error");
        continue;
      }
      card.click();
      await waitFor(paneOpen, { timeout: 3000 });
      const pills = await waitFor(panePills, { timeout: 3000 });
      if (!pills) {
        log(
          `  · side pane unreadable, ${hidden ? `+${hidden} values` : "names"} still hidden`,
          "error",
        );
      } else if (hidden) {
        expanded.values.set(card, pills);
        log(`  · expanded ${pills.length} values (badge said +${hidden})`);
      } else {
        expanded.names.set(card, pills);
        log(`  · collaborators: ${pills.join(", ")}`);
      }
      if (!(await ensurePaneClosed())) log("  · side pane would not close", "error");
    }
    if (scroller) {
      scroller.scrollTop = scroll.top;
      scroller.scrollLeft = scroll.left;
    }
    return expanded;
  }

  // --- AI instructions --------------------------------------------------------

  // A "Use AI" pill means the value is chosen at run time from the rule's
  // Instructions, a floating card on the canvas that is usually minimized. Open
  // it via the toolbar button only when a card needs it, read it, put it back.
  async function readAiInstructions(): Promise<AiInstructions | null> {
    const editor = () => document.querySelector(SEL.aiGuidanceEditor);
    const wasOpen = Boolean(editor());
    if (!wasOpen) {
      const button = document.querySelector<HTMLElement>(SEL.aiGuidanceButton);
      if (!button) {
        log("  · Instructions button not found; AI instructions not read", "error");
        return null;
      }
      button.click();
      await waitFor(() => document.querySelector(SEL.aiGuidanceCard), { timeout: 3000 });
      // The card remembers its last tab; "Chat" has no editor to read.
      if (!editor()) {
        [...document.querySelectorAll<HTMLElement>(SEL.aiGuidanceTab)]
          .find((tab) => readText(tab) === "Instructions")
          ?.click();
      }
      if (!(await waitFor(editor, { timeout: 3000 }))) {
        log("  · Instructions card did not open; AI instructions not read", "error");
        return null;
      }
    }
    // The editor mounts before its text streams in; hold until it stops changing.
    let last: string | null = null;
    await waitFor(
      () => {
        const now = editor()?.textContent ?? "";
        const stable = now === last && now.length > 0;
        last = now;
        return stable;
      },
      { timeout: 4000, interval: 250 },
    );
    const instructions = readInstructions(editor()!);
    log(`  · AI instructions: ${instructions.text.split("\n")[0].slice(0, 80)}…`);
    if (!wasOpen) {
      document.querySelector<HTMLElement>(SEL.aiGuidanceMinimize)?.click();
      await waitFor(() => !editor(), { timeout: 1500 });
    }
    return instructions;
  }

  // --- Reading one rule -------------------------------------------------------

  // The dialog appears before its referenced objects resolve; until then cards
  // show an "Unspecified" placeholder. Wait for placeholders to clear and card
  // text to hold still.
  async function waitForHydration(dialog: Element) {
    let last: string | null = null;
    let stableSince = 0;
    const settled = await waitFor(
      () => {
        // No cards yet means the flowchart has not mounted; never call that stable.
        if (placeholderCount(dialog) || !dialog.querySelector(SEL.card)) {
          stableSince = 0;
          return false;
        }
        const now = [...dialog.querySelectorAll(SEL.cardTitle)].map((t) => t.textContent).join("|");
        if (now !== last) {
          last = now;
          stableSince = Date.now();
          return false;
        }
        return Date.now() - stableSince >= 400;
      },
      { timeout: 15000, interval: 200 },
    );
    if (!settled) log("  · gave up waiting for the rule to finish loading", "warn");
  }

  async function readOpenRule(): Promise<Rule> {
    const dialog = document.querySelector(SEL.dialog);
    if (!dialog) throw new Error("No rule dialog open");
    await waitForHydration(dialog);
    const cardTexts = () => [...dialog.querySelectorAll(SEL.cardTitle)].map((t) => t.textContent);
    const before = cardTexts();
    const expanded = await expandTruncatedCards(dialog);
    const reordered = cardTexts().some((text, i) => text !== before[i]);
    const aiInstructions = dialogUsesAi(dialog) ? await readAiInstructions() : null;
    const raw = extractRule(dialog, expanded, location.href, aiInstructions);
    const shaped = shapeRule(raw);
    run.snapshots.push({
      name: raw.name,
      digest: dumpDigest(document, location.href),
      html: dumpHtml(document),
    });

    const problems = auditRule(raw, shaped, {
      cardsOnScreen: dialog.querySelectorAll(SEL.card).length,
      placeholders: placeholderCount(dialog),
      dirty: isDirty(dialog),
    });
    if (reordered) problems.push("cards changed order or text while side panes were open");
    const untyped = untypedCount(shaped);
    if (untyped) {
      shaped.untyped = untyped;
      log(
        `  · ${untyped} action${untyped === 1 ? "" : "s"} kept as plain text (no typed key yet)`,
        "warn",
      );
    }
    if (problems.length) {
      shaped.warnings = problems;
      log(`Read "${raw.name}": SUSPECT, ${problems.join("; ")}`, "error");
    } else {
      log(`Read "${raw.name}": ${raw.branches.length} branches, all cards captured`, "ok");
    }
    return shaped;
  }

  // --- Walking every rule -----------------------------------------------------

  // The rules list lives behind Customize -> Rules. Idempotent, so it doubles
  // as recovery if the pane closes mid-walk.
  async function openRulesPane(): Promise<boolean> {
    if (ruleRows().length) return true;
    if (!document.querySelector(SEL.customizeHome)) {
      document.querySelector<HTMLElement>(SEL.customizeButton)?.click();
      await waitFor(() => document.querySelector(SEL.customizeHome) || ruleRows().length);
    }
    if (ruleRows().length) return true;
    const drilldown = [...document.querySelectorAll<HTMLElement>(SEL.drilldownRow)].find(
      (row) => /^Rules\b/.test(readText(row)), // "Rules 13", not "Rules13"
    );
    if (!drilldown) return false;
    drilldown.click();
    return Boolean(await waitFor(() => ruleRows().length));
  }

  // Closing has to actually happen or the walk re-reads the same rule.
  async function closeDialog(): Promise<boolean> {
    const dialog = document.querySelector(SEL.dialog);
    if (!dialog) return true;
    dialog.querySelector<HTMLElement>(SEL.closeDialog)?.click();
    if (await waitFor(() => !document.querySelector(SEL.dialog), { timeout: 2000 })) return true;
    log("  · close button did nothing, pressing Escape", "warn");
    pressEscape();
    return Boolean(await waitFor(() => !document.querySelector(SEL.dialog), { timeout: 3000 }));
  }

  async function readAllRules(): Promise<Result> {
    if (!(await openRulesPane())) throw new Error("Could not open the Rules pane");

    // Rows are re-created as the pane re-renders, so drive by name and re-query.
    // Two rules may share a name, so address the Nth row with that name.
    const names = ruleRows().map(rowName);
    const nth = names.map((name, i) => names.slice(0, i).filter((n) => n === name).length);
    log(`Found ${names.length} rules`);
    const rules: (Rule | FailedRule)[] = [];
    const fail = (name: string, error: string) => {
      rules.push({ name, error });
      log(`  · ${error}`, "error");
    };
    // A walk that has to stop early must not look like a clean finish: every
    // rule not reached gets a failed entry so the count and colour say so.
    const abandon = (from: number, reason: string) => {
      log(`  · ${reason}; ${names.length - from} rule(s) not read`, "error");
      for (const name of names.slice(from)) rules.push({ name, error: `not read: ${reason}` });
    };

    // Expose the partial list as the run result as it grows, so a Stop (which
    // throws out of this loop) still leaves the rules already read in place.
    run.result = { project: null, rules };
    for (const [index, name] of names.entries()) {
      checkStop();
      log(`[${index + 1}/${names.length}] ${name}`);
      if (!(await openRulesPane())) {
        abandon(index, "rules pane closed and would not reopen");
        break;
      }
      const row = ruleRows().filter((r) => rowName(r) === name)[nth[index]];
      if (!row) {
        fail(name, "row not found");
        continue;
      }
      (row.querySelector<HTMLElement>('[role="listitem"]') ?? row).click();

      // Wait for *this* rule's dialog, or a dialog that failed to close reads as
      // success and the same rule is scraped twice.
      const dialog = await waitFor(() => {
        const el = document.querySelector(SEL.dialog);
        return el?.querySelector<HTMLInputElement>(SEL.ruleName)?.value?.trim() === name
          ? el
          : null;
      });
      if (!dialog) {
        fail(name, "dialog did not open for this rule");
        await closeDialog();
        continue;
      }
      try {
        rules.push(await readOpenRule());
      } catch (err) {
        if (err instanceof Stopped) {
          await closeDialog().catch(() => undefined);
          throw err;
        }
        fail(name, String((err as Error)?.message ?? err));
      }
      if (!(await closeDialog())) {
        abandon(index + 1, "previous rule's dialog would not close");
        break;
      }
    }

    return finishRuleSet(rules);
  }

  // --- Run lifecycle ----------------------------------------------------------

  async function writeRunLog(mode: "all" | "one") {
    const record: RunRecord = {
      mode,
      startedAt: run.startedAt?.toISOString(),
      finishedAt: new Date().toISOString(),
      url: location.href,
      version: chrome.runtime.getManifest().version,
      result: run.result,
      log: run.log,
      snapshots: run.snapshots,
    };
    try {
      const reply = (await chrome.runtime.sendMessage({
        type: "runFinished",
        record,
      })) as Response<{
        dir: string;
      }>;
      if (reply?.ok) log(`Log saved to Downloads/${reply.dir}`, "ok");
      else log(`Log NOT saved: ${reply?.error ?? "no reply from background"}`, "error");
    } catch (err) {
      log(`Log NOT saved: ${(err as Error)?.message ?? err}`, "error");
    }
  }

  async function start(mode: "all" | "one"): Promise<RunOutcome> {
    if (run.active) return { alreadyRunning: true, result: run.result };
    Object.assign(run, {
      active: true,
      stopped: false,
      stopRequested: false,
      result: null,
      log: [],
      snapshots: [],
      startedAt: new Date(),
    });
    overlay.show();
    overlay.reset();
    overlay.setRunning(true);
    try {
      run.result = mode === "all" ? await readAllRules() : await readOpenRule();
      const rules = rulesOf(run.result);
      const failed = rules.filter(isFailed).length;
      log(
        `Done: ${rules.length} rules${failed ? `, ${failed} failed` : ""}`,
        failed ? "warn" : "ok",
      );
      return { result: run.result };
    } catch (err) {
      if (err instanceof Stopped) {
        run.stopped = true;
        if (run.result && "rules" in run.result) run.result = finishRuleSet(run.result.rules);
        const kept = run.result ? rulesOf(run.result).length : 0;
        log(`Stopped, ${kept} rule${kept === 1 ? "" : "s"} kept`, "warn");
        return { stopped: true, result: run.result };
      }
      log(String((err as Error)?.message ?? err), "error");
      throw err;
    } finally {
      run.active = false;
      run.stopRequested = false;
      overlay.setRunning(false);
      await writeRunLog(mode);
    }
  }

  chrome.runtime.onMessage.addListener(
    (message: ContentRequest, _sender, respond: (r: Response<object>) => void) => {
      const handle = async (): Promise<object> => {
        switch (message?.type) {
          case "ping":
            return { url: location.href };
          case "dump":
            return { digest: dumpDigest(document, location.href), html: dumpHtml(document) };
          case "state":
            return {
              running: run.active,
              stopped: run.stopped,
              result: run.result,
              log: run.log,
            } satisfies StateResponse;
          case "clear":
            // Never drop a run in progress; the popup shows why.
            if (run.active) return { refused: true };
            Object.assign(run, { result: null, log: [], snapshots: [] });
            overlay.hide();
            return {};
          case "stop":
            run.stopRequested = true;
            return { stopping: run.active };
          case "readOpenRule":
            return start("one");
          case "readAllRules":
            return start("all");
          default:
            throw new Error(`Unknown request: ${(message as { type?: string })?.type}`);
        }
      };
      handle().then(
        (result) => respond({ ok: true, ...result }),
        (err: unknown) => {
          console.error("[asana-rules-extractor]", err);
          respond({ ok: false, error: String((err as Error)?.message ?? err) });
        },
      );
      return true;
    },
  );
});
