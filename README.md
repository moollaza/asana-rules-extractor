# Asana Rules Extractor

Browser extension that reads the automation rules of an Asana project out of the UI and saves them as JSON, so you can hand them to an AI agent to explain, debug, or propose changes.

Asana's public API does not expose rules. In a HAR capture, the rule dialog is fed by a websocket that streams an ID-linked object graph, and only the UI resolves those IDs into names. This extension reads the rendered dialog instead. It is read-only: it clicks rule rows, cards, and close buttons, and presses Escape. It never types, picks a menu item, or touches Save, and it reports loudly if Save ever becomes enabled.

## Install

No clone needed: download `asana-rules-extractor-<version>-chrome.zip` from the [latest release](https://github.com/moollaza/asana-rules-extractor/releases/latest) and unzip it. Then in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → pick the unzipped folder. Keep the folder; Chrome loads from it.

To build from source instead:

```bash
pnpm install
pnpm build          # -> .output/chrome-mv3, load that folder
pnpm zip            # -> .output/asana-rules-extractor-<version>-chrome.zip
```

Permissions it asks for:

| Permission                        | Why                                                       |
| --------------------------------- | --------------------------------------------------------- |
| `host_permissions: app.asana.com` | the only site the script may run on                       |
| `scripting`                       | inject the reader into the open Asana tab on demand       |
| `activeTab`                       | find which tab is Asana                                   |
| `downloads`                       | write the run log to `~/Downloads`                        |
| `storage`                         | remember which `latest/` files to replace on the next run |

## Use

1. Open an Asana project.
2. Click the extension icon, then **Grab all rules**. Progress shows in an overlay on the page; the popup can be closed.
3. When done, the popup shows the JSON with **Save to file** (named `<project>-rules-<timestamp>.json`) and **Copy**.

Every run is also written automatically to:

```
~/Downloads/asana-rules-extractor/
  latest/                      overwritten each run — point an agent here
  2026-09-08T18-02-11-123Z/    one folder per run, kept
    rules.json                 the extracted rules
    run.txt                    timestamped log
    run.json                   rules + log + metadata
    dom/NN-<rule>.digest.txt   per-rule DOM digest, taken as the rule was read
    dom/NN-<rule>.html         per-rule dialog HTML, for debugging a bad read
```

Chrome → Settings → Downloads → turn off "Ask where to save each file before downloading", or every file will prompt.

**Debug** in the popup has **Dump DOM digest** (per-selector hit counts and every card as read) and, after a dump, **Save full HTML** for the complete dialog markup. Attach both to a bug report.

## Output

```json
{
  "project": "User Feedback",
  "rules": [
    {
      "id": "1200000000000000",
      "name": "Search Rules",
      "status": "Active",
      "lastRun": "Last run yesterday",
      "when": { "any": ["Task is added to this project", "Search Area is changed"] },
      "branches": [
        {
          "if": { "all": ["Priority is set to High", "Area is set to Billing"] },
          "do": [
            { "move_to_section": "Search" },
            { "add_to_project": "Bad Content Reports" },
            { "add_collaborators": { "Ada Lovelace": "1200000000000001" } }
          ]
        }
      ]
    }
  ]
}
```

- `branches` is the if / else-if chain in order. `all` / `any` is the And / Or of that card group. A catch-all else path has `"if": "otherwise"`.
- Conditions are one string each. A list the UI truncated (`+25`) is expanded from the side pane; if that fails it becomes `{ condition, incomplete: true, hiddenValueCount }`.
- `add_collaborators` is `{ "Name": "gid" }` only for a single collaborator, where the DOM ties the name to the avatar (the gid comes from the avatar URL). For several people it is `{ names, gids }`: names are complete, gids cover only people with a profile photo, and the two lists are not aligned. `{ namesUnavailable, count, gids }` means the pane could not be read.
- An action whose value is Asana's "Use AI" pill comes out as `{ "add_to_project": { "useAI": true } }` (same for any other action type), never as an object named "Use AI". The rule then carries `aiInstructions: { text, references }`: the Instructions card text flattened to plain lines, with every embedded project/task pill listed by name and gid. The extension opens the Instructions card via the canvas toolbar only when a rule needs it and minimizes it again afterwards. A "Use AI" action with no readable Instructions is a `warnings` entry.
- An action with no typed key yet is kept in full as `{ action: "<card text>", values: [...], untyped: true }`, and the rule carries an `untyped` count. Not an error: the typed keys are a convenience for the phrasings seen so far. Add a pattern to `ACTIONS` in `src/lib/shape.ts` when a new one shows up.
- A rule whose card count, trigger, or branches do not add up gets a `warnings` array (full list in `auditRule`, `src/lib/shape.ts`). Treat any rule with `warnings` as unverified.

## How correct is it?

The JSON comes from the DOM, so it can be wrong three ways: a selector misses and reads as absence, the UI genuinely hides data, or Asana changes its markup. The extension guards against the first two by counting cards on screen against cards captured, waiting for placeholders to resolve, expanding truncated lists, and counting untyped actions. There is no independent oracle; the only stronger check would be cross-reading the websocket object graph.

When Asana changes class names, everything selector-shaped is in `src/lib/selectors.ts`. The **Debug → Dump DOM digest** button prints per-selector hit counts to see what broke.

## Development

Built with [WXT](https://wxt.dev) (Vite-based extension framework): entrypoints are discovered from `entrypoints/`, the manifest is generated from `wxt.config.ts`, and `pnpm build` writes a loadable extension to `.output/chrome-mv3`. `pnpm zip` packages it. Tooling is VoidZero's: Vite, Vitest, oxlint, oxfmt, all on defaults.

```bash
pnpm dev          # WXT dev build with reload
pnpm test         # vitest, DOM tests run in happy-dom against synthetic fixtures
pnpm lint         # oxlint + oxfmt --check
pnpm format
pnpm typecheck
pnpm check        # all of the above plus build
pnpm icons        # re-render public/icon from scripts/icons.mjs
```

Release: bump `version` in `package.json`, merge, then `git tag v<version> && git push --tags`. The Release workflow runs the checks, zips, and attaches the zip to a GitHub release.

Layout:

```
entrypoints/
  grabber.ts        content script, injected on demand; owns the walk, overlay, and messaging
  background.ts     writes each run to Downloads
  popup/            toolbar popup (Tailwind)
src/lib/
  selectors.ts      every Asana class name the extension depends on
  extract.ts        dialog DOM -> RawRule (pure, tested)
  shape.ts          RawRule -> agent-facing JSON + audit (pure, tested)
  digest.ts         debug digest of the dialog
  run-files.ts      which files a run writes (pure, tested)
  types.ts
tests/              fixtures are synthetic; nothing from a real workspace
```

Test fixtures are hand-written HTML mirroring Asana's structure with invented names. Do not commit real DOM dumps: they contain colleague names and gids.
