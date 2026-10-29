# Publishing the real playable build and professional showcase

**Deployment status at the time of this guide:** The public repository was verified with `has_pages = false`. The site is **not currently confirmed to have a live GitHub Pages URL**. No public URL should be advertised until the site's published address has been opened and verified.

## One-time repository setting

The project is entirely static. No external deploy service, server-side API or new build is required. With repository administrator access:

1. Navigate to [GitHub repository Settings](https://github.com/bkrbzdgn40/neon-cekirdek-survival/settings) → **Pages**.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Choose branch **main**, folder **/(root)**, then **Save**.
4. After Pages reports the public URL, open it in a private/incognito browser and verify `index.html` actually plays.
5. Visit `showcase.html` on the same host and verify the on-demand live preview, stop control, language switch and media links.
6. Only after these checks, add the **verified** public landing link to the repository About → Website and the README. Consider pointing About → Website to `showcase.html` if the first goal is external professional evaluation.

The expected GitHub Pages *URL pattern* is `https://<owner>.github.io/<repo>/` for a project site, but **do not assume this address is live**. Follow the address GitHub Pages actually shows. The repository contains a root `.nojekyll` marker so Pages' branch publishing does not interpret files as Jekyll content.

**Reference:** [GitHub's official Pages publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Smoke check after publishing

- Play via the hosted `index.html`: start, move and fire, dash, EMP Nova, Prism Riposte, pause/resume.
- Read the upgrade cards, check boss warning and arena HUD in one desktop and one mobile viewport.
- Open `showcase.html` and verify both language variants and no horizontal overflow.
- **Before clicking the preview**, there must be no `#gamePreviewFrame` and no second game instance. Click **Load interactive preview**, verify the actual `index.html` frame, then click **Stop preview** and verify the frame is destroyed.
- Inspect browser console for broken static files. Playable assets should not rely on CDN scripts.
- Check the deployed branch/commit corresponds to the current main CI commit.
- Try reduced-motion and low graphics profile if available.

## Professional visibility checklist

- Short project About description (e.g., **"Playable browser arena-survival game with tactical encounters, evolving builds and reactive neon combat."**).
- Topics, after human review: `browser-game`, `arena-survival`, `canvas2d`, `javascript`, `roguelite`, `game-development`. The current API connector does not update repository topics, so these are suggestions, not completed changes.
- Real screenshots and optional short real-game trailer, with UI visible. Do not use illustration as a fake screenshot.
- Current press-kit contact channel and permission/licensing decision from the maintainer.
- No fake external reviews, performance numbers, commercial release date or store page.

## Why GitHub Pages?

GitHub Pages can publish static files from a chosen branch and folder. It is appropriate for a build without an API/server. However, enabling Pages **is a repository administration setting** and is not performed by editing a README or committing a workflow. The development PR and ordinary CI tests are independent of this one-time configuration.
