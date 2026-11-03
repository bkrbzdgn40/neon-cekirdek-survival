'use strict';
// Odak 1.2 · shared page loader for browser specs.
// Existing specs exercise every system, so they open the game with
// ?unlock=all. Specs that check locked behaviour pass { unlockAll: false }.

function gameUrl(url = '/index.html', { unlockAll = true } = {}) {
  if (!unlockAll) return url;
  const [pathPart, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  params.set('unlock', 'all');
  return `${pathPart}?${params}`;
}

function gotoGame(page, url = '/index.html', { unlockAll = true, waitUntil = 'domcontentloaded' } = {}) {
  return page.goto(gameUrl(url, { unlockAll }), { waitUntil });
}

module.exports = { gameUrl, gotoGame };
