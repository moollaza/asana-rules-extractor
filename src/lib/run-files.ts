// Which files a finished run produces. Pure, so the background worker stays a
// thin loop over this list.
import type { RunRecord } from "./types";

export const ROOT = "asana-rules-extractor";

export function slug(text: string | null | undefined, fallback = "rule"): string {
  const out = (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return out || fallback;
}

export interface RunFile {
  name: string;
  text: string;
  type: string;
}

export function runFiles(record: RunRecord): RunFile[] {
  const files: RunFile[] = [
    { name: "rules.json", text: JSON.stringify(record.result, null, 2), type: "application/json" },
    { name: "run.txt", text: record.log.join("\n") + "\n", type: "text/plain" },
    {
      name: "run.json",
      text: JSON.stringify({ ...record, snapshots: record.snapshots.map((s) => s.name) }, null, 2),
      type: "application/json",
    },
  ];
  record.snapshots.forEach((snap, i) => {
    const base = `dom/${String(i + 1).padStart(2, "0")}-${slug(snap.name)}`;
    files.push({ name: `${base}.digest.txt`, text: snap.digest, type: "text/plain" });
    files.push({ name: `${base}.html`, text: snap.html, type: "text/html" });
  });
  return files;
}

export const runDir = (record: RunRecord): string => record.finishedAt.replace(/[:.]/g, "-");

/** Base64 data URL; service workers have no URL.createObjectURL. */
export function dataUrl(text: string, type: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${type};base64,${btoa(binary)}`;
}
