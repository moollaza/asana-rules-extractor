# Store listing copy

Paste into the Chrome Web Store, Firefox Add-ons, and Edge Add-ons dashboards.

## Name

Asana Rules Extractor

## Summary (132 chars max, Chrome)

Export an Asana project's automation rules as JSON, so you can review them or hand them to an AI agent.

## Description

Asana shows automation rules one dialog at a time and offers no export. This extension reads every rule of the project you have open and turns it into one JSON document: triggers, conditions, branches, actions, collaborators, and AI instructions.

- One click grabs every rule in the project, or just the rule you have open.
- A Review tab shows rules as collapsible rows for reading; a JSON tab for copying.
- Every run is also saved to your Downloads folder.
- Read-only: it never edits or saves a rule.
- Nothing leaves your browser. No accounts, no analytics.

## Category

Productivity (Chrome) · Productivity / Other (Firefox)

## Single purpose (Chrome)

Export the automation rules of the open Asana project as JSON.

## Permission justifications (Chrome)

- activeTab, scripting: read the rule dialog on the Asana tab the user is on, only after they click Grab.
- downloads: save the exported JSON to the user's Downloads folder.
- storage: keep transient run state so the popup can reattach to a run in progress.
- host permission app.asana.com: the extension only works on Asana.

## Data use disclosure (Chrome)

Does not collect or transmit user data. All processing is local.

## Privacy policy URL

https://github.com/moollaza/asana-rules-extractor/blob/main/PRIVACY.md

## Screenshots needed

1280×800 PNG: (1) popup Review tab with a grabbed rule, (2) popup JSON tab, (3) the on-page overlay mid-run. Put them in this folder as screenshot-1.png etc.
