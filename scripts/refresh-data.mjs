import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  buildDataset,
  carryForwardReadyFinales,
  findConfirmedFinales,
  findConfirmedUpcomingFinales,
  findMetadataShowIds,
  normalizeEpisode
} from "./lib/finales.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, "data-cache");
const EPISODE_CACHE = path.join(CACHE_DIR, "episodes.json");
const SEASON_CACHE = path.join(CACHE_DIR, "seasons.json");
const OUTPUT_FILE = path.join(ROOT, "site", "data", "finales.json");
const FEED_FILE = path.join(ROOT, "site", "feed.xml");
const LOOKBACK_DAYS = Number.parseInt(process.env.LOOKBACK_DAYS ?? "120", 10);
const UPCOMING_DAYS = Number.parseInt(process.env.UPCOMING_DAYS ?? "180", 10);
const REFRESH_DAYS = 14;
const REQUEST_SPACING_MS = Number.parseInt(process.env.REQUEST_SPACING_MS ?? "520", 10);
const USER_AGENT = "binge-ready/1.0 (+https://github.com/dvelton/binge-ready)";
const API = "https://api.tvmaze.com";
const EPISODE_CACHE_VERSION = 2;

let nextRequestAt = 0;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + amount);
  return copy;
}

function dateRange(start, end) {
  const dates = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    dates.push(isoDate(date));
  }
  return dates;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function fetchJson(url, attempt = 0) {
  const wait = Math.max(0, nextRequestAt - Date.now());
  nextRequestAt = Math.max(nextRequestAt, Date.now()) + REQUEST_SPACING_MS;
  if (wait > 0) {
    await sleep(wait);
  }

  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT
      },
      signal: AbortSignal.timeout(30_000)
    });
  } catch (error) {
    if (attempt >= 5) {
      throw error;
    }
    await sleep(Math.min(30_000, 2_000 * 2 ** attempt));
    return fetchJson(url, attempt + 1);
  }

  if ((response.status === 429 || response.status >= 500) && attempt < 5) {
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    const backoff = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : Math.min(30_000, 2_000 * 2 ** attempt);
    await sleep(backoff);
    return fetchJson(url, attempt + 1);
  }

  if (!response.ok) {
    throw new Error(`TVMaze request failed (${response.status}): ${url}`);
  }

  return response.json();
}

