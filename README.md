# Asana Rules Extractor

Browser extension that reads the automation rules of an Asana project out of the UI and saves them as JSON, so you can hand them to an AI agent to explain, debug, or propose changes.

**Quick start**

1. Download `asana-rules-extractor-<version>-chrome.zip` from the [latest release](https://github.com/moollaza/asana-rules-extractor/releases/latest).
2. In Chrome open `chrome://extensions`, turn on **Developer mode**, and drag the zip onto the page. (Or unzip it and use **Load unpacked**.)
3. Open an Asana project, click the extension icon, click **Grab all rules**.

## What it does

- Asana's public API does not expose rules. The rule dialog is fed by a websocket that streams an ID-linked object graph, and only the UI resolves those IDs into names. This extension reads the rendered dialog instead.
- It is read-only. It clicks rule rows, cards, and close buttons, and presses Escape. It never types, picks a menu item, or touches Save, and it warns loudly if Save ever becomes enabled.
- Output is one JSON document per run, plus a run log on disk. See [Output format](#output-format).

## Install

**Chrome, from a release.** Follow the quick start above. If you used Load unpacked, keep the unzipped folder; Chrome loads from it. Edge accepts the same zip.

**Firefox.** Each release also attaches `asana-rules-extractor-<version>-firefox.zip`. Unzip it, open `about:debugging`, choose **This Firefox → Load Temporary Add-on**, and pick `manifest.json`. A store listing is pending; until then the add-on is removed when Firefox restarts.

**From source.**

```bash
pnpm install
pnpm build          # -> .output/chrome-mv3, load that folder
pnpm zip            # -> .output/asana-rules-extractor-<version>-chrome.zip
pnpm zip:firefox    # -> .output/asana-rules-extractor-<version>-firefox.zip (+ -sources.zip)
```

**Permissions it asks for.**

| Permission                        | Why                                                       |
| --------------------------------- | --------------------------------------------------------- |
| `host_permissions: app.asana.com` | the only site the script may run on                       |
| `scripting`                       | inject the reader into the open Asana tab on demand       |
| `activeTab`                       | find which tab is Asana                                   |
| `downloads`                       | write the run log to `~/Downloads`                        |
| `storage`                         | remember which `latest/` files to replace on the next run |

## Use

1. Open an Asana project.
2. Click the extension icon, then **Grab all rules**. To read only the rule dialog you already have open, click **Grab open rule** instead.
3. Progress shows in an overlay on the page. You can close the popup; reopen it to see the result or press **Stop**.
4. When done, the popup shows a **Review** tab and a **JSON** tab, with **Save to file…** (named `<project>-rules-<timestamp>.json`), **Copy**, and **Clear**.

Every run is also written automatically to `~/Downloads/asana-rules-extractor/`:

```
latest/                      overwritten each run — point an agent here
2026-09-08T18-02-11-123Z/    one folder per run, kept
  rules.json                 the extracted rules
  run.txt                    timestamped log
  run.json                   rules + log + metadata
  dom/NN-<rule>.digest.txt   per-rule DOM digest, taken as the rule was read
  dom/NN-<rule>.html         per-rule dialog HTML, for debugging a bad read
```

In Chrome, go to Settings → Downloads and turn off "Ask where to save each file before downloading", or every file will prompt.

**Review tab.** A readable view of the same JSON: one collapsible row per rule, one per branch, one line per action. Rules that failed to read are marked `failed`, rules with warnings show the count, and actions the extension could not fully read are flagged `incomplete`. The JSON stays the source of truth.

## Output format

```json
{
  "project": "User Feedback",
  "rules": [
    {
      "id": "1200000000000000",
      "name": "Search Rules",
      "status": "Active",
      "lastRun": "Last run yesterday",
      "when": { "any": ["Task is added to this project", "Area is changed"] },
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

**Structure**

- `when` is the trigger. `branches` is the if / else-if chain in order.
- `all` / `any` is the And / Or of a card group. A catch-all else path has `"if": "otherwise"`.
- Conditions are one string each. A list the UI truncated (`+25`) is expanded from the side pane. If that fails it becomes `{ condition, incomplete: true, hiddenValueCount }`.
- A rule that could not be read at all appears as `{ name, error }`.

**Action keys**

| Key                 | Value                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `move_to_section`   | section name, e.g. `"Search"`                                                                              |
| `add_to_project`    | project name                                                                                               |
| `set_field`         | `{ "field": "Area", "value": "Billing" }`; `value` is an array for multi-select                            |
| `set_assignee`      | person, see below                                                                                          |
| `add_collaborators` | people, see below                                                                                          |
| `set_task_name`     | the new name text                                                                                          |
| `add_comment`       | the comment text                                                                                           |
| any of the above    | `{ "useAI": true }` when the card's value is Asana's "Use AI" pill; the rule then carries `aiInstructions` |
| _(none)_            | `{ "action": "<card text>", "values": [...], "untyped": true }` for a phrasing with no typed key yet       |

**People values** (`set_assignee`, `add_collaborators`)

- `{ "Ada Lovelace": "1200000000000001" }` for a single person, where the DOM ties the name to the avatar. The gid comes from the avatar URL.
- `{ names, gids }` for several people. Names are complete, gids cover only people with a profile photo, and the two lists are not aligned.
- `{ namesUnavailable: true, count, gids }` when the pane could not be read.

**Rule-level fields**

| Field            | Meaning                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aiInstructions` | `{ text, references }`. The Instructions card text flattened to plain lines, with every embedded project/task pill listed by `type`, `name`, and `gid`. Present when any action is `{ useAI: true }`. |
| `warnings`       | Array of reads that may be wrong. Treat any rule with `warnings` as unverified.                                                                                                                       |
| `untyped`        | Count of `untyped` actions in the rule. Not an error; the typed keys are a convenience for phrasings seen so far.                                                                                     |

The extension opens the Instructions card via the canvas toolbar only when a rule needs it and minimizes it again afterwards. To add a typed key for a new action phrasing, add a pattern to `ACTIONS` in `src/lib/shape.ts`.

## How correct is it?

The JSON comes from the DOM, so it can be wrong three ways: a selector misses and reads as absence, the UI genuinely hides data, or Asana changes its markup. The extension guards against the first two by counting cards on screen against cards captured, waiting for "Unspecified" placeholders to resolve, expanding truncated lists, and counting untyped actions.

Anything it cannot reconcile lands in the rule's `warnings` (full list in `auditRule`, `src/lib/shape.ts`):

- card count mismatch, missing trigger, missing branches, a branch with no actions
- a group that mixes And and Or, so `all` / `any` is unreliable
- a "Use AI" action whose Instructions card was not read
- entries that still have hidden values
- `SAVE BUTTON IS ENABLED`: the rule looks modified; do not save, close the dialog

There is no independent oracle. The only stronger check would be cross-reading the websocket object graph.

When Asana changes class names, everything selector-shaped is in `src/lib/selectors.ts`. **Debug → Dump DOM digest** in the popup prints per-selector hit counts and every card as read; after a dump, **Save full HTML…** saves the complete dialog markup. Attach both to a bug report.

## Development

Built with [WXT](https://wxt.dev), a Vite-based extension framework. Entrypoints are discovered from `entrypoints/`, the manifest is generated from `wxt.config.ts`, and `pnpm build` writes a loadable extension to `.output/chrome-mv3`. Tooling: Vite, Vitest, oxlint, oxfmt, all on defaults.

```bash
pnpm dev          # WXT dev build with reload
pnpm test         # vitest, DOM tests run in happy-dom against synthetic fixtures
pnpm lint         # oxlint + oxfmt --check
pnpm format       # oxfmt
pnpm typecheck    # tsc --noEmit
pnpm check        # lint + typecheck + test + build
pnpm icons        # re-render public/icon from scripts/icons.mjs
```

Test fixtures are hand-written HTML mirroring Asana's structure with invented names. Do not commit real DOM dumps: they contain colleague names and gids.

**Publishing.** Bump `version` in `package.json`, merge, then tag `v<version>` and push the tag. The Release workflow runs `pnpm check` and attaches the Chrome, Firefox, and sources zips to a GitHub release. Store submission is a separate manual workflow; see [docs/PUBLISHING.md](docs/PUBLISHING.md). The store-facing privacy policy is [PRIVACY.md](PRIVACY.md).

## Project layout

```
entrypoints/
  grabber.ts        content script, injected on demand; owns the walk, overlay, and messaging
  background.ts     writes each run to Downloads
  popup/            toolbar popup (Tailwind)
src/lib/
  selectors.ts      every Asana class name the extension depends on
  extract.ts        dialog DOM -> RawRule (pure, tested)
  shape.ts          RawRule -> agent-facing JSON + audit (pure, tested)
  review.ts         JSON -> Review tab DOM (pure, tested)
  digest.ts         debug digest of the dialog
  run-files.ts      which files a run writes (pure, tested)
  types.ts
tests/              fixtures are synthetic; nothing from a real workspace
```
