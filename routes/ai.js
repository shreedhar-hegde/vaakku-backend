import { Router } from 'express';
import axios from 'axios';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import FormData from 'form-data';
import { ObjectId } from 'mongodb';
import { optionalAuth } from '../middleware/auth.js';
import { getUsersCollection, getStatsCollection } from '../db.js';
import { saveHistory, buildTtsPayload, buildSttPayload, buildTranslatePayload } from '../history.js';
import { getDecryptedSarvamKey } from './user.js';
import {
  checkAnonymousLimit,
  incrementAnonymousUsage,
  ANONYMOUS_LIMITS,
  ANONYMOUS_MAX_CHARS,
} from '../anonymousUsage.js';

function recordUsage(feature) {
  getStatsCollection().updateOne({ _id: 'global' }, { $inc: { [feature]: 1 } }).catch(() => {});
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '..', 'uploads');

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 25 * 1024 * 1024 },
});

const router = Router();
const SARVAM_BASE = 'https://api.sarvam.ai';

/** Return a safe user-facing message; avoid leaking config in production. */
function toSafeErrorMsg(err, fallback) {
  if (process.env.NODE_ENV === 'production') return fallback;
  return err?.message === 'SARVAM_API_KEY not set' ? 'Server misconfiguration' : (err?.message || fallback);
}

function getServerApiKey() {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error('SARVAM_API_KEY not set');
  return key;
}

async function getApiKeyForUser(userId) {
  const userKey = await getDecryptedSarvamKey(userId);
  if (userKey) return { apiKey: userKey, useOwnKey: true };
  return { apiKey: getServerApiKey(), useOwnKey: false };
}

function sarvamHeaders(apiKey) {
  return { 'api-subscription-key': apiKey, 'Content-Type': 'application/json' };
}

async function deductCredits(userId, amount) {
  const users = getUsersCollection();
  const ceil = Math.ceil(amount);
  const result = await users.findOneAndUpdate(
    { _id: new ObjectId(userId), credits: { $gte: ceil } },
    { $inc: { credits: -ceil } },
    { returnDocument: 'after' }
  );
  return result != null;
}

async function refundCredits(userId, amount) {
  const users = getUsersCollection();
  await users.updateOne(
    { _id: new ObjectId(userId) },
    { $inc: { credits: Math.ceil(amount) } }
  );
}

router.use(optionalAuth);

function getAnonymousId(req) {
  const id = req.headers['x-anonymous-id'];
  return typeof id === 'string' ? id.trim().slice(0, 128) : null;
}

router.post('/tts', async (req, res) => {
  try {
    const isAnonymous = !req.user;
    const anonymousId = getAnonymousId(req);

    if (isAnonymous) {
      if (!anonymousId) {
        return res.status(403).json({ error: 'Sign up or sign in to use Text to Speech.', code: 'ANONYMOUS_ID_REQUIRED' });
      }
      const canUse = await checkAnonymousLimit(anonymousId, 'tts');
      if (!canUse) {
        return res.status(403).json({
          error: `Anonymous limit reached (${ANONYMOUS_LIMITS.tts} tries). Sign up for more.`,
          code: 'ANONYMOUS_LIMIT_REACHED',
          limit: ANONYMOUS_LIMITS.tts,
          feature: 'tts',
        });
      }
      const textLen = String(req.body?.text || '').length;
      if (textLen > ANONYMOUS_MAX_CHARS.tts) {
        return res.status(400).json({
          error: `Anonymous users can use up to ${ANONYMOUS_MAX_CHARS.tts} characters. Sign up for more.`,
          code: 'ANONYMOUS_CHAR_LIMIT',
          max: ANONYMOUS_MAX_CHARS.tts,
        });
      }
    }

    const { apiKey, useOwnKey } = isAnonymous
      ? { apiKey: getServerApiKey(), useOwnKey: false }
      : await getApiKeyForUser(req.user.id);

    const { text, target_language_code, speaker, model = 'bulbul:v3', pace } = req.body;
    if (!text || !target_language_code) {
      return res.status(400).json({ error: 'text and target_language_code required' });
    }

    const maxChars = isAnonymous ? ANONYMOUS_MAX_CHARS.tts : 2500;
    const textSliced = String(text).slice(0, maxChars);
    const charCount = textSliced.length;
    const cost = (model === 'bulbul:v3' ? 30 : 15) * (charCount / 10000);

    if (!isAnonymous && !useOwnKey && !(await deductCredits(req.user.id, cost))) {
      return res.status(402).json({ error: 'Insufficient credits' });
    }

    const payload = {
      text: textSliced,
      target_language_code,
      model,
      ...(speaker && { speaker }),
      ...(pace != null && { pace: Number(pace) }),
    };

    const { data, status } = await axios.post(`${SARVAM_BASE}/text-to-speech`, payload, {
      headers: sarvamHeaders(apiKey),
      responseType: 'json',
      validateStatus: () => true,
    });

    if (status !== 200) {
      if (!isAnonymous && !useOwnKey) await refundCredits(req.user.id, cost);
      return res.status(status).json(data?.error || data || { error: 'TTS failed' });
    }

    recordUsage('tts');
    if (isAnonymous) {
      await incrementAnonymousUsage(anonymousId, 'tts');
    } else {
      saveHistory(req.user.id, 'tts', buildTtsPayload(req.body, data)).catch(() => {});
    }
    res.json(data);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('TTS error:', err);
    res.status(500).json({ error: toSafeErrorMsg(err, 'TTS failed') });
  }
});