async function mapConcurrent(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function normalizeMany(items) {
  return items.map(normalizeEpisode).filter(Boolean);
}

async function refreshEpisodes(today) {
  const cache = await readJson(EPISODE_CACHE, {
    schemaVersion: EPISODE_CACHE_VERSION,
    episodes: [],
    coveredDates: []
  });
  const cacheValid = cache.schemaVersion === EPISODE_CACHE_VERSION;
  const cachedEpisodes = cacheValid ? (cache.episodes ?? []) : [];
  const windowStart = addDays(today, -(LOOKBACK_DAYS - 1));
  const requiredDates = dateRange(windowStart, today);
  const coveredDates = new Set(cacheValid ? (cache.coveredDates ?? []) : []);
  const refreshStart = isoDate(addDays(today, -REFRESH_DAYS));
  const dates = requiredDates.filter(
    (date) => !coveredDates.has(date) || date >= refreshStart
  );

  console.log(`Refreshing ${dates.length} schedule dates from ${dates[0]} to ${dates.at(-1)}.`);

  const scheduleResults = await mapConcurrent(dates, 4, async (date) => {
    const [broadcast, streaming] = await Promise.all([
      fetchJson(`${API}/schedule?country=US&date=${date}`),
      fetchJson(`${API}/schedule/web?date=${date}`)
    ]);
    return normalizeMany([...broadcast, ...streaming]);
  });

  const replacedDates = new Set(dates);
  const retained = cachedEpisodes.filter(
    (episode) =>
      !replacedDates.has(episode.airdate) &&
      episode.airdate >= isoDate(windowStart)
  );
  const merged = new Map();

  for (const episode of [...retained, ...scheduleResults.flat()]) {
    merged.set(String(episode.id), episode);
  }

  const episodes = [...merged.values()].sort(
    (left, right) =>
      left.airdate.localeCompare(right.airdate) ||
      left.showName.localeCompare(right.showName) ||
      (left.number ?? 0) - (right.number ?? 0)
  );

  await writeJson(EPISODE_CACHE, {
    schemaVersion: EPISODE_CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    coveredDates: requiredDates.filter(
      (date) => coveredDates.has(date) || replacedDates.has(date)
    ),
    episodes
  });

  return episodes;
}

async function refreshFutureEpisodes() {
  console.log("Loading the known future schedule.");
  return normalizeMany(await fetchJson(`${API}/schedule/full`));
}

async function refreshSeasons(episodes, futureEpisodes, now, today) {
  const cache = await readJson(SEASON_CACHE, {});
  const updatedShows = await fetchJson(`${API}/updates/shows?since=week`);
  const updatedIds = new Set(Object.keys(updatedShows));
  const showIds = findMetadataShowIds({
    episodes,
    futureEpisodes,
    now,
    today,
    lookbackDays: LOOKBACK_DAYS,
    upcomingDays: UPCOMING_DAYS
  });
  let fetched = 0;

  console.log(`Checking season metadata for ${showIds.length} shows.`);

  await mapConcurrent(showIds, 4, async (showId) => {
    const cached = cache[showId];
    const fetchedAt = cached?.fetchedAt ? new Date(cached.fetchedAt) : null;
    const age = fetchedAt ? Date.now() - fetchedAt.getTime() : Number.POSITIVE_INFINITY;
    const fresh =
      age < 24 * 60 * 60 * 1000 ||
      (age < 7 * 24 * 60 * 60 * 1000 && !updatedIds.has(showId));

    if (fresh) {
      return;
    }

    cache[showId] = {
      fetchedAt: new Date().toISOString(),
      seasons: await fetchJson(`${API}/shows/${showId}/seasons`)
    };
    fetched += 1;

    if (fetched % 100 === 0) {
      console.log(`Fetched season metadata for ${fetched} shows.`);
      await writeJson(SEASON_CACHE, cache);
    }
  });

  await writeJson(SEASON_CACHE, cache);
  return new Map(
    Object.entries(cache).map(([showId, value]) => [showId, value.seasons ?? []])
  );
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildFeed(dataset) {
  const items = dataset.finales.slice(0, 100).map((item) => {
    const title = `${item.showName} - Season ${item.season}`;
    const description = `${item.episodeCount ?? "All"} episodes are available after the ${item.finaleDate} finale.`;
    return `    <item>
      <title>${escapeXml(title)}</title>
      <link>https://dvelton.github.io/binge-ready/#${escapeXml(item.id)}</link>
      <guid isPermaLink="false">${escapeXml(item.id)}:${escapeXml(item.finaleDate)}</guid>
      <pubDate>${new Date(`${item.finaleDate}T12:00:00Z`).toUTCString()}</pubDate>
      <description>${escapeXml(description)}</description>
    </item>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Binge Ready</title>
    <link>https://dvelton.github.io/binge-ready/</link>
    <description>TV seasons ordered by the date their finales aired.</description>
    <lastBuildDate>${new Date(dataset.generatedAt).toUTCString()}</lastBuildDate>
${items.join("\n")}
  </channel>
</rss>
`;
}

async function main() {
  if (!Number.isInteger(LOOKBACK_DAYS) || LOOKBACK_DAYS < 7 || LOOKBACK_DAYS > 365) {
    throw new Error("LOOKBACK_DAYS must be an integer between 7 and 365.");
  }
  if (!Number.isInteger(UPCOMING_DAYS) || UPCOMING_DAYS < 7 || UPCOMING_DAYS > 365) {
    throw new Error("UPCOMING_DAYS must be an integer between 7 and 365.");
  }

  await fs.mkdir(CACHE_DIR, { recursive: true });
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const todayString = isoDate(today);
  const nowString = now.toISOString();
  const previousDataset = await readJson(OUTPUT_FILE, null);

  const episodes = await refreshEpisodes(today);
  const futureEpisodes = await refreshFutureEpisodes();
  const seasonsByShow = await refreshSeasons(
    episodes,
    futureEpisodes,
    nowString,
    todayString
  );
  const currentFinales = findConfirmedFinales({
    episodes,
    seasonsByShow,
    futureEpisodes,
    now: nowString,
    today: todayString,
    lookbackDays: LOOKBACK_DAYS
  });
  const upcoming = findConfirmedUpcomingFinales({
    futureEpisodes,
    seasonsByShow,
    now: nowString,
    today: todayString,
    upcomingDays: UPCOMING_DAYS
  });
  const finales = carryForwardReadyFinales({
    previousDataset,
    currentFinales,
    currentUpcoming: upcoming,
    futureEpisodes,
    seasonsByShow,
    now: nowString,
    today: todayString,
    lookbackDays: LOOKBACK_DAYS
  });
  const dataset = buildDataset({
    finales,
    upcoming,
    generatedAt: nowString,
    today: todayString,
    lookbackDays: LOOKBACK_DAYS,
    upcomingDays: UPCOMING_DAYS
  });

  await writeJson(OUTPUT_FILE, dataset);
  await fs.writeFile(FEED_FILE, buildFeed(dataset));
  console.log(
    `Wrote ${dataset.count} ready and ${dataset.upcomingCount} upcoming season finales to ${OUTPUT_FILE}.`
  );
}

await main();
