import axios from 'axios';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST to Sarvam with exponential backoff retry on 429 (rate limit) and 503 (overload).
 * Sarvam enforces per-API-key rate limits shared across all users on the server key,
 * so transient 429/503s are expected under load, not a sign of a broken request.
 * All other statuses are returned as-is (callers already handle non-200 responses manually).
 */
export async function sarvamPost(url, data, config = {}) {
  let attempt = 0;
  for (;;) {
    const response = await axios.post(url, data, { ...config, validateStatus: () => true });
    const isTransient = response.status === 429 || response.status === 503;
    if (!isTransient || attempt >= MAX_RETRIES) return response;
    await sleep(BASE_DELAY_MS * 2 ** attempt);
    attempt += 1;
  }
}
