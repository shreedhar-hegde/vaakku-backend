import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { getUsersCollection } from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { getJwtSecret } from '../lib/jwt.js';

const router = Router();
const SALT_ROUNDS = 10;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const EMAIL_MAX_LENGTH = 254;

function validatePassword(password) {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character';
  return null;
}

function validateEmail(email) {
  if (typeof email !== 'string') return 'Email is required';
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return 'Email is required';
  if (trimmed.length > EMAIL_MAX_LENGTH) return 'Email is too long';
  const basicEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!basicEmail.test(trimmed)) return 'Invalid email format';
  return null;
}

router.get('/me', authRequired, (req, res) => {
  const { id, email, hasSarvamKey, isAdmin, credits } = req.user;
  getUsersCollection()
    .updateOne({ _id: new ObjectId(id) }, { $set: { lastActiveAt: new Date() } })
    .catch(() => {});
  const user = { id, email, hasSarvamKey, isAdmin, credits: credits ?? 0 };
  res.json({ user });
});

router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ error: emailError });
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const normalizedEmail = email.trim().toLowerCase();
  const password_hash = bcrypt.hashSync(password, SALT_ROUNDS);
  const users = getUsersCollection();
  try {
    const result = await users.insertOne({
      email: normalizedEmail,
      password_hash,
      credits: 1000,
      createdAt: new Date(),
    });
    const id = result.insertedId.toString();
    const token = jwt.sign({ userId: id }, getJwtSecret(), { expiresIn: '7d' });
    res.status(201).json({
      user: { id, email: normalizedEmail, hasSarvamKey: false, isAdmin: false, credits: 1000 },
      token,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    throw err;
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const emailError = validateEmail(email);
  if (emailError) return res.status(400).json({ error: emailError });

  const normalizedEmail = email.trim().toLowerCase();
  const users = getUsersCollection();
  const user = await users.findOne(
    { email: normalizedEmail },
    { projection: { email: 1, password_hash: 1, credits: 1, sarvam_api_key_enc: 1, admin: 1 } }
  );
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const id = user._id.toString();
  const isAdmin = !!user.admin;
  await users.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date() } });
  const payload = { id, email: user.email, hasSarvamKey: !!user.sarvam_api_key_enc, isAdmin, credits: user.credits ?? 0 };
  const token = jwt.sign({ userId: id }, getJwtSecret(), { expiresIn: '7d' });
  res.json({ user: payload, token });
});

export default router;
