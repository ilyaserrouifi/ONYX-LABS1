const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ============================================
// DATABASE CONNECTION (Neon PostgreSQL)
// ============================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ============================================
// INITIALIZE DATABASE TABLES
// ============================================
async function initDB() {
  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Users table ready');

    // Messages table
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
    console.log('✅ Messages table ready');

    // Projects table
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
    console.log('✅ Projects table ready');

    // Insert default admin if not exists
    const adminExists = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
    if (adminExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin2025', 10);
      await pool.query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', ['admin', hashedPassword, 'admin']);
      console.log('✅ Admin created: username=admin, password=admin2025');
    } else {
      console.log('✅ Admin already exists');
    }

    // Insert default projects if empty
    const projectsCount = await pool.query('SELECT COUNT(*) FROM projects');
    if (parseInt(projectsCount.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO projects (title, category, description, technologies, live_url, display_order) VALUES
        ('Centre Nour Tamuda', 'Education', 'Complete web presence for a professional training center based in Morocco. The platform showcases training programs, coaching services, and methodology.', ARRAY['Next.js', 'Tailwind CSS', 'Framer Motion', 'Vercel'], 'https://centre-nour-tamuda.vercel.app/', 1),
        ('Titanium Gym', 'Fitness', 'High-energy platform for a serious fitness brand. Bold, dark, performance-focused website with class schedules, membership tiers, and online booking system.', ARRAY['React.js', 'CSS Animations', 'Booking System', 'Vercel'], 'https://titanium-gym-five.vercel.app/', 2),
        ('P-Tale Coiffure', 'Beauty', 'Elegant editorial-style web presence for a premium hair salon that communicates luxury and enables direct appointment booking.', ARRAY['HTML/CSS/JS', 'Booking Widget', 'Gallery System', 'Vercel'], 'https://p-tale-coiffure.vercel.app/', 3),
        ('La Maison Dorée', 'Restaurant', 'Une expérience culinaire unique au cœur de Casablanca. Fondée en 2018, La Maison Dorée incarne l\'alliance parfaite entre l\'élégance française et l\'hospitalité marocaine.', ARRAY['Next.js', 'Framer Motion', 'Reservation System', 'Vercel'], 'https://la-maison-dor-e-drab.vercel.app/', 4)
      `);
      console.log('✅ Default projects inserted');
    } else {
      console.log('✅ Projects already exist');
    }

    console.log('🎉 Database initialized successfully!');
    console.log('📊 Tables: users, messages, projects');
  } catch (err) {
    console.error('❌ Database initialization error:', err);
  }
}

initDB();

// ============================================
// AUTH MIDDLEWARE
// ============================================
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Invalid token format' });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = decoded;
    next();
  });
}

// ============================================
// LOGIN ROUTE
// ============================================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, result.rows[0].password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: result.rows[0].id, username: result.rows[0].username, role: result.rows[0].role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, username: result.rows[0].username, role: result.rows[0].role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// MESSAGES ROUTES
// ============================================
app.post('/api/messages', async (req, res) => {
  const { name, email, phone, projectType, budget, message } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO messages (name, email, phone, project_type, budget, message) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, email, phone, projectType, budget, message]
    );
    res.json({ success: true, message: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM messages ORDER BY date DESC, created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/messages/:id', verifyToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM messages WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/messages', verifyToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM messages');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PROJECTS ROUTES
// ============================================
app.get('/api/projects', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM projects ORDER BY display_order ASC, id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', verifyToken, async (req, res) => {
  const { title, category, description, technologies, live_url, image_url, display_order } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO projects (title, category, description, technologies, live_url, image_url, display_order) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, category, description, technologies || [], live_url, image_url, display_order || 999]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', verifyToken, async (req, res) => {
  const { title, category, description, technologies, live_url, image_url, display_order } = req.body;
  try {
    const result = await pool.query(
      `UPDATE projects SET title=$1, category=$2, description=$3, technologies=$4, live_url=$5, image_url=$6, display_order=$7 
       WHERE id=$8 RETURNING *`,
      [title, category, description, technologies || [], live_url, image_url, display_order, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/projects/:id', verifyToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// STATS ROUTE
// ============================================
app.get('/api/stats', verifyToken, async (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// TEST DATABASE ROUTE
// ============================================
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as time, version() as pg_version');
    res.json({
      success: true,
      message: '✅ Database connected successfully!',
      server_time: result.rows[0].time,
      postgres_version: result.rows[0].pg_version
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      message: '❌ Database connection failed! Check your DATABASE_URL'
    });
  }
});

// ============================================
// SERVE FILES
// ============================================
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.get('/admin', (req, res) => {
  res.sendFile(__dirname + '/admin.html');
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Test database: http://localhost:${PORT}/api/test-db`);
  console.log(`🌐 Website: http://localhost:${PORT}`);
  console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
  console.log(`\n📝 Default login: admin / admin2025\n`);
});
