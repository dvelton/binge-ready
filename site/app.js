const STORAGE_KEYS = {
  saved: "binge-ready:saved",
  watched: "binge-ready:watched",
  hideWatched: "binge-ready:hide-watched"
};

const state = {
  data: null,
  view: "ready",
  relevance: "major",
  search: "",
  range: "7",
  service: "",
  genre: "",
  language: "English",
  country: "",
  savedOnly: false,
  hideWatched: readBoolean(STORAGE_KEYS.hideWatched),
  saved: readSet(STORAGE_KEYS.saved),
  watched: readSet(STORAGE_KEYS.watched)
};

const elements = {
  feed: document.querySelector("#feed"),
  search: document.querySelector("#search"),
  service: document.querySelector("#service"),
  genre: document.querySelector("#genre"),
  language: document.querySelector("#language"),
  country: document.querySelector("#country"),
  savedOnly: document.querySelector("#saved-only"),
  hideWatched: document.querySelector("#hide-watched"),
  hideWatchedControl: document.querySelector("#hide-watched-control"),
  resultCount: document.querySelector("#result-count"),
  readyCount: document.querySelector("#ready-count"),
  updatedAt: document.querySelector("#updated-at"),
  clearFilters: document.querySelector("#clear-filters"),
  emptyState: document.querySelector("#empty-state"),
  errorState: document.querySelector("#error-state"),
  template: document.querySelector("#card-template")
};

function readSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]"));
  } catch {
    return new Set();
  }
}

function readBoolean(key) {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function saveSet(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify([...values]));
  } catch {
    // The feed still works when browser storage is unavailable.
  }
}

function savePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences remain in memory for this visit.
  }
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: new Date().getFullYear() === date.getFullYear() ? undefined : "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatRelativeDays(days) {
  if (days === 0) {
    return "Today";
  }
  if (days === 1) {
    return "Yesterday";
  }
  return `${days} days ago`;
}

function formatFutureDays(days) {
  if (days === 0) {
    return "Later today";
  }
  if (days === 1) {
    return "Tomorrow";
  }
  return `In ${days} days`;
}

