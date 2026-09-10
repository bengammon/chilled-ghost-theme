import { API_BASE, RETRY } from '../config.js';

// A failure that will not fix itself: the key is wrong, revoked, or lacks Pro.
// Worth an email the moment it happens rather than after three silent runs.
export class FatalApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'FatalApiError';
    this.status = status;
    this.fatal = true;
  }
}

// A failure that plausibly clears on its own — upstream 5xx, rate limit, socket reset.
export class TransientApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TransientApiError';
    this.status = status;
    this.fatal = false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient(apiKey, { fetchImpl = fetch } = {}) {
  if (!apiKey) throw new FatalApiError('HEVY_API_KEY is not set', 0);

  async function request(path, params = {}) {
    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    let lastErr;
    for (let attempt = 1; attempt <= RETRY.attempts; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, {
          headers: { 'api-key': apiKey, accept: 'application/json' },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        // Network-level failure (DNS, TCP, timeout). Always worth a retry.
        lastErr = new TransientApiError(`network error on ${path}: ${err.message}`, 0);
        if (attempt < RETRY.attempts) await sleep(RETRY.baseDelayMs * 2 ** (attempt - 1));
        continue;
      }

      if (res.ok) return res.json();

      if (res.status === 401 || res.status === 403) {
        throw new FatalApiError(`Hevy rejected the API key (${res.status}) on ${path}`, res.status);
      }
      if (res.status >= 500 || res.status === 429) {
        lastErr = new TransientApiError(`Hevy returned ${res.status} on ${path}`, res.status);
        if (attempt < RETRY.attempts) {
          // Honour Retry-After when the server sends one, else exponential backoff.
          const retryAfter = Number(res.headers.get('retry-after'));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : RETRY.baseDelayMs * 2 ** (attempt - 1);
          await sleep(wait);
        }
        continue;
      }
      // Any other 4xx is a bug in this script, not a blip. Don't burn retries on it.
      throw new FatalApiError(`Hevy returned ${res.status} on ${path}`, res.status);
    }
    throw lastErr;
  }

  // Walks every page of a paginated endpoint. `pick` pulls the array out of the envelope.
  async function paginate(path, pick, { pageSize = 10, params = {} } = {}) {
    const out = [];
    let page = 1;
    let pageCount = 1;
    do {
      const body = await request(path, { ...params, page, pageSize });
      const items = pick(body);
      if (!Array.isArray(items)) {
        throw new FatalApiError(`unexpected response shape from ${path}`, 0);
      }
      out.push(...items);
      pageCount = Number(body.page_count) || 1;
      page++;
      // Hard stop against a server that keeps claiming there is another page.
      if (page > 500) throw new FatalApiError(`runaway pagination on ${path}`, 0);
    } while (page <= pageCount);
    return out;
  }

  return {
    request,
    paginate,
    getAllWorkouts: () => paginate('/workouts', (b) => b.workouts),
    getWorkoutEvents: (since) =>
      paginate('/workouts/events', (b) => b.events, { params: { since } }),
    getBodyMeasurements: () =>
      paginate('/body_measurements', (b) => b.body_measurements),
    getWorkoutCount: async () => Number((await request('/workouts/count')).count) || 0,
  };
}
