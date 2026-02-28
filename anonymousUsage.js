import { getAnonymousUsageCollection } from './db.js';

export const ANONYMOUS_LIMITS = {
  tts: 3,
  stt: 2,
  translate: 3,
};

export const ANONYMOUS_MAX_CHARS = {
  tts: 200,
  translate: 500,
};

const VALID_FEATURES = ['tts', 'stt', 'translate'];

/**
 * Get current usage counts for an anonymous user.
 * @param {string} anonymousId
 * @returns {Promise<{ tts: number, stt: number, translate: number }>}
 */
export async function getAnonymousUsage(anonymousId) {
  if (!anonymousId || typeof anonymousId !== 'string') {
    return { tts: 0, stt: 0, translate: 0 };
  }
  const col = getAnonymousUsageCollection();
  const doc = await col.findOne(
    { anonymousId: String(anonymousId).slice(0, 128) },
    { projection: { tts: 1, stt: 1, translate: 1 } }
  );
  return {
    tts: doc?.tts ?? 0,
    stt: doc?.stt ?? 0,
    translate: doc?.translate ?? 0,
  };
}

/**
 * Check if anonymous user can use the feature (under limit).
 * @param {string} anonymousId
 * @param {'tts'|'stt'|'translate'} feature
 * @returns {Promise<boolean>}
 */
export async function checkAnonymousLimit(anonymousId, feature) {
  if (!VALID_FEATURES.includes(feature)) return false;
  const usage = await getAnonymousUsage(anonymousId);
  const limit = ANONYMOUS_LIMITS[feature];
  return usage[feature] < limit;
}

/**
 * Increment usage for a feature. Call after successful Sarvam call.
 * @param {string} anonymousId
 * @param {'tts'|'stt'|'translate'} feature
 */
export async function incrementAnonymousUsage(anonymousId, feature) {
  if (!anonymousId || !VALID_FEATURES.includes(feature)) return;
  const col = getAnonymousUsageCollection();
  await col.updateOne(
    { anonymousId: String(anonymousId).slice(0, 128) },
    { $inc: { [feature]: 1 }, $setOnInsert: { anonymousId: String(anonymousId).slice(0, 128) } },
    { upsert: true }
  );
}
