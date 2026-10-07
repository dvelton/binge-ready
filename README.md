# Binge Ready

Binge Ready shows which TV seasons are complete now and when upcoming seasons
are scheduled to finish. Ready seasons are ordered newest first; upcoming
finales are ordered soonest first.

Live site: https://dvelton.github.io/binge-ready/

## How to use it

1. Open the site.
2. Switch between `Ready now` and `Coming up`, or search by title.
3. Use `Major shows` for the focused feed or `All shows` for the complete data.
4. Filter by service, genre, language, country, or finale date.
5. Save a show or mark it watched. Those choices stay only in your browser.

There is no account, advertising, analytics, or weekly episode feed.
The default view shows major English-language finales from the past seven days.
Every available show and language, the full 120-day archive, and up to 180 days
of confirmed future finale dates remain selectable.

`Major shows` is a transparent relevance filter, not a hand-maintained list. A
show qualifies when its TVMaze popularity weight is at least 98, or at least 90
and it airs on a recognized platform or network. `All shows` removes that
filter. This cutoff can miss a new show until its popularity data catches up.

## Coverage

The feed includes US broadcast schedules and streaming schedules available
through TVMaze. A season appears only when the data confirms that the listed
episode is the season's scheduled ending. Future dates can change, and a season
does not appear in `Coming up` until its finale is present in the published
schedule.

The site refreshes daily through GitHub Actions. TV data is provided by
[TVMaze](https://www.tvmaze.com/) under CC BY-SA. See
[DATA-LICENSE.md](DATA-LICENSE.md).

## Run locally

Node.js 22 or later is required. The site has no third-party runtime or build
dependencies.

```bash
npm test
npm run validate
npm run serve
```

Then open `http://localhost:4173/binge-ready/`.

To rebuild the data:

```bash
npm run refresh
```

The initial refresh takes several minutes because requests are paced to respect
TVMaze's public API limits. Later refreshes reuse a local cache.

## Project structure

```text
site/                 Static GitHub Pages site
scripts/              Data refresh, validation, and local server
tests/                Finale detection tests
.github/workflows/    Daily refresh and Pages deployment
```

Application code is MIT licensed. Generated TV data is covered by the TVMaze
data license described above.
