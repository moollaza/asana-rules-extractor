// Writes each finished run to Downloads/asana-rules-extractor/<timestamp>/ and
// mirrors it to Downloads/asana-rules-extractor/latest/ so an agent can read the
// most recent run from a fixed path. Runs here, not in the popup, because the
// popup is usually closed by the time a run ends.
import { ROOT, dataUrl, runDir, runFiles } from "../src/lib/run-files";
import type { BackgroundRequest, Response } from "../src/lib/types";

function download(dir: string, name: string, text: string, type: string, overwrite: boolean) {
  return chrome.downloads.download({
    url: dataUrl(text, type),
    filename: `${ROOT}/${dir}/${name}`,
    saveAs: false,
    conflictAction: overwrite ? "overwrite" : "uniquify",
  });
}

const LATEST_IDS = "latestDownloadIds";

// `latest/` is a per-file overwrite, so a shorter run would leave the previous
// run's extra dom/ snapshots behind. Remove last run's files first; the ids
// come from chrome.downloads, the only API allowed to delete what it wrote.
async function clearLatest() {
  const { [LATEST_IDS]: ids = [] } = await chrome.storage.local.get(LATEST_IDS);
  await Promise.all(
    (ids as number[]).map((id) => chrome.downloads.removeFile(id).catch(() => undefined)),
  );
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (message: BackgroundRequest, _sender, respond: (r: Response<{ dir: string }>) => void) => {
      if (message?.type !== "runFinished") return false;
      const dir = runDir(message.record);
      (async () => {
        const failed: string[] = [];
        const latestIds: number[] = [];
        await clearLatest();
        for (const { name, text, type } of runFiles(message.record)) {
          try {
            await download(dir, name, text, type, false);
            latestIds.push(await download("latest", name, text, type, true));
          } catch (err) {
            failed.push(`${name}: ${(err as Error)?.message ?? err}`);
          }
        }
        await chrome.storage.local.set({ [LATEST_IDS]: latestIds });
        return { written: `${ROOT}/${dir}`, failed };
      })().then(
        ({ written, failed }) =>
          failed.length
            ? respond({
                ok: false,
                error: `wrote to ${written} but ${failed.length} file(s) failed: ${failed.join("; ")}`,
              })
            : respond({ ok: true, dir: written }),
        (err: unknown) => respond({ ok: false, error: String((err as Error)?.message ?? err) }),
      );
      return true;
    },
  );
});