function plural(value, singular, pluralForm = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

function utcToday() {
  return new Date().toISOString().slice(0, 10);
}

function dayDistance(later, earlier) {
  return Math.round(
    (Date.parse(`${later}T12:00:00Z`) - Date.parse(`${earlier}T12:00:00Z`)) /
      (24 * 60 * 60 * 1000)
  );
}

function isReady(item) {
  const readyAt = Date.parse(item.readyAt);
  return Number.isFinite(readyAt)
    ? readyAt <= Date.now()
    : item.finaleDate <= utcToday();
}

function timingDays(item) {
  return state.view === "ready"
    ? Math.max(0, dayDistance(utcToday(), item.finaleDate))
    : Math.max(0, dayDistance(item.finaleDate, utcToday()));
}

function itemsForView() {
  const items = [...state.data.finales, ...state.data.upcoming].filter(
    (item) =>
      (state.relevance === "all" || item.major) &&
      (state.view === "ready" ? isReady(item) : !isReady(item))
  );

  return items.sort((left, right) => {
    const dateOrder =
      state.view === "ready"
        ? right.finaleDate.localeCompare(left.finaleDate)
        : left.finaleDate.localeCompare(right.finaleDate);
    return dateOrder || left.showName.localeCompare(right.showName);
  });
}

function addOptions(select, values, getValue = (value) => value, getLabel = (value) => value) {
  const fragment = document.createDocumentFragment();
  for (const item of values) {
    const option = document.createElement("option");
    option.value = getValue(item);
    option.textContent = getLabel(item);
    fragment.append(option);
  }
  select.append(fragment);
}

function filteredFinales() {
  if (!state.data) {
    return [];
  }

  const terms = state.search
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const maxDays = state.range === "all" ? Number.POSITIVE_INFINITY : Number(state.range);

  const items = itemsForView();

  return items.filter((item) => {
    const haystack = [
      item.showName,
      item.service,
      item.countryName,
      ...item.genres
    ]
      .join(" ")
      .toLocaleLowerCase();

    const inRange =
      state.range === "all" ||
      (state.view === "ready" ? timingDays(item) < maxDays : timingDays(item) <= maxDays);

    return (
      inRange &&
      (!terms.length || terms.every((term) => haystack.includes(term))) &&
      (!state.service || item.service === state.service) &&
      (!state.genre || item.genres.includes(state.genre)) &&
      (!state.language || item.language === state.language) &&
      (!state.country || item.countryCode === state.country) &&
      (!state.savedOnly || state.saved.has(item.id)) &&
      (state.view !== "ready" || !state.hideWatched || !state.watched.has(item.id))
    );
  });
}

function groupByFinaleDate(finales) {
  const groups = new Map();
  for (const item of finales) {
    const group = groups.get(item.finaleDate) ?? [];
    group.push(item);
    groups.set(item.finaleDate, group);
  }
  return groups;
}

function createCard(item) {
  const card = elements.template.content.firstElementChild.cloneNode(true);
  card.id = item.id;
  const image = card.querySelector(".show-card__poster");
  if (item.image) {
    image.src = item.image;
    image.alt = `${item.showName} poster`;
  } else {
    image.remove();
  }

  card.querySelector(".show-card__service").textContent =
    `${item.service} - ${item.countryName}`;
  card.querySelector(".show-card__title").textContent = item.showName;
  card.querySelector(".show-card__season").textContent = [
    `Season ${item.season}`,
    item.seasonName && item.seasonName !== `Season ${item.season}` ? item.seasonName : null,
    item.isSeriesFinale ? "Series finale" : null
  ]
    .filter(Boolean)
    .join(" - ");
  card.querySelector(".show-card__episodes").textContent = item.episodeCount
    ? plural(item.episodeCount, "episode")
    : "Complete";
  card.querySelector(".show-card__runtime").textContent = item.runtime
    ? `${item.runtime} min`
    : "Not listed";
  card.querySelector(".show-card__genres").textContent =
    item.genres.length > 0 ? item.genres.join(" / ") : item.language ?? "TV series";

  const badge = card.querySelector(".show-card__badge");
  if (state.view === "upcoming") {
    badge.textContent = formatFutureDays(timingDays(item));
    badge.classList.add("show-card__badge--upcoming");
  }

  const saveButton = card.querySelector(".save-button");
  const watchedButton = card.querySelector(".watched-button");
  updateToggleButton(saveButton, state.saved.has(item.id), "Saved", "Save");

  saveButton.addEventListener("click", () => {
    toggleSet(state.saved, item.id);
    saveSet(STORAGE_KEYS.saved, state.saved);
    render();
  });
  if (state.view === "ready") {
    updateToggleButton(watchedButton, state.watched.has(item.id), "Watched", "Mark watched");
    watchedButton.addEventListener("click", () => {
      toggleSet(state.watched, item.id);
      saveSet(STORAGE_KEYS.watched, state.watched);
      render();
    });
  } else {
    watchedButton.remove();
  }

  const details = card.querySelector(".details-link");
  details.href = item.sourceUrl;
  details.setAttribute("aria-label", `View ${item.showName} details on TVMaze`);
  return card;
}

function updateToggleButton(button, active, activeLabel, inactiveLabel) {
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-pressed", String(active));
  button.textContent = active ? activeLabel : inactiveLabel;
}

function toggleSet(set, value) {
  if (set.has(value)) {
    set.delete(value);
  } else {
    set.add(value);
  }
}

function render() {
  if (!state.data) {
    return;
  }
  updateCounts();
  const finales = filteredFinales();
  const fragment = document.createDocumentFragment();
  const groups = groupByFinaleDate(finales);

  for (const [date, items] of groups) {
    const section = document.createElement("section");
    section.className = "date-group";
    const heading = document.createElement("h2");
    heading.className = "date-group__heading";
    const dateObject = new Date(`${date}T12:00:00Z`);
    heading.append(formatDate(dateObject));
    const relative = document.createElement("span");
    relative.textContent =
      state.view === "ready"
        ? formatRelativeDays(timingDays(items[0]))
        : formatFutureDays(timingDays(items[0]));
    heading.append(relative);

    const grid = document.createElement("div");
    grid.className = "date-group__grid";
    grid.append(...items.map(createCard));
    section.append(heading, grid);
    fragment.append(section);
  }

  elements.feed.replaceChildren(fragment);
  elements.resultCount.textContent = `${plural(finales.length, "season")} shown`;
  elements.emptyState.hidden = finales.length > 0;
  elements.feed.hidden = finales.length === 0;
  elements.clearFilters.hidden = !hasActiveFilters();
}

function hasActiveFilters() {
  return Boolean(
    state.search ||
      state.range !== "7" ||
      state.service ||
      state.genre ||
      state.language !== "English" ||
      state.country ||
      state.relevance !== "major" ||
      state.savedOnly ||
      (state.view === "ready" && state.hideWatched)
  );
}

function updateCounts() {
  const items = [...state.data.finales, ...state.data.upcoming].filter(
    (item) => state.relevance === "all" || item.major
  );
  const readyCount = items.filter(isReady).length;
  const upcomingCount = items.length - readyCount;
  const qualifier = state.relevance === "major" ? "major " : "";

  elements.readyCount.textContent =
    `${readyCount.toLocaleString()} ${qualifier}ready / ` +
    `${upcomingCount.toLocaleString()} ${qualifier}upcoming`;
  document.querySelector("[data-view='ready']").textContent =
    `Ready now (${readyCount.toLocaleString()})`;
  document.querySelector("[data-view='upcoming']").textContent =
    `Coming up (${upcomingCount.toLocaleString()})`;
}

function setView(view) {
  state.view = view;
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  });
  elements.hideWatchedControl.hidden = view === "upcoming";
  render();
}

