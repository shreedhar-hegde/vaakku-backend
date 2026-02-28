import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { adminRequired } from '../middleware/admin.js';
import { getUsersCollection, getStatsCollection } from '../db.js';

const router = Router();
router.use(authRequired);
router.use(adminRequired);

router.get('/stats', async (req, res) => {
  try {
    const users = getUsersCollection();
    const stats = getStatsCollection();
    await users.updateMany(
      { createdAt: { $exists: false } },
      [{ $set: { createdAt: { $ifNull: ['$lastActiveAt', new Date(0)] } } }]
    );
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const hasApiKeyFilter = { sarvam_api_key_enc: { $exists: true, $ne: null } };
    const noApiKeyFilter = { $or: [{ sarvam_api_key_enc: { $exists: false } }, { sarvam_api_key_enc: null }] };

    const [
      totalUsers,
      signupsLast7Days,
      appSharedCreditsResult,
      usersWithApiKeyCount,
      creditsUsersWithKeyResult,
      usageDoc,
      recentSignups,
    ] = await Promise.all([
      users.countDocuments(),
      users.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      users.aggregate([{ $match: noApiKeyFilter }, { $group: { _id: null, total: { $sum: '$credits' } } }]).toArray(),
      users.countDocuments(hasApiKeyFilter),
      users.aggregate([{ $match: hasApiKeyFilter }, { $group: { _id: null, total: { $sum: '$credits' } } }]).toArray(),
      stats.findOne({ _id: 'global' }),
      users
        .find({}, { projection: { email: 1, createdAt: 1, lastActiveAt: 1 } })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray(),
    ]);

    const tts = usageDoc?.tts ?? 0;
    const stt = usageDoc?.stt ?? 0;
    const translate = usageDoc?.translate ?? 0;
    const totalUsage = tts + stt + translate;
    const mostUsed =
      totalUsage === 0
        ? null
        : [['tts', tts], ['stt', stt], ['translate', translate]].sort((a, b) => b[1] - a[1])[0][0];

    res.json({
      totalUsers,
      signupsLast7Days,
      appSharedCredits: appSharedCreditsResult[0]?.total ?? 0,
      usersWithApiKeyCount,
      creditsUsersWithKey: creditsUsersWithKeyResult[0]?.total ?? 0,
      usage: { tts, stt, translate },
      mostUsedFeature: mostUsed,
      recentSignups: recentSignups.map((u) => ({
        email: u.email,
        createdAt: u.createdAt ? u.createdAt.toISOString() : null,
        lastActiveAt: u.lastActiveAt ? u.lastActiveAt.toISOString() : null,
      })),
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

export default router;
