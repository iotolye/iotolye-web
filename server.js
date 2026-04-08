const express = require('express');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

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
    secret: process.env.SESSION_SECRET || 'iotolye-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ===== DATABASE (sql.js) =====
const DB_PATH = path.join(__dirname, 'iotolye.db');
let db;

// Helper: veritabanını diske kaydet
function saveDb() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Helper: tek satır getir
function getOne(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
    }
    stmt.free();
    return null;
}

// Helper: tüm satırları getir
function getAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

// Helper: çalıştır (INSERT, UPDATE, DELETE)
function run(sql, params = []) {
    db.run(sql, params);
    saveDb();
    return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] };
}

async function initDb() {
    const SQL = await initSqlJs();

    // Mevcut db dosyası varsa yükle, yoksa yeni oluştur
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
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
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            youtube_url TEXT,
            duration TEXT,
            thumbnail TEXT,
            is_published INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            message TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS subscribers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    // Default admin oluştur (yoksa)
    const adminExists = getOne('SELECT id FROM users WHERE username = ?', ['admin']);
    if (!adminExists) {
        const hash = bcrypt.hashSync('admin123', 10);
        run('INSERT INTO users (username, password) VALUES (?, ?)', ['admin', hash]);
        console.log('Default admin oluşturuldu: admin / admin123');
    }

    saveDb();
}

// ===== AUTH MIDDLEWARE =====
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) return next();
    res.status(401).json({ error: 'Giriş yapmanız gerekiyor' });
}

// ===== AUTH ROUTES =====
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = getOne('SELECT * FROM users WHERE username = ?', [username]);
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
    const user = getOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!bcrypt.compareSync(currentPassword, user.password)) {
        return res.status(400).json({ error: 'Mevcut şifre hatalı' });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    run('UPDATE users SET password = ? WHERE id = ?', [hash, req.session.userId]);
    res.json({ success: true });
});

// ===== PROJECT ROUTES =====
app.get('/api/projects', (req, res) => {
    const projects = getAll('SELECT * FROM projects ORDER BY created_at DESC');
    res.json(projects);
});

app.get('/api/projects/published', (req, res) => {
    const projects = getAll('SELECT * FROM projects WHERE is_published = 1 ORDER BY created_at DESC');
    res.json(projects);
});

app.post('/api/projects', requireAuth, upload.single('image'), (req, res) => {
    const { title, description, tag, difficulty, link } = req.body;
    const image = req.file ? '/uploads/' + req.file.filename : null;
    const result = run(
        'INSERT INTO projects (title, description, tag, difficulty, image, link) VALUES (?, ?, ?, ?, ?, ?)',
        [title, description, tag || 'ESP32', difficulty || 'beginner', image, link]
    );
    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/projects/:id', requireAuth, upload.single('image'), (req, res) => {
    const { title, description, tag, difficulty, link, is_published } = req.body;
    const project = getOne('SELECT * FROM projects WHERE id = ?', [Number(req.params.id)]);
    if (!project) return res.status(404).json({ error: 'Proje bulunamadı' });

    const image = req.file ? '/uploads/' + req.file.filename : project.image;
    run(
        'UPDATE projects SET title=?, description=?, tag=?, difficulty=?, image=?, link=?, is_published=? WHERE id=?',
        [title, description, tag, difficulty, image, link, is_published !== undefined ? Number(is_published) : project.is_published, Number(req.params.id)]
    );
    res.json({ success: true });
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
    run('DELETE FROM projects WHERE id = ?', [Number(req.params.id)]);
    res.json({ success: true });
});

// ===== VIDEO ROUTES =====
app.get('/api/videos', (req, res) => {
    const videos = getAll('SELECT * FROM videos ORDER BY created_at DESC');
    res.json(videos);
});

app.get('/api/videos/published', (req, res) => {
    const videos = getAll('SELECT * FROM videos WHERE is_published = 1 ORDER BY created_at DESC');
    res.json(videos);
});

app.post('/api/videos', requireAuth, (req, res) => {
    const { title, description, youtube_url, duration } = req.body;
    const result = run(
        'INSERT INTO videos (title, description, youtube_url, duration) VALUES (?, ?, ?, ?)',
        [title, description, youtube_url, duration]
    );
    res.json({ success: true, id: result.lastInsertRowid });
});

app.put('/api/videos/:id', requireAuth, (req, res) => {
    const { title, description, youtube_url, duration, is_published } = req.body;
    run(
        'UPDATE videos SET title=?, description=?, youtube_url=?, duration=?, is_published=? WHERE id=?',
        [title, description, youtube_url, duration, Number(is_published), Number(req.params.id)]
    );
    res.json({ success: true });
});

app.delete('/api/videos/:id', requireAuth, (req, res) => {
    run('DELETE FROM videos WHERE id = ?', [Number(req.params.id)]);
    res.json({ success: true });
});

// ===== MESSAGE ROUTES =====
app.get('/api/messages', requireAuth, (req, res) => {
    const messages = getAll('SELECT * FROM messages ORDER BY created_at DESC');
    res.json(messages);
});

app.post('/api/messages', (req, res) => {
    const { name, email, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ error: 'Tüm alanlar zorunlu' });
    run('INSERT INTO messages (name, email, message) VALUES (?, ?, ?)', [name, email, message]);
    res.json({ success: true });
});

app.put('/api/messages/:id/read', requireAuth, (req, res) => {
    run('UPDATE messages SET is_read = 1 WHERE id = ?', [Number(req.params.id)]);
    res.json({ success: true });
});

app.delete('/api/messages/:id', requireAuth, (req, res) => {
    run('DELETE FROM messages WHERE id = ?', [Number(req.params.id)]);
    res.json({ success: true });
});

// ===== SUBSCRIBER ROUTES =====
app.get('/api/subscribers', requireAuth, (req, res) => {
    const subs = getAll('SELECT * FROM subscribers ORDER BY created_at DESC');
    res.json(subs);
});

app.post('/api/subscribers', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-posta gerekli' });
    try {
        run('INSERT INTO subscribers (email) VALUES (?)', [email]);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: true, message: 'Zaten kayıtlı' });
    }
});

// ===== DASHBOARD STATS =====
app.get('/api/stats', requireAuth, (req, res) => {
    const projects = getOne('SELECT COUNT(*) as count FROM projects').count;
    const videos = getOne('SELECT COUNT(*) as count FROM videos').count;
    const messages = getOne('SELECT COUNT(*) as count FROM messages').count;
    const unread = getOne('SELECT COUNT(*) as count FROM messages WHERE is_read = 0').count;
    const subscribers = getOne('SELECT COUNT(*) as count FROM subscribers').count;
    res.json({ projects, videos, messages, unread, subscribers });
});

// Admin panel sayfası
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ===== START =====
initDb().then(() => {
    app.listen(PORT, () => {
        console.log(`iotolye sunucu çalışıyor: http://localhost:${PORT}`);
        console.log(`Admin panel: http://localhost:${PORT}/admin`);
    });
}).catch(err => {
    console.error('Veritabanı başlatılamadı:', err);
    process.exit(1);
});
