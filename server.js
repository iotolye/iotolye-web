const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Uploads klasörü
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use('/uploads', express.static(uploadsDir));
app.use(session({
    secret: 'iotolye-secret-key-degistir-bunu',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ===== DATABASE =====
const db = new Database(path.join(__dirname, 'iotolye.db'));
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        tag TEXT DEFAULT 'ESP32',
        difficulty TEXT DEFAULT 'beginner',
        image TEXT,
        link TEXT,
        is_published INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        youtube_url TEXT,
        duration TEXT,
        thumbnail TEXT,
        is_published INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    );
`);

// Default admin oluştur (yoksa)
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hash);
    console.log('Default admin oluşturuldu: admin / admin123');
}

// ===== AUTH MIDDLEWARE =====
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) return next();
    res.status(401).json({ error: 'Giriş yapmanız gerekiyor' });
}

// ===== AUTH ROUTES =====
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Hatalı kullanıcı adı veya şifre' });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ success: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({ loggedIn: true, username: req.session.username });
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/change-password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!bcrypt.compareSync(currentPassword, user.password)) {
        return res.status(400).json({ error: 'Mevcut şifre hatalı' });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.session.userId);
    res.json({ success: true });
});

// ===== PROJECT ROUTES =====
app.get('/api/projects', (req, res) => {
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    res.json(projects);
});

app.get('/api/projects/published', (req, res) => {
    const projects = db.prepare('SELECT * FROM projects WHERE is_published = 1 ORDER BY created_at DESC').all();
    res.json(projects);
});

app.post('/api/projects', requireAuth, upload.single('image'), (req, res) => {
    const { title, description, tag, difficulty, link } = req.body;
    const image = req.file ? '/uploads/' + req.file.filename : null;
    const result = db.prepare(
        'INSERT INTO projects (title, description, tag, difficulty, image, link) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(title, description, tag || 'ESP32', difficulty || 'beginner', image, link);
    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/projects/:id', requireAuth, upload.single('image'), (req, res) => {
    const { title, description, tag, difficulty, link, is_published } = req.body;
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Proje bulunamadı' });

    const image = req.file ? '/uploads/' + req.file.filename : project.image;
    db.prepare(
        'UPDATE projects SET title=?, description=?, tag=?, difficulty=?, image=?, link=?, is_published=? WHERE id=?'
    ).run(title, description, tag, difficulty, image, link, is_published !== undefined ? is_published : project.is_published, req.params.id);
    res.json({ success: true });
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ===== VIDEO ROUTES =====
app.get('/api/videos', (req, res) => {
    const videos = db.prepare('SELECT * FROM videos ORDER BY created_at DESC').all();
    res.json(videos);
});

app.get('/api/videos/published', (req, res) => {
    const videos = db.prepare('SELECT * FROM videos WHERE is_published = 1 ORDER BY created_at DESC').all();
    res.json(videos);
});

app.post('/api/videos', requireAuth, (req, res) => {
    const { title, description, youtube_url, duration } = req.body;
    const result = db.prepare(
        'INSERT INTO videos (title, description, youtube_url, duration) VALUES (?, ?, ?, ?)'
    ).run(title, description, youtube_url, duration);
    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/videos/:id', requireAuth, (req, res) => {
    const { title, description, youtube_url, duration, is_published } = req.body;
    db.prepare(
        'UPDATE videos SET title=?, description=?, youtube_url=?, duration=?, is_published=? WHERE id=?'
    ).run(title, description, youtube_url, duration, is_published, req.params.id);
    res.json({ success: true });
});

app.delete('/api/videos/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM videos WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ===== MESSAGE ROUTES =====
app.get('/api/messages', requireAuth, (req, res) => {
    const messages = db.prepare('SELECT * FROM messages ORDER BY created_at DESC').all();
    res.json(messages);
});

app.post('/api/messages', (req, res) => {
    const { name, email, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ error: 'Tüm alanlar zorunlu' });
    db.prepare('INSERT INTO messages (name, email, message) VALUES (?, ?, ?)').run(name, email, message);
    res.json({ success: true });
});

app.put('/api/messages/:id/read', requireAuth, (req, res) => {
    db.prepare('UPDATE messages SET is_read = 1 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.delete('/api/messages/:id', requireAuth, (req, res) => {
    db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ===== SUBSCRIBER ROUTES =====
app.get('/api/subscribers', requireAuth, (req, res) => {
    const subs = db.prepare('SELECT * FROM subscribers ORDER BY created_at DESC').all();
    res.json(subs);
});

app.post('/api/subscribers', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-posta gerekli' });
    try {
        db.prepare('INSERT INTO subscribers (email) VALUES (?)').run(email);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: true, message: 'Zaten kayıtlı' });
    }
});

// ===== DASHBOARD STATS =====
app.get('/api/stats', requireAuth, (req, res) => {
    const projects = db.prepare('SELECT COUNT(*) as count FROM projects').get().count;
    const videos = db.prepare('SELECT COUNT(*) as count FROM videos').get().count;
    const messages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
    const unread = db.prepare('SELECT COUNT(*) as count FROM messages WHERE is_read = 0').get().count;
    const subscribers = db.prepare('SELECT COUNT(*) as count FROM subscribers').get().count;
    res.json({ projects, videos, messages, unread, subscribers });
});

// Admin panel sayfası
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.listen(PORT, () => {
    console.log(`iotolye sunucu çalışıyor: http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
