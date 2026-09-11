import { describe, expect, it } from "vitest";
import { dataUrl, runDir, runFiles, slug } from "../src/lib/run-files";
import type { RunRecord } from "../src/lib/types";

const record: RunRecord = {
  mode: "all",
  finishedAt: "2026-09-08T10:00:00.123Z",
  url: "https://app.asana.com/x",
  version: "3.0.0",
  result: { project: "P", rules: [] },
  log: ["a", "b"],
  snapshots: [
    { name: "Route Tasks", digest: "d1", html: "<b>1</b>" },
    { name: null, digest: "d2", html: "<b>2</b>" },
  ],
};

describe("run files", () => {
  it("names one folder per run with a filesystem-safe timestamp", () => {
    expect(runDir(record)).toBe("2026-09-08T10-00-00-123Z");
  });

  it("writes rules, log, metadata and one digest+html per snapshot", () => {
    expect(runFiles(record).map((f) => f.name)).toEqual([
      "rules.json",
      "run.txt",
      "run.json",
      "dom/01-route-tasks.digest.txt",
      "dom/01-route-tasks.html",
      "dom/02-rule.digest.txt",
      "dom/02-rule.html",
    ]);
    const meta = JSON.parse(runFiles(record)[2].text);
    expect(meta.snapshots).toEqual(["Route Tasks", null]);
  });

  it("slugs safely", () => {
    expect(slug("  Route Tasks by Area!! ")).toBe("route-tasks-by-area");
    expect(slug(null, "project")).toBe("project");
  });

  it("round-trips multi-byte text through the data URL", () => {
    const url = dataUrl("⭐ héllo", "text/plain");
    const [, b64] = url.split("base64,");
    expect(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))).toBe(
      "⭐ héllo",
    );
  });
});
