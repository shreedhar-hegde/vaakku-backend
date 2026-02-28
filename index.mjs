import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import fs from 'fs';
import { initDb } from './db.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import aiRoutes from './routes/ai.js';
import adminRoutes from './routes/admin.js';
import historyRoutes from './routes/history.js';

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();
const PORT = process.env.PORT || 4000;
const corsOrigin = process.env.FRONTEND_URL || true;

app.use(helmet());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 200,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AI_MAX, 10) || 60,
  message: { error: 'Too many AI requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', generalLimiter);
app.use('/api/ai', aiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/admin', adminRoutes);

app.get('/health', (_, res) => res.json({ ok: true }));

initDb()
  .then(() => {
    app.listen(PORT, () => {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`VaakkuAI server running at http://localhost:${PORT}`);
      }
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
