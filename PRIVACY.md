# Privacy policy

Asana Rules Extractor runs entirely in your browser.

- **What it reads.** When you click Grab, it reads the automation rule dialogs of the Asana project open in the current tab: rule names, triggers, conditions, actions, the names and avatar image URLs of people referenced by rules, and the text of a rule's AI instructions.
- **Where it goes.** The extracted JSON is shown in the popup and saved to your own Downloads folder. Nothing is sent to any server. The extension makes no network requests of its own.
- **What it stores.** Nothing beyond the files it writes to `Downloads/asana-rules-extractor/`. Browser storage holds only transient run state.
- **Permissions.** `activeTab` and `scripting` to read the Asana tab you are on; `downloads` to save the JSON; host access to `app.asana.com` only.
- **Analytics.** None.
- **Contact.** Open an issue at https://github.com/moollaza/asana-rules-extractor/issues.
