// Navbar scroll effect
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 50);
});

// Mobile menu toggle
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    navToggle.classList.toggle('active');
});

// Close mobile menu on link click
navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
        navLinks.classList.remove('active');
        navToggle.classList.remove('active');
    });
});

// ===== API'DEN VERİ ÇEK =====
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Projeleri API'den yükle
async function loadProjects() {
    try {
        const res = await fetch('/api/projects/published');
        const projects = await res.json();
        const grid = document.getElementById('projectsGrid');
        if (!grid) return;

        if (projects.length === 0) return; // Statik içerik kalsın

        const difficultyMap = {
            beginner: { label: 'Başlangıç', class: 'beginner' },
            intermediate: { label: 'Orta', class: 'intermediate' },
            advanced: { label: 'İleri', class: 'advanced' }
        };

        grid.innerHTML = projects.map(p => {
            const diff = difficultyMap[p.difficulty] || difficultyMap.beginner;
            const imageHtml = p.image
                ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)}" style="width:100%;height:100%;object-fit:cover">`
                : `<div class="project-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                    </svg>
                   </div>`;

            return `
            <article class="project-card fade-in visible">
                <div class="project-image">
                    ${imageHtml}
                    <span class="project-tag">${escapeHtml(p.tag)}</span>
                </div>
                <div class="project-content">
                    <h3>${escapeHtml(p.title)}</h3>
                    <p>${escapeHtml(p.description)}</p>
                    <div class="project-meta">
                        <span class="difficulty ${diff.class}">${diff.label}</span>
                        <span class="project-date">${new Date(p.created_at).toLocaleDateString('tr-TR')}</span>
                    </div>
                </div>
            </article>`;
        }).join('');
    } catch (e) {
        // API yoksa statik içerik kalır
    }
}

// Videoları API'den yükle
async function loadVideos() {
    try {
        const res = await fetch('/api/videos/published');
        const videos = await res.json();
        const grid = document.getElementById('videosGrid');
        if (!grid) return;

        if (videos.length === 0) return;

        grid.innerHTML = videos.map(v => {
            // YouTube thumbnail çıkar
            let thumbHtml = '';
            if (v.youtube_url) {
                const match = v.youtube_url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
                if (match) {
                    thumbHtml = `<img src="https://img.youtube.com/vi/${match[1]}/mqdefault.jpg" alt="${escapeHtml(v.title)}" style="width:100%;height:100%;object-fit:cover">`;
                }
            }

            return `
            <div class="video-card fade-in visible" ${v.youtube_url ? `onclick="window.open('${escapeHtml(v.youtube_url)}','_blank')"` : ''}>
                <div class="video-thumbnail">
                    ${thumbHtml || `<div class="play-button"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`}
                    ${!thumbHtml ? '' : `<div class="play-button" style="position:absolute"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>`}
                    <span class="video-duration">${escapeHtml(v.duration) || ''}</span>
                </div>
                <div class="video-info">
                    <h3>${escapeHtml(v.title)}</h3>
                    <p>${escapeHtml(v.description)}</p>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        // API yoksa statik içerik kalır
    }
}

// Sayfa yüklenince API'den çek
document.addEventListener('DOMContentLoaded', () => {
    loadProjects();
    loadVideos();
});

// ===== FORMLAR API'YE BAĞLANDI =====
document.getElementById('ctaForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    try {
        await fetch('/api/subscribers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: input.value })
        });
        alert('Teşekkürler! Yeni içeriklerden haberdar olacaksınız.');
        input.value = '';
    } catch {
        alert('Bir hata oluştu, lütfen tekrar deneyin.');
    }
});

document.getElementById('contactForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = {
        name: form.querySelector('input[type="text"]').value,
        email: form.querySelector('input[type="email"]').value,
        message: form.querySelector('textarea').value
    };
    try {
        await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        alert('Mesajınız gönderildi! En kısa sürede dönüş yapacağız.');
        form.reset();
    } catch {
        alert('Bir hata oluştu, lütfen tekrar deneyin.');
    }
});

// ===== ANİMASYONLAR =====
// Animated counter
function animateCounters() {
    const counters = document.querySelectorAll('.stat-number');
    counters.forEach(counter => {
        const target = +counter.getAttribute('data-target');
        const duration = 2000;
        const start = performance.now();

        function update(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            counter.textContent = Math.floor(eased * target);
            if (progress < 1) requestAnimationFrame(update);
        }

        requestAnimationFrame(update);
    });
}

// Intersection Observer for animations
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('.feature-card, .project-card, .video-card, .tech-item, .contact-item, .cta-box').forEach(el => {
    el.classList.add('fade-in');
    observer.observe(el);
});

// Counter animation trigger
const statsObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            animateCounters();
            statsObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.5 });

const heroStats = document.querySelector('.hero-stats');
if (heroStats) statsObserver.observe(heroStats);

// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(anchor.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
});
