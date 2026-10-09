export const FOTMOB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.fotmob.com/',
  'Origin': 'https://www.fotmob.com',
  'sec-ch-ua': '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
};

/**
 * Returns FOTMOB_HEADERS augmented with the FOTMOB_COOKIE env var when set.
 * The cookie contains a browser session that has passed Cloudflare Turnstile,
 * which is required for the playerData endpoint. Extract it from DevTools on
 * any successful playerData request on www.fotmob.com.
 */
export function playerDataHeaders(): Record<string, string> {
  const cookie = process.env.FOTMOB_COOKIE;
  if (!cookie) return FOTMOB_HEADERS;
  return { ...FOTMOB_HEADERS, Cookie: cookie };
}

export type FotmobHeaderKind = 'default' | 'player' | 'cdn';

/** Default per-request timeout. FotMob stalls are common; without this a hung upstream hangs our API route. */
export const FOTMOB_TIMEOUT_MS = 15_000;

/**
 * The single place that performs FotMob HTTP requests: standard headers, no Next fetch cache
 * (MongoDB is the cache layer), and a timeout. Throws on network error / timeout like `fetch`;
 * callers keep their own `res.ok` handling.
 *  - 'default': www.fotmob.com API
 *  - 'player':  playerData endpoint (adds FOTMOB_COOKIE when set)
 *  - 'cdn':     data.fotmob.com gzipped JSON
 */
export function fotmobFetch(
  url: string,
  kind: FotmobHeaderKind = 'default',
  timeoutMs: number = FOTMOB_TIMEOUT_MS,
): Promise<Response> {
  const headers =
    kind === 'player' ? playerDataHeaders()
    : kind === 'cdn' ? { ...FOTMOB_HEADERS, 'Accept-Encoding': 'gzip' }
    : FOTMOB_HEADERS;
  return fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
}
