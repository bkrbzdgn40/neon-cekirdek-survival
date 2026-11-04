'use strict';
// Odak 1.2 · shared page loader for browser specs.
// Existing specs exercise every system, so they open the game with
// ?unlock=all. Specs that check locked behaviour pass { unlockAll: false }.
// Odak 2.7d · the automatic graphics step-down is off unless a spec asks for
// it with { autoGraphics: true }: a slow CI machine must not change rendering.

function gameUrl(url = '/index.html', { unlockAll = true } = {}) {
  if (!unlockAll) return url;
  const [pathPart, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  params.set('unlock', 'all');
  return `${pathPart}?${params}`;
}

async function gotoGame(page, url = '/index.html',
  { unlockAll = true, waitUntil = 'domcontentloaded', autoGraphics = false } = {}) {
  if (!autoGraphics) await page.addInitScript(() => { window.NEON_GRAPHICS_AUTO = false; });
  return page.goto(gameUrl(url, { unlockAll }), { waitUntil });
}

module.exports = { gameUrl, gotoGame };
