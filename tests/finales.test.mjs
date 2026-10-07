import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDataset,
  carryForwardReadyFinales,
  classifyProminence,
  findConfirmedFinales,
  findConfirmedUpcomingFinales,
  findMetadataShowIds,
  normalizeEpisode
} from "../scripts/lib/finales.mjs";

function episode(overrides = {}) {
  return {
    id: 1,
    airdate: "2026-10-01",
    airstamp: "2026-10-02T01:00:00+00:00",
    season: 2,
    number: 8,
    name: "Finale",
    runtime: 50,
    _embedded: {
      show: {
        id: 10,
        name: "Example Show",
        url: "https://www.tvmaze.com/shows/10/example-show",
        status: "Running",
        genres: ["Drama"],
        language: "English",
        weight: 95,
        image: { medium: "poster.jpg", original: "poster-large.jpg" },
        webChannel: { name: "Example+", country: null },
        network: null
      }
    },
    ...overrides
  };
}

test("normalizes TVMaze schedule records", () => {
  const result = normalizeEpisode(episode());
  assert.equal(result.showId, 10);
  assert.equal(result.service, "Example+");
  assert.equal(result.countryCode, "Global");
  assert.equal(result.readyAt, "2026-10-02T01:00:00.000Z");
  assert.equal(result.weight, 95);
});

test("classifies major shows using popularity and platform", () => {
  assert.equal(
    classifyProminence({ service: "Unknown", weight: 98 }).major,
    true
  );
  assert.equal(
    classifyProminence({ service: "Netflix", weight: 90 }).major,
    true
  );
  assert.equal(
    classifyProminence({ service: "Unknown", weight: 90 }).major,
    false
  );
  assert.equal(
    classifyProminence({ service: "Netflix", weight: 89 }).major,
    false
  );
});

test("confirms a finale when the published episode order is complete", () => {
  const normalized = normalizeEpisode(episode());
  const finales = findConfirmedFinales({
    episodes: [normalized],
    seasonsByShow: new Map([
      [
        "10",
        [
          {
            number: 2,
            endDate: "2026-10-01",
            episodeOrder: 8,
            image: null,
            network: null,
            webChannel: null
          }
        ]
      ]
    ]),
    now: "2026-10-07T15:00:00.000Z",
    today: "2026-10-07",
    lookbackDays: 120
  });

  assert.equal(finales.length, 1);
  assert.equal(finales[0].id, "show-10-season-2");
  assert.equal(finales[0].confirmation, "episode-order");
  assert.equal(finales[0].daysAgo, 6);
});

test("does not treat an end date alone as finale confirmation", () => {
  const normalized = normalizeEpisode(episode());
  const finales = findConfirmedFinales({
    episodes: [normalized],
    seasonsByShow: new Map([
      ["10", [{ number: 2, endDate: "2026-10-01", episodeOrder: null }]]
    ]),
    now: "2026-10-07T15:00:00.000Z",
    today: "2026-10-07",
    lookbackDays: 120
  });
  assert.equal(finales.length, 0);
});

test("uses episode order only when no later episode is scheduled", () => {
  const normalized = normalizeEpisode(episode());
  const seasonsByShow = new Map([
    ["10", [{ number: 2, endDate: null, episodeOrder: 8 }]]
  ]);

  const confirmed = findConfirmedFinales({
    episodes: [normalized],
    seasonsByShow,
    futureEpisodes: [],
    now: "2026-10-07T15:00:00.000Z",
    today: "2026-10-07",
    lookbackDays: 120
  });
  assert.equal(confirmed.length, 1);
  assert.equal(confirmed[0].confirmation, "episode-order");

  const future = normalizeEpisode(
    episode({
      id: 2,
      airdate: "2026-10-15",
      airstamp: "2026-10-15T20:00:00.000Z",
      number: 9
    })
  );
  const rejected = findConfirmedFinales({
    episodes: [normalized],
    seasonsByShow,
    futureEpisodes: [future],
    now: "2026-10-07T15:00:00.000Z",
    today: "2026-10-07",
    lookbackDays: 120
  });
  assert.equal(rejected.length, 0);
  assert.deepEqual(
    findMetadataShowIds({
      episodes: [normalized],
      futureEpisodes: [future],
      now: "2026-10-07T15:00:00.000Z",
      today: "2026-10-07",
      lookbackDays: 120,
      upcomingDays: 180
    }),
    ["10"]
  );
});

