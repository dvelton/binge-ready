export class TVMazeRequestError extends Error {
  constructor(status, url) {
    super(`TVMaze request failed (${status}): ${url}`);
    this.name = "TVMazeRequestError";
    this.status = status;
    this.url = url;
  }
}

export async function fetchShowSeasons(showId, request) {
  try {
    return {
      missing: false,
      seasons: await request(`https://api.tvmaze.com/shows/${showId}/seasons`)
    };
  } catch (error) {
    if (
      error instanceof TVMazeRequestError &&
      (error.status === 404 || error.status === 410)
    ) {
      return { missing: true, seasons: [] };
    }
    throw error;
  }
}

export async function refreshShowSeasons({
  showId,
  cached,
  updatedIds,
  request,
  now = new Date()
}) {
  const fetchedAt = cached?.fetchedAt ? new Date(cached.fetchedAt) : null;
  const age = fetchedAt
    ? now.getTime() - fetchedAt.getTime()
    : Number.POSITIVE_INFINITY;
  const fresh = cached?.missing
    ? age < 7 * 24 * 60 * 60 * 1000
    : age < 24 * 60 * 60 * 1000 ||
      (age < 7 * 24 * 60 * 60 * 1000 && !updatedIds.has(showId));

  if (fresh) {
    return { entry: cached, fetched: false };
  }

  const metadata = await fetchShowSeasons(showId, request);
  return {
    entry: {
      fetchedAt: now.toISOString(),
      seasons: metadata.seasons,
      ...(metadata.missing ? { missing: true } : {})
    },
    fetched: true
  };
}
