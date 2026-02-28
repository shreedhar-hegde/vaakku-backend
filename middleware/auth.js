import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { getUsersCollection } from '../db.js';
import { getJwtSecret } from '../lib/jwt.js';

const USER_PROJECTION = { email: 1, credits: 1, sarvam_api_key_enc: 1, admin: 1 };

function attachUser(req, user, userId) {
  req.user = {
    id: userId,
    email: user.email,
    credits: user.credits,
    hasSarvamKey: !!user.sarvam_api_key_enc,
    isAdmin: !!user.admin,
  };
}

function parseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

/**
 * @param {string} token - JWT string
 * @param {(err: Error | null, result: { user, userId } | null) => void} cb - err set on DB failure, result null on invalid/missing user
 */
function verifyAndLoadUser(token, cb) {
  let userId;
  try {
    const payload = jwt.verify(token, getJwtSecret());
    userId = payload.userId;
  } catch {
    return cb(null, null);
  }
  getUsersCollection()
    .findOne({ _id: new ObjectId(userId) }, { projection: USER_PROJECTION })
    .then((user) => cb(null, user ? { user, userId } : null))
    .catch((err) => {
      if (process.env.NODE_ENV !== 'production') console.error('Auth error:', err);
      cb(err, null);
    });
}

export function authRequired(req, res, next) {
  const token = parseToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  verifyAndLoadUser(token, (err, result) => {
    if (err) return res.status(500).json({ error: 'Authentication error' });
    if (!result) return res.status(401).json({ error: 'Invalid or expired token' });
    attachUser(req, result.user, result.userId);
    next();
  });
}

/**
 * Optional auth: if valid JWT present, set req.user; otherwise set req.user = null.
 * Use for routes that support both authenticated and anonymous access.
 */
export function optionalAuth(req, res, next) {
  const token = parseToken(req.headers.authorization);
  if (!token) {
    req.user = null;
    return next();
  }

  verifyAndLoadUser(token, (err, result) => {
    if (err) req.user = null;
    else if (result) attachUser(req, result.user, result.userId);
    else req.user = null;
    next();
  });
}
