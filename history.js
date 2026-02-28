import { getHistoryCollection } from './db.js';

const MAX_INPUT = 500;
const MAX_OUTPUT = 2000;
export const HISTORY_CAP_PER_USER = 10;

/**
 * Remove oldest history entries for a user so only HISTORY_CAP_PER_USER remain. Idempotent.
 */
export async function trimHistoryForUser(userId) {
  if (!userId) return;
  try {
    const col = getHistoryCollection();
    const uid = String(userId);
    const toRemove = await col
      .find({ userId: uid })
      .sort({ createdAt: -1 })
      .skip(HISTORY_CAP_PER_USER)
      .project({ _id: 1 })
      .toArray();
    if (toRemove.length > 0) {
      await col.deleteMany({ _id: { $in: toRemove.map((r) => r._id) } });
    }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('trimHistoryForUser error:', err);
  }
}

/**
 * Save a history entry (fire-and-forget). Does not throw.
 * Keeps only the most recent HISTORY_CAP_PER_USER entries per user; deletes older ones.
 * @param {string} userId - MongoDB user ObjectId string
 * @param {'tts'|'stt'|'translate'} type
 * @param {object} payload - type-specific fields
 */
export async function saveHistory(userId, type, payload) {
  if (!userId || !type) return;
  try {
    const col = getHistoryCollection();
    const uid = String(userId);
    const doc = {
      userId: uid,
      type,
      ...payload,
      createdAt: new Date(),
    };
    await col.insertOne(doc);
    await trimHistoryForUser(uid);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('saveHistory error:', err);
  }
}

function truncate(str, max) {
  if (typeof str !== 'string') return '';
  return str.length <= max ? str : str.slice(0, max) + '…';
}

export function buildTtsPayload(reqBody, _resData) {
  const text = reqBody?.text ?? '';
  return {
    input: truncate(text, MAX_INPUT),
    target_language_code: reqBody?.target_language_code ?? null,
    model: reqBody?.model ?? null,
  };
}

export function buildSttPayload(_req, resData) {
  const transcript = resData?.text ?? resData?.transcript ?? (typeof resData === 'string' ? resData : '');
  return {
    inputLabel: 'Audio',
    output: truncate(String(transcript), MAX_OUTPUT),
  };
}

export function buildTranslatePayload(reqBody, resData) {
  const input = reqBody?.input ?? '';
  const output = resData?.output ?? resData?.translated_text ?? resData?.text ?? '';
  return {
    input: truncate(String(input), MAX_INPUT),
    output: truncate(String(output), MAX_OUTPUT),
    source_language_code: reqBody?.source_language_code ?? null,
    target_language_code: reqBody?.target_language_code ?? null,
  };
}
