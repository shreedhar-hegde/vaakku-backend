import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { getHistoryCollection } from '../db.js';
import { trimHistoryForUser, HISTORY_CAP_PER_USER } from '../history.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  try {
    const userId = req.user.id;
    await trimHistoryForUser(userId);

    const type = req.query.type; // 'tts' | 'stt' | 'translate' or omit for all
    const col = getHistoryCollection();
    const filter = { userId };
    if (type && ['tts', 'stt', 'translate'].includes(type)) filter.type = type;

    const items = await col
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(HISTORY_CAP_PER_USER)
      .project({ userId: 0 })
      .toArray();

    res.json({ items });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('History list error:', err);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

export default router;