router.post('/stt', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Audio file required' });
  }

  const filePath = req.file.path;
  const unlinkFile = () => fs.promises.unlink(filePath).catch(() => {});

  try {
    const isAnonymous = !req.user;
    const anonymousId = getAnonymousId(req);

    if (isAnonymous) {
      if (!anonymousId) {
        await unlinkFile();
        return res.status(403).json({ error: 'Sign up or sign in to use Speech to Text.', code: 'ANONYMOUS_ID_REQUIRED' });
      }
      const canUse = await checkAnonymousLimit(anonymousId, 'stt');
      if (!canUse) {
        await unlinkFile();
        return res.status(403).json({
          error: `Anonymous limit reached (${ANONYMOUS_LIMITS.stt} tries). Sign up for more.`,
          code: 'ANONYMOUS_LIMIT_REACHED',
          limit: ANONYMOUS_LIMITS.stt,
          feature: 'stt',
        });
      }
    }

    const { apiKey, useOwnKey } = isAnonymous
      ? { apiKey: getServerApiKey(), useOwnKey: false }
      : await getApiKeyForUser(req.user.id);

    const cost = 0.25;
    if (!isAnonymous && !useOwnKey && !(await deductCredits(req.user.id, cost))) {
      await unlinkFile();
      return res.status(402).json({ error: 'Insufficient credits' });
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath), { filename: req.file.originalname || 'audio.wav' });
    form.append('model', 'saaras:v3');
    form.append('mode', req.body.mode || 'transcribe');
    if (req.body.language_code) form.append('language_code', req.body.language_code);

    const { data, status } = await axios.post(`${SARVAM_BASE}/speech-to-text`, form, {
      headers: { ...form.getHeaders(), 'api-subscription-key': apiKey },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });

    await unlinkFile();

    if (status !== 200) {
      if (!isAnonymous && !useOwnKey) await refundCredits(req.user.id, cost);
      return res.status(status).json(data?.error || data || { error: 'STT failed' });
    }

    recordUsage('stt');
    if (isAnonymous) {
      await incrementAnonymousUsage(anonymousId, 'stt');
    } else {
      saveHistory(req.user.id, 'stt', buildSttPayload(req, data)).catch(() => {});
    }
    res.json(data);
  } catch (err) {
    unlinkFile();
    if (process.env.NODE_ENV !== 'production') console.error('STT error:', err);
    res.status(500).json({ error: toSafeErrorMsg(err, 'STT failed') });
  }
});

router.post('/translate', async (req, res) => {
  try {
    const isAnonymous = !req.user;
    const anonymousId = getAnonymousId(req);

    if (isAnonymous) {
      if (!anonymousId) {
        return res.status(403).json({ error: 'Sign up or sign in to use Translation.', code: 'ANONYMOUS_ID_REQUIRED' });
      }
      const canUse = await checkAnonymousLimit(anonymousId, 'translate');
      if (!canUse) {
        return res.status(403).json({
          error: `Anonymous limit reached (${ANONYMOUS_LIMITS.translate} tries). Sign up for more.`,
          code: 'ANONYMOUS_LIMIT_REACHED',
          limit: ANONYMOUS_LIMITS.translate,
          feature: 'translate',
        });
      }
      const inputLen = String(req.body?.input || '').length;
      if (inputLen > ANONYMOUS_MAX_CHARS.translate) {
        return res.status(400).json({
          error: `Anonymous users can use up to ${ANONYMOUS_MAX_CHARS.translate} characters. Sign up for more.`,
          code: 'ANONYMOUS_CHAR_LIMIT',
          max: ANONYMOUS_MAX_CHARS.translate,
        });
      }
    }

    const { apiKey, useOwnKey } = isAnonymous
      ? { apiKey: getServerApiKey(), useOwnKey: false }
      : await getApiKeyForUser(req.user.id);

    const { input, source_language_code, target_language_code, model = 'mayura:v1' } = req.body;
    if (!input || source_language_code == null || !target_language_code) {
      return res.status(400).json({ error: 'input, source_language_code, and target_language_code required' });
    }

    const maxChars = isAnonymous ? ANONYMOUS_MAX_CHARS.translate : 1000;
    const inputSliced = String(input).slice(0, maxChars);
    const charCount = inputSliced.length;
    const cost = 20 * (charCount / 10000);

    if (!isAnonymous && !useOwnKey && !(await deductCredits(req.user.id, cost))) {
      return res.status(402).json({ error: 'Insufficient credits' });
    }

    const payload = {
      input: inputSliced,
      source_language_code: source_language_code === 'auto' ? 'auto' : source_language_code,
      target_language_code,
      ...(model && { model }),
    };

    const { data, status } = await axios.post(`${SARVAM_BASE}/translate`, payload, {
      headers: sarvamHeaders(apiKey),
      responseType: 'json',
      validateStatus: () => true,
    });

    if (status !== 200) {
      if (!isAnonymous && !useOwnKey) await refundCredits(req.user.id, cost);
      return res.status(status).json(data?.error || data || { error: 'Translation failed' });
    }

    recordUsage('translate');
    if (isAnonymous) {
      await incrementAnonymousUsage(anonymousId, 'translate');
    } else {
      saveHistory(req.user.id, 'translate', buildTranslatePayload(req.body, data)).catch(() => {});
    }
    res.json(data);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('Translate error:', err);
    res.status(500).json({ error: toSafeErrorMsg(err, 'Translation failed') });
  }
});

export default router;