test("confirms and orders future finale dates", () => {
  const later = normalizeEpisode(
    episode({
      id: 12,
      airdate: "2026-10-20",
      airstamp: "2026-10-20T20:00:00.000Z",
      number: 8
    })
  );
  const sooner = normalizeEpisode(
    episode({
      id: 21,
      airdate: "2026-10-15",
      airstamp: "2026-10-15T20:00:00.000Z",
      _embedded: {
        show: {
          ...episode()._embedded.show,
          id: 20,
          name: "Sooner Show"
        }
      }
    })
  );
  const upcoming = findConfirmedUpcomingFinales({
    futureEpisodes: [later, sooner],
    seasonsByShow: new Map([
      ["10", [{ number: 2, endDate: "2026-10-20", episodeOrder: 8 }]],
      ["20", [{ number: 2, endDate: "2026-10-15", episodeOrder: 8 }]]
    ]),
    now: "2026-10-07T15:00:00.000Z",
    today: "2026-10-07",
    upcomingDays: 180
  });

  assert.equal(upcoming.length, 2);
  assert.equal(upcoming[0].showName, "Sooner Show");
  assert.equal(upcoming[0].daysUntil, 8);
  assert.equal(upcoming[1].daysUntil, 13);
});

test("keeps a finale airing later today in the upcoming feed", () => {
  const laterToday = normalizeEpisode(
    episode({
      airdate: "2026-10-07",
      airstamp: "2026-10-08T01:00:00.000Z"
    })
  );
  const seasonsByShow = new Map([
    ["10", [{ number: 2, endDate: "2026-10-07", episodeOrder: 8 }]]
  ]);
  const ready = findConfirmedFinales({
    episodes: [laterToday],
    seasonsByShow,
    now: "2026-10-07T15:00:00.000Z",
    today: "2026-10-07",
    lookbackDays: 120
  });
  const upcoming = findConfirmedUpcomingFinales({
    futureEpisodes: [laterToday],
    seasonsByShow,
    now: "2026-10-07T15:00:00.000Z",
    today: "2026-10-07",
    upcomingDays: 180
  });

  assert.equal(ready.length, 0);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].daysUntil, 0);
});

test("keeps a cross-midnight broadcast upcoming until its ready timestamp", () => {
  const crossMidnight = normalizeEpisode(
    episode({
      airdate: "2026-10-09",
      airstamp: "2026-10-10T02:00:00.000Z",
      _embedded: {
        show: {
          ...episode()._embedded.show,
          network: {
            name: "USA Network",
            country: { code: "US", name: "United States" }
          },
          webChannel: null
        }
      }
    })
  );
  const upcoming = findConfirmedUpcomingFinales({
    futureEpisodes: [crossMidnight],
    seasonsByShow: new Map([
      ["10", [{ number: 2, endDate: "2026-10-09", episodeOrder: 8 }]]
    ]),
    now: "2026-10-10T00:30:00.000Z",
    today: "2026-10-10",
    upcomingDays: 180
  });

  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].readyAt, "2026-10-10T02:50:00.000Z");
  assert.equal(upcoming[0].daysUntil, 0);
});

test("carries worldwide upcoming finales into the ready archive", () => {
  const previous = {
    finales: [],
    upcoming: [
      {
        id: "show-10-season-2",
        showName: "Worldwide Show",
        season: 2,
        finaleDate: "2026-10-09",
        readyAt: "2026-10-09T22:00:00.000Z"
      }
    ]
  };
  const carried = carryForwardReadyFinales({
    previousDataset: previous,
    currentFinales: [],
    currentUpcoming: [],
    futureEpisodes: [],
    seasonsByShow: new Map([
      ["10", [{ number: 2, endDate: "2026-10-09", episodeOrder: 8 }]]
    ]),
    now: "2026-10-10T12:00:00.000Z",
    today: "2026-10-10",
    lookbackDays: 120
  });

  assert.equal(carried.length, 1);
  assert.equal(carried[0].showName, "Worldwide Show");
  assert.equal(carried[0].daysAgo, 1);

  const rescheduled = carryForwardReadyFinales({
    previousDataset: previous,
    currentFinales: [],
    currentUpcoming: [
      {
        ...previous.upcoming[0],
        readyAt: "2026-10-12T22:00:00.000Z"
      }
    ],
    futureEpisodes: [],
    seasonsByShow: new Map([
      ["10", [{ number: 2, endDate: "2026-10-12", episodeOrder: 8 }]]
    ]),
    now: "2026-10-10T12:00:00.000Z",
    today: "2026-10-10",
    lookbackDays: 120
  });
  assert.equal(rescheduled.length, 0);
});