function setRelevance(relevance) {
  state.relevance = relevance;
  document.querySelectorAll("[data-relevance]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.relevance === relevance);
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.relevance === relevance)
    );
  });
  render();
}

function revealTarget(target) {
  state.view = isReady(target) ? "ready" : "upcoming";
  state.relevance = target.major ? "major" : "all";
  state.search = target.showName;
  state.range = "all";
  state.service = "";
  state.genre = "";
  state.language = "";
  state.country = "";
  state.savedOnly = false;
  state.hideWatched = false;

  elements.search.value = target.showName;
  elements.service.value = "";
  elements.genre.value = "";
  elements.language.value = "";
  elements.country.value = "";
  elements.savedOnly.checked = false;
  elements.hideWatched.checked = false;
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.range === "all");
  });
  document.querySelectorAll("[data-relevance]").forEach((button) => {
    const active = button.dataset.relevance === state.relevance;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function clearFilters() {
  state.search = "";
  state.range = "7";
  state.service = "";
  state.genre = "";
  state.language = "English";
  state.country = "";
  state.relevance = "major";
  state.savedOnly = false;
  state.hideWatched = false;
  savePreference(STORAGE_KEYS.hideWatched, "false");

  elements.search.value = "";
  elements.service.value = "";
  elements.genre.value = "";
  elements.language.value = "English";
  elements.country.value = "";
  elements.savedOnly.checked = false;
  elements.hideWatched.checked = false;
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.range === "7");
  });
  document.querySelectorAll("[data-relevance]").forEach((button) => {
    const active = button.dataset.relevance === "major";
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  render();
}

function bindEvents() {
  elements.search.addEventListener("input", (event) => {
    state.search = event.target.value.trim();
    render();
  });
  elements.service.addEventListener("change", (event) => {
    state.service = event.target.value;
    render();
  });
  elements.genre.addEventListener("change", (event) => {
    state.genre = event.target.value;
    render();
  });
  elements.language.addEventListener("change", (event) => {
    state.language = event.target.value;
    render();
  });
  elements.country.addEventListener("change", (event) => {
    state.country = event.target.value;
    render();
  });
  elements.savedOnly.addEventListener("change", (event) => {
    state.savedOnly = event.target.checked;
    render();
  });
  elements.hideWatched.addEventListener("change", (event) => {
    state.hideWatched = event.target.checked;
    savePreference(STORAGE_KEYS.hideWatched, String(state.hideWatched));
    render();
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  document.querySelectorAll("[data-relevance]").forEach((button) => {
    button.addEventListener("click", () => setRelevance(button.dataset.relevance));
  });
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      state.range = button.dataset.range;
      document.querySelectorAll("[data-range]").forEach((item) => {
        item.classList.toggle("is-active", item === button);
      });
      render();
    });
  });
  elements.clearFilters.addEventListener("click", clearFilters);
  document.querySelectorAll("[data-clear-filters]").forEach((button) => {
    button.addEventListener("click", clearFilters);
  });
  document.querySelectorAll("[data-retry]").forEach((button) => {
    button.addEventListener("click", loadData);
  });
}

async function loadData() {
  elements.errorState.hidden = true;
  try {
    const response = await fetch("data/finales.json", { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Data request failed with ${response.status}`);
    }

    state.data = await response.json();
    addOptions(elements.service, state.data.filters.services);
    addOptions(elements.genre, state.data.filters.genres);
    addOptions(elements.language, state.data.filters.languages);
    elements.language.value = state.data.filters.languages.includes("English")
      ? "English"
      : "";
    state.language = elements.language.value;
    addOptions(
      elements.country,
      state.data.filters.countries,
      (item) => item.code,
      (item) => item.name
    );
    elements.hideWatched.checked = state.hideWatched;
    const allItems = [...state.data.finales, ...state.data.upcoming];
    elements.updatedAt.textContent = `Updated ${new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(state.data.generatedAt))}`;
    if (location.hash) {
      const id = location.hash.slice(1);
      const target = allItems.find((item) => item.id === id);
      if (target) {
        revealTarget(target);
      }
    }
    setView(state.view);

    if (location.hash) {
      requestAnimationFrame(() => document.querySelector(location.hash)?.scrollIntoView());
    }
  } catch (error) {
    console.error(error);
    elements.feed.hidden = true;
    elements.emptyState.hidden = true;
    elements.errorState.hidden = false;
    elements.resultCount.textContent = "Finale data is unavailable.";
    elements.readyCount.textContent = "Unavailable";
    elements.updatedAt.textContent = "Could not load the latest data";
  }
}

bindEvents();
loadData();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((error) => {
    console.warn("Service worker registration failed.", error);
  });
}
