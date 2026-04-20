import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { createUser, getUserByUsername } from './db.js';
import { generateToken } from './middleware/auth.js';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }
  if (username.trim().length < 3) {
    return res.status(400).json({ error: 'Username minimal 3 karakter' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter' });
  }

  try {
    const existing = await getUserByUsername(username.trim());
    if (existing) {
      return res.status(409).json({ error: 'Username sudah digunakan' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createUser(uuidv4(), username.trim(), passwordHash);
    const token = generateToken(user);

    res.status(201).json({ data: { user, token } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  try {
    const user = await getUserByUsername(username.trim());
    if (!user) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }

    const safeUser = { id: user.id, username: user.username, created_at: user.created_at };
    const token = generateToken(safeUser);

    res.json({ data: { user: safeUser, token } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  // requireAuth already set req.user from JWT
  res.json({ data: req.user });
});

export default router;
