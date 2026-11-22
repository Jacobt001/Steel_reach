# Steelreach — deployment record

## Where it lives

| Build | Address | Saves to |
|---|---|---|
| Claude link (artifact) | https://claude.ai/artifact/B5ZmXUbFjatQXsErvRPMgb (slug `519e8e33-f3b1-4c1f-9915-b6e224ee1f98`) | Your Claude account (doc `data/users/<id>/steelreach`), mirrored to the browser's localStorage |
| Home Screen version (GitHub Pages) | https://jacobt001.github.io/Steel_reach/ | The phone only (localStorage) |

- The artifact declares the `db` and `user` capabilities. It starts private to you; share it from its page on claude.ai if you ever want to.
- Source is on `main`; the built Home Screen site is the `gh-pages` branch (root: `index.html`, `manifest.webmanifest`, `icon-180.png`, `icon-512.png`, `.nojekyll`).
- The two builds keep separate saves. Move progress with **Menu → Copy save code** in one and **Menu → Load save code** in the other.

## Put it on your iPhone Home Screen

1. Open https://jacobt001.github.io/Steel_reach/ in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. Open it from the Home Screen icon: it runs full screen, with no browser bars.

Safari can clear a website's stored data after about 7 days without a visit, but a site added to the Home Screen keeps its storage. Play the Home Screen version from the icon, not from a Safari tab.

## Republish after a change

```bash
npm ci
npm test
npm run build          # writes dist/artifact and dist/home
npm run check          # optional: headless Chrome iPhone-emulation check
```

- **Artifact:** Claude republishes `dist/artifact/index.html` as `index.html` with `publish_files`, passing the slug above and the current `base_version` (from `get_artifact`). The `db`/`user` declaration carries over.
- **Home Screen site:** copy `dist/home/*` into the `gh-pages` branch root (keep `.nojekyll`), commit, and push `gh-pages`. Pages redeploys in about a minute.

## Known gaps to check on the phone

The automated browser check ran in Chrome with iPhone emulation, since WebKit can't be installed here. On your iPhone, check in both the Claude app and Safari: save and reload (Continue), Copy and Load save code inside the Claude app, sound after switching apps, pinch zoom, belt drawing, and speed on a big factory.