test("does not carry a finale contradicted by the current schedule or season order", () => {
  const previous = {
    finales: [],
    upcoming: [
      {
        id: "show-10-season-2",
        showId: 10,
        showName: "Postponed Show",
        season: 2,
        finaleEpisode: 8,
        finaleDate: "2026-10-09",
        readyAt: "2026-10-09T22:00:00.000Z"
      }
    ]
  };
  const postponedEpisode = normalizeEpisode(
    episode({
      airdate: "2026-10-12",
      airstamp: "2026-10-12T22:00:00.000Z"
    })
  );
  const postponed = carryForwardReadyFinales({
    previousDataset: previous,
    currentFinales: [],
    currentUpcoming: [],
    futureEpisodes: [postponedEpisode],
    seasonsByShow: new Map([
      ["10", [{ number: 2, endDate: "2026-10-09", episodeOrder: 8 }]]
    ]),
    now: "2026-10-10T12:00:00.000Z",
    today: "2026-10-10",
    lookbackDays: 120
  });
  assert.equal(postponed.length, 0);

  const extended = carryForwardReadyFinales({
    previousDataset: previous,
    currentFinales: [],
    currentUpcoming: [],
    futureEpisodes: [],
    seasonsByShow: new Map([
      ["10", [{ number: 2, endDate: null, episodeOrder: 10 }]]
    ]),
    now: "2026-10-10T12:00:00.000Z",
    today: "2026-10-10",
    lookbackDays: 120
  });
  assert.equal(extended.length, 0);
});

test("carries a ready finale whose local airdate is ahead of UTC today", () => {
  const carried = carryForwardReadyFinales({
    previousDataset: {
      finales: [],
      upcoming: [
        {
          id: "show-20-season-1",
          showId: 20,
          showName: "Timezone Show",
          season: 1,
          finaleEpisode: 6,
          finaleDate: "2026-10-13",
          readyAt: "2026-10-12T20:00:00.000Z"
        }
      ]
    },
    currentFinales: [],
    currentUpcoming: [],
    futureEpisodes: [],
    seasonsByShow: new Map([
      ["20", [{ number: 1, endDate: "2026-10-13", episodeOrder: 6 }]]
    ]),
    now: "2026-10-12T21:00:00.000Z",
    today: "2026-10-12",
    lookbackDays: 120
  });

  assert.equal(carried.length, 1);
  assert.equal(carried[0].daysAgo, 0);
});

test("excludes non-binge schedule types", () => {
  const newsEpisode = normalizeEpisode(
    episode({
      _embedded: {
        show: {
          ...episode()._embedded.show,
          type: "News"
        }
      }
    })
  );
  const finales = findConfirmedFinales({
    episodes: [newsEpisode],
    seasonsByShow: new Map([
      ["10", [{ number: 2, endDate: "2026-10-01", episodeOrder: 8 }]]
    ]),
    now: "2026-10-07T15:00:00.000Z",
    today: "2026-10-07",
    lookbackDays: 120
  });
  assert.equal(finales.length, 0);
});

test("chooses the highest numbered episode for a same-day season drop", () => {
  const episodes = [
    normalizeEpisode(episode({ id: 1, number: 1, name: "One" })),
    normalizeEpisode(episode({ id: 8, number: 8, name: "Eight" }))
  ];
  const finales = findConfirmedFinales({
    episodes,
    seasonsByShow: new Map([
      ["10", [{ number: 2, endDate: "2026-10-01", episodeOrder: 8 }]]
    ]),
    now: "2026-10-07T15:00:00.000Z",
    today: "2026-10-07",
    lookbackDays: 120
  });

  assert.equal(finales[0].finaleEpisode, 8);
  assert.equal(finales[0].finaleName, "Eight");
});

test("sorts output by finale date and builds filter metadata", () => {
  const first = normalizeEpisode(episode());
  const second = normalizeEpisode(
    episode({
      id: 20,
      airdate: "2026-10-05",
      _embedded: {
        show: {
          ...episode()._embedded.show,
          id: 20,
          name: "Newer Show",
          genres: ["Comedy"],
          network: { name: "ABC", country: { code: "US", name: "United States" } },
          webChannel: null
        }
      }
    })
  );
  const finales = findConfirmedFinales({
    episodes: [first, second],
    seasonsByShow: new Map([
      ["10", [{ number: 2, endDate: "2026-10-01", episodeOrder: 8 }]],
      ["20", [{ number: 2, endDate: "2026-10-05", episodeOrder: 8 }]]
    ]),
    now: "2026-10-07T15:00:00.000Z",
    today: "2026-10-07",
    lookbackDays: 120
  });
  const dataset = buildDataset({
    finales,
    upcoming: [],
    generatedAt: "2026-10-07T12:00:00.000Z",
    today: "2026-10-07",
    lookbackDays: 120,
    upcomingDays: 180
  });

  assert.equal(dataset.finales[0].showName, "Newer Show");
  assert.deepEqual(dataset.filters.genres, ["Comedy", "Drama"]);
  assert.deepEqual(dataset.filters.languages, ["English"]);
  assert.deepEqual(dataset.filters.services, ["ABC", "Example+"]);
  assert.equal(dataset.majorCount, 1);
});
