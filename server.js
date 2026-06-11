const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PPORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL,
      phone VARCHAR(50),
      project_type VARCHAR(100),
      budget VARCHAR(50),
      message TEXT,
      date DATE DEFAULT CURRENT_DATE,
      read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      title VARCHAR(100) NOT NULL,
      category VARCHAR(50),
      description TEXT,
      technologies TEXT[],
      live_url TEXT,
      image_url TEXT,
      display_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  
  const adminExists = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
  if (adminExists.rows.length === 0) {
    const hashedPassword = await bcrypt.hash('admin2025', 10);
    await pool.query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', ['admin', hashedPassword, 'admin']);
    console.log('✅ Admin created: admin / admin2025');
  }
  
  const projectsCount = await pool.query('SELECT COUNT(*) FROM projects');
  if (parseInt(projectsCount.rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO projects (title, category, description, technologies, live_url, display_order) VALUES
      ('Centre Nour Tamuda', 'Education', 'Complete web presence for a professional training center based in Morocco.', ARRAY['Next.js', 'Tailwind CSS', 'Framer Motion', 'Vercel'], 'https://centre-nour-tamuda.vercel.app/', 1),
      ('Titanium Gym', 'Fitness', 'High-energy platform for a serious fitness brand with booking system.', ARRAY['React.js', 'CSS Animations', 'Booking System', 'Vercel'], 'https://titanium-gym-five.vercel.app/', 2),
      ('P-Tale Coiffure', 'Beauty', 'Elegant editorial-style web presence for a premium hair salon.', ARRAY['HTML/CSS/JS', 'Booking Widget', 'Gallery System', 'Vercel'], 'https://p-tale-coiffure.vercel.app/', 3),
      ('La Maison Dorée', 'Restaurant', 'Une expérience culinaire unique à Casablanca. Menu interactif, réservation en ligne.', ARRAY['Next.js', 'Framer Motion', 'Reservation System', 'Vercel'], 'https://la-maison-dor-e-drab.vercel.app/', 4)
    `);
    console.log('✅ Default projects inserted');
  }
  console.log('✅ Database initialized');
}

initDB();

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = decoded;
    next();
  });
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, result.rows[0].password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: result.rows[0].id, username: result.rows[0].username }, process.env.JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, username: result.rows[0].username });
});

app.post('/api/messages', async (req, res) => {
  const { name, email, phone, projectType, budget, message } = req.body;
  const result = await pool.query(
    `INSERT INTO messages (name, email, phone, project_type, budget, message) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, email, phone, projectType, budget, message]
  );
  res.json({ success: true, message: result.rows[0] });
});

app.get('/api/messages', verifyToken, async (req, res) => {
  const result = await pool.query('SELECT * FROM messages ORDER BY date DESC, created_at DESC');
  res.json(result.rows);
});

app.delete('/api/messages/:id', verifyToken, async (req, res) => {
  await pool.query('DELETE FROM messages WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.delete('/api/messages', verifyToken, async (req, res) => {
  await pool.query('DELETE FROM messages');
  res.json({ success: true });
});

app.get('/api/projects', async (req, res) => {
  const result = await pool.query('SELECT * FROM projects ORDER BY display_order ASC, id ASC');
  res.json(result.rows);
});

app.post('/api/projects', verifyToken, async (req, res) => {
  const { title, category, description, technologies, live_url, image_url, display_order } = req.body;
  const result = await pool.query(
    `INSERT INTO projects (title, category, description, technologies, live_url, image_url, display_order) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [title, category, description, technologies || [], live_url, image_url, display_order || 999]
  );
  res.json(result.rows[0]);
});

app.put('/api/projects/:id', verifyToken, async (req, res) => {
  const { title, category, description, technologies, live_url, image_url, display_order } = req.body;
  const result = await pool.query(
    `UPDATE projects SET title=$1, category=$2, description=$3, technologies=$4, live_url=$5, image_url=$6, display_order=$7 WHERE id=$8 RETURNING *`,
    [title, category, description, technologies || [], live_url, image_url, display_order, req.params.id]
  );
  res.json(result.rows[0]);
});

app.delete('/api/projects/:id', verifyToken, async (req, res) => {
  await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/stats', verifyToken, async (req, res) => {
  const totalMessages = await pool.query('SELECT COUNT(*) FROM messages');
  const todayMessages = await pool.query("SELECT COUNT(*) FROM messages WHERE date = CURRENT_DATE");
  const totalProjects = await pool.query('SELECT COUNT(*) FROM projects');
  const unreadMessages = await pool.query("SELECT COUNT(*) FROM messages WHERE read = false");
  res.json({
    totalMessages: parseInt(totalMessages.rows[0].count),
    todayMessages: parseInt(todayMessages.rows[0].count),
    totalProjects: parseInt(totalProjects.rows[0].count),
    unreadMessages: parseInt(unreadMessages.rows[0].count)
  });
});

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));
app.get('/admin', (req, res) => res.sendFile(__dirname + '/admin.html'));

app.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
