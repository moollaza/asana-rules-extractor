import { renderReview } from "../../src/lib/review";
import { slug } from "../../src/lib/run-files";
import type {
  ContentRequest,
  Response,
  Result,
  RunOutcome,
  StateResponse,
} from "../../src/lib/types";
import { isFailed, isRuleSet, rulesOf } from "../../src/lib/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const allButton = $<HTMLButtonElement>("all");
const oneButton = $<HTMLButtonElement>("one");
const status = $<HTMLParagraphElement>("status");
const output = $<HTMLTextAreaElement>("output");
const review = $<HTMLDivElement>("review");
const viewTabs = $<HTMLDivElement>("view-tabs");
const reviewTab = $<HTMLButtonElement>("tab-review");
const jsonTab = $<HTMLButtonElement>("tab-json");
// Several copies can be installed side by side (each dragged zip is a new
// extension), so the popup says which build it is.
$("version").textContent = `v${chrome.runtime.getManifest().version}`;
const resultActions = $<HTMLDivElement>("result-actions");
const copyButton = $<HTMLButtonElement>("copy");
const saveButton = $<HTMLButtonElement>("save");
const clearButton = $<HTMLButtonElement>("clear");
const dumpButton = $<HTMLButtonElement>("dump");
const downloadButton = $<HTMLButtonElement>("download");

let payload: { text: string; filename: string } | null = null;
// Overlapping connect() calls must not both inject; one in-flight per tab.
const connecting = new Map<number, Promise<void>>();
// A click within this window of starting a run is a double-click, not Stop.
const STOP_GUARD_MS = 800;
let runStartedAt = 0;
let fullHtml: string | null = null;
let running = false;
// Which panel shows when a result is on screen. The digest has no review form.
let view: "review" | "json" = "review";
let hasReview = false;

const MIME: Record<string, string> = {
  json: "application/json",
  html: "text/html",
  txt: "text/plain",
};

function setStatus(text: string, kind: "ok" | "warn" | "error" | "" = "") {
  status.textContent = text;
  status.className = `status ${kind ? `status-${kind}` : ""}`;
}

function applyView() {
  const showReview = hasReview && view === "review";
  review.hidden = !showReview;
  output.hidden = showReview;
  viewTabs.hidden = !hasReview;
  reviewTab.setAttribute("aria-selected", String(showReview));
  jsonTab.setAttribute("aria-selected", String(!showReview));
}

function showText(text: string, filename: string) {
  output.value = text;
  payload = { text, filename };
  hasReview = false;
  review.replaceChildren();
  applyView();
  resultActions.hidden = false;
}

function hideOutput() {
  output.hidden = true;
  review.hidden = true;
  viewTabs.hidden = true;
  resultActions.hidden = true;
  downloadButton.hidden = true;
}

function showResult(result: Result) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const filename = isRuleSet(result)
    ? `${slug(result.project, "asana")}-rules-${stamp}.json`
    : `${slug(result.name)}-rule-${stamp}.json`;
  showText(JSON.stringify(result, null, 2), filename);
  review.replaceChildren(renderReview(result));
  hasReview = true;
  applyView();
}

// Chrome only writes inside the downloads folder; saveAs lets the user pick.
// The blob type has to agree with the extension or Chrome rewrites it.
// download() resolves when the download is queued, not when the blob has been
// read (saveAs waits on the file picker), so revoke only once it completes.
async function saveFile(text: string, filename: string) {
  const type = MIME[filename.split(".").pop() ?? ""] ?? "text/plain";
  const url = URL.createObjectURL(new Blob([text], { type }));
  const id = await chrome.downloads.download({ url, filename, saveAs: true });
  const onChanged = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id !== id || !delta.state || delta.state.current === "in_progress") return;
    chrome.downloads.onChanged.removeListener(onChanged);
    URL.revokeObjectURL(url);
  };
  chrome.downloads.onChanged.addListener(onChanged);
}

function setRunning(isRunning: boolean) {
  running = isRunning;
  allButton.innerHTML = isRunning
    ? '<span class="btn-icon" aria-hidden="true">■</span> Stop'
    : '<span class="btn-icon" aria-hidden="true">▶</span> Grab all rules';
  allButton.classList.toggle("btn-primary", !isRunning);
  allButton.classList.toggle("btn-danger", isRunning);
  oneButton.disabled = isRunning;
}

async function activeAsanaTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url?.startsWith("https://app.asana.com/") ? tab : null;
}

// Injected on demand so an already-open tab needs no reload. Injecting twice
// would re-register the listener and reset run state, so ping first.
function connect(tabId: number): Promise<void> {
  const pending = connecting.get(tabId);
  if (pending) return pending;
  const task = connectOnce(tabId).finally(() => connecting.delete(tabId));
  connecting.set(tabId, task);
  return task;
}

async function connectOnce(tabId: number) {
  try {
    const reply = (await chrome.tabs.sendMessage(tabId, { type: "ping" })) as Response<object>;
    if (reply?.ok) return;
  } catch (err) {
    // Only "no listener" means it is safe to inject. Anything else (tab mid-
    // navigation, transient failure) must not re-inject over a live run.
    if (!/Receiving end does not exist/i.test(String((err as Error)?.message ?? err))) throw err;
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["/grabber.js"] });
}

async function send<T extends object>(
  request: ContentRequest,
): Promise<(Response<T> & { ok: true }) | null> {
  const tab = await activeAsanaTab();
  if (!tab?.id) {
    setStatus("Not an Asana tab. Open your project first.", "error");
    return null;
  }
  await connect(tab.id);
  const response = (await chrome.tabs.sendMessage(tab.id, request)) as Response<T>;
  if (!response?.ok) throw new Error(response?.error ?? "No response from the page");
  return response;
}

