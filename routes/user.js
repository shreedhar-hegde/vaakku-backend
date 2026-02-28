import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { authRequired } from '../middleware/auth.js';
import { getUsersCollection } from '../db.js';
import { encrypt, decrypt } from '../lib/encrypt.js';

const router = Router();

function isValidObjectId(str) {
  if (typeof str !== 'string' || !str) return false;
  try {
    return new ObjectId(str).toString() === str;
  } catch {
    return false;
  }
}

router.patch('/sarvam-api-key', authRequired, (req, res) => {
  const { sarvamApiKey } = req.body ?? {};
  const users = getUsersCollection();
  const userId = req.user.id;

  const raw = typeof sarvamApiKey === 'string' ? sarvamApiKey.trim() : '';
  const update = raw
    ? { $set: { sarvam_api_key_enc: encrypt(raw) } }
    : { $unset: { sarvam_api_key_enc: 1 } };

  users
    .updateOne({ _id: new ObjectId(userId) }, update)
    .then(() => res.json({ ok: true, hasSarvamKey: !!raw }))
    .catch((err) => res.status(500).json({ error: 'Failed to save API key' }));
});

export async function getDecryptedSarvamKey(userId) {
  if (!isValidObjectId(userId)) return null;
  const users = getUsersCollection();
  const user = await users.findOne({ _id: new ObjectId(userId) }, { projection: { sarvam_api_key_enc: 1 } });
  if (!user?.sarvam_api_key_enc) return null;
  return decrypt(user.sarvam_api_key_enc);
}

export default router;
