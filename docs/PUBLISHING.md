# Publishing

## Releases (automated)

Bump `version` in `package.json`, commit, tag, push:

```sh
git tag v1.0.1 && git push origin main v1.0.1
```

The Release workflow runs `pnpm check`, zips for Chrome and Firefox, and attaches
`*-chrome.zip`, `*-firefox.zip`, and `*-sources.zip` to a GitHub release.

## Store submission (manual trigger)

First-time submission to each store is done by hand in its dashboard, using the
copy in `store/listing.md`. After that, the **Publish to stores** workflow
(Actions tab, Run workflow) uploads new versions. It defaults to a dry run that
only checks credentials; untick "dry run" to upload and submit for review.

### Accounts and secrets to create

| Store                 | Account                            | Repo secrets                                                                                                    |
| --------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Chrome Web Store      | Developer account, one-time $5 fee | `CHROME_EXTENSION_ID`, `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`                       |
| Firefox Add-ons (AMO) | Free developer account             | `FIREFOX_EXTENSION_ID` (`asana-rules-extractor@moollaza.github.io`), `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET` |

The easiest way to obtain the Chrome OAuth values is the interactive helper,
which walks through creating them and prints the env var values:

```sh
pnpm wxt submit init
```

Add each value under Settings → Secrets and variables → Actions. Never commit them.

### Firefox

The Firefox build is Manifest V3 with the add-on id above. AMO requires the
sources zip alongside the build because the code is bundled; the workflow
uploads it. Test locally before the first submission:

```sh
pnpm wxt build -b firefox   # then about:debugging → Load Temporary Add-on → .output/firefox-mv3/manifest.json
```

### Edge

Edge accepts the Chrome zip. Upload it by hand at partner.microsoft.com; not automated here.