// When the popup attaches to a grab it did not start (reopened mid-run, or
// Stop pressed from a reopened popup), nothing awaits the walk. Poll state
// until the page reports it finished, then render the outcome once.
let watching = false;
async function watchRun(tabId: number) {
  if (watching) return;
  watching = true;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 500));
      const state = (await chrome.tabs.sendMessage(tabId, {
        type: "state",
      })) as Response<StateResponse>;
      if (!state?.ok) return;
      if (state.running) {
        setStatus(state.log.at(-1) ?? "Working…");
        continue;
      }
      setRunning(false);
      const stopped = state.stopped;
      if (state.result) report({ result: state.result, stopped });
      else setStatus(stopped ? "Stopped before anything was read." : "Finished.", "warn");
      return;
    }
  } finally {
    watching = false;
  }
}

function report({ result, stopped, alreadyRunning }: RunOutcome) {
  if (alreadyRunning) {
    setStatus("A grab is already running on this tab. Watch the overlay, or press Stop.", "warn");
    setRunning(true);
    return;
  }
  if (!result) {
    setStatus(stopped ? "Stopped before anything was read." : "Nothing returned.", "warn");
    return;
  }
  const rules = rulesOf(result);
  const failed = rules.filter(isFailed).length;
  const suspect = rules.filter((r) => !isFailed(r) && r.warnings?.length).length;
  const parts = [
    `${stopped ? "Stopped after" : "Got"} ${rules.length} rule${rules.length === 1 ? "" : "s"}`,
    failed ? `${failed} failed` : "",
    suspect ? `${suspect} suspect, see "warnings"` : "",
  ].filter(Boolean);
  setStatus(parts.join(", "), failed || suspect || stopped ? "error" : "ok");
  showResult(result);
}

// Errors only report; whether a grab is running is decided by the grab
// handlers themselves, so a failed Dump or Copy cannot hide Stop mid-run.
async function guard(work: () => Promise<void> | void) {
  try {
    await work();
  } catch (err) {
    setStatus((err as Error)?.message ?? String(err), "error");
  }
}

allButton.addEventListener("click", () =>
  guard(async () => {
    if (running) {
      if (Date.now() - runStartedAt < STOP_GUARD_MS) return; // double-click
      await send({ type: "stop" });
      setStatus("Stopping…", "warn");
      const tab = await activeAsanaTab();
      if (tab?.id) void watchRun(tab.id);
      return;
    }
    hideOutput();
    runStartedAt = Date.now();
    setRunning(true);
    setStatus("Working. Watch the overlay on the page; you can close this popup.");
    try {
      const response = await send<RunOutcome>({ type: "readAllRules" });
      if (response) report(response);
    } finally {
      setRunning(false);
    }
  }),
);

oneButton.addEventListener("click", () =>
  guard(async () => {
    hideOutput();
    // A single read can take a while (side panes, Instructions card), so it
    // gets the same Stop affordance as a full walk: the primary button.
    runStartedAt = Date.now();
    setRunning(true);
    setStatus("Reading the open rule…");
    try {
      const response = await send<RunOutcome>({ type: "readOpenRule" });
      if (response) report(response);
    } finally {
      setRunning(false);
    }
  }),
);

reviewTab.addEventListener("click", () => {
  view = "review";
  applyView();
});
jsonTab.addEventListener("click", () => {
  view = "json";
  applyView();
});

copyButton.addEventListener("click", () =>
  guard(async () => {
    await navigator.clipboard.writeText(output.value);
    copyButton.textContent = "Copied ✓";
    setTimeout(() => (copyButton.textContent = "Copy"), 1500);
  }),
);

saveButton.addEventListener("click", () =>
  guard(async () => {
    if (!payload) return;
    await saveFile(payload.text, payload.filename);
    setStatus(`Saved ${payload.filename}`, "ok");
  }),
);

clearButton.addEventListener("click", () =>
  guard(async () => {
    output.value = "";
    review.replaceChildren();
    hasReview = false;
    payload = fullHtml = null;
    hideOutput();
    const response = await send<{ refused?: boolean }>({ type: "clear" });
    if (response?.refused) {
      setStatus("A grab is running; stop it before clearing.", "warn");
      setRunning(true);
      return;
    }
    setStatus("Cleared.");
  }),
);

dumpButton.addEventListener("click", () =>
  guard(async () => {
    hideOutput();
    setStatus("Reading the DOM…");
    const response = await send<{ digest: string; html: string }>({ type: "dump" });
    if (!response) return;
    fullHtml = response.html;
    setStatus(`Digest ready (${Math.round(response.html.length / 1024)} KB of HTML).`, "ok");
    showText(response.digest, "asana-dom-digest.txt");
    downloadButton.hidden = false;
  }),
);

downloadButton.addEventListener("click", () =>
  guard(() => saveFile(fullHtml ?? "", "asana-rule-dialog.html")),
);

// Reopening the popup mid-run shows live state, not a blank slate. If the user
// clicks Grab while this fetch is in flight, the fetch result is stale: drop it.
guard(async () => {
  const openedAt = Date.now();
  const tab = await activeAsanaTab();
  if (!tab?.id) {
    setStatus("Open your Asana project, then grab.");
    return;
  }
  await connect(tab.id);
  const state = (await chrome.tabs.sendMessage(tab.id, {
    type: "state",
  })) as Response<StateResponse>;
  if (!state?.ok || runStartedAt >= openedAt) return;
  setRunning(state.running);
  if (state.running) {
    setStatus(state.log.at(-1) ?? "Working…");
    void watchRun(tab.id);
  } else if (state.result) report({ result: state.result, stopped: state.stopped });
  else setStatus("Ready.");
});
