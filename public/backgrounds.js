/* MTerm - dinamičke (animirane) pozadine na canvasu iza sučelja */
'use strict';

(function () {
  const canvas = document.createElement('canvas');
  canvas.id = 'bgCanvas';
  const imgLayer = document.createElement('div');
  imgLayer.id = 'bgImage';
  document.addEventListener('DOMContentLoaded', () => { document.body.prepend(imgLayer); document.body.prepend(canvas); });
  if (document.body) { document.body.prepend(imgLayer); document.body.prepend(canvas); }
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, DPR = 1;
  let effect = null, raf = 0, last = 0;
  let opt = { name: 'none', speed: 1, accent: '#22d3ee', bg: '#0b1020', fg: '#e5e7eb', palette: [], forceMotion: true };

  const rand = (a, b) => a + Math.random() * (b - a);
  function hexToRgb(h) {
    h = String(h || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = (h, a) => { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; };
  const pal = (i) => opt.palette[i % opt.palette.length] || opt.accent;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    effect?.init?.();
  }
  window.addEventListener('resize', resize);

  const clear = () => { ctx.fillStyle = opt.bg; ctx.fillRect(0, 0, W, H); };

  const EFFECTS = {
    gradient: {
      label: 'Gradijent (pomični)',
      init() { this.t = 0; },
      frame(dt) {
        this.t += dt * 0.00008 * opt.speed;
        const a = this.t * Math.PI * 2;
        const x = W / 2 + Math.cos(a) * W, y = H / 2 + Math.sin(a) * H;
        const g = ctx.createLinearGradient(W - x, H - y, x, y);
        g.addColorStop(0, opt.bg);
        g.addColorStop(0.5, rgba(pal(0), 0.35));
        g.addColorStop(1, rgba(pal(1), 0.45));
        clear(); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      },
    },
    aurora: {
      label: 'Aurora',
      init() {
        this.blobs = Array.from({ length: 5 }, (_, i) => ({
          c: pal(i), r: rand(0.35, 0.6), fx: rand(0.5, 1.2), fy: rand(0.5, 1.2), px: rand(0, 6), py: rand(0, 6),
        }));
        this.t = 0;
      },
      frame(dt) {
        this.t += dt * 0.00015 * opt.speed;
        clear();
        ctx.globalCompositeOperation = 'lighter';
        const R = Math.max(W, H);
        for (const b of this.blobs) {
          const x = W * (0.5 + 0.4 * Math.sin(this.t * b.fx + b.px));
          const y = H * (0.5 + 0.4 * Math.cos(this.t * b.fy + b.py));
          const g = ctx.createRadialGradient(x, y, 0, x, y, R * b.r);
          g.addColorStop(0, rgba(b.c, 0.28)); g.addColorStop(1, rgba(b.c, 0));
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }
        ctx.globalCompositeOperation = 'source-over';
      },
    },
    matrix: {
      label: 'Matrix kiša',
      init() {
        this.size = 16;
        this.cols = Math.ceil(W / this.size);
        this.drops = Array.from({ length: this.cols }, () => rand(-H / this.size, 0));
        this.acc = 0;
        this.chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/$#*+=';
        clear();
      },
      frame(dt) {
        this.acc += dt * opt.speed;
        if (this.acc < 50) return;
        this.acc = 0;
        ctx.fillStyle = rgba(opt.bg, 0.12); ctx.fillRect(0, 0, W, H);
        ctx.font = `${this.size}px ui-monospace, monospace`;
        for (let i = 0; i < this.cols; i++) {
          const ch = this.chars[(Math.random() * this.chars.length) | 0];
          const y = this.drops[i] * this.size;
          ctx.fillStyle = Math.random() < 0.05 ? '#ffffff' : rgba(opt.accent, 0.85);
          ctx.fillText(ch, i * this.size, y);
          if (y > H && Math.random() > 0.975) this.drops[i] = 0;
          this.drops[i]++;
        }
      },
    },
    stars: {
      label: 'Svemir (zvijezde)',
      init() { this.s = Array.from({ length: 400 }, () => this.newStar(true)); },
      newStar(any) { return { x: rand(-1, 1), y: rand(-1, 1), z: any ? rand(0.05, 1) : 1, c: Math.random() < 0.2 ? opt.accent : opt.fg }; },
      frame(dt) {
        clear();
        const cx = W / 2, cy = H / 2, k = Math.max(W, H) * 0.5;
        for (const s of this.s) {
          const pz = s.z;
          s.z -= dt * 0.00012 * opt.speed;
          if (s.z <= 0.02) { Object.assign(s, this.newStar(false)); continue; }
          const x = cx + (s.x / s.z) * k, y = cy + (s.y / s.z) * k;
          const px = cx + (s.x / pz) * k, py = cy + (s.y / pz) * k;
          if (x < 0 || x > W || y < 0 || y > H) { Object.assign(s, this.newStar(false)); continue; }
          const a = Math.min(1, (1 - s.z) * 1.4);
          ctx.strokeStyle = rgba(s.c, a);
          ctx.lineWidth = Math.max(0.5, (1 - s.z) * 2.2);
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
        }
      },
    },
    particles: {
      label: 'Mreža čestica',
      init() {
        const n = Math.min(110, Math.round((W * H) / 14000));
        this.p = Array.from({ length: n }, () => ({ x: rand(0, W), y: rand(0, H), vx: rand(-0.03, 0.03), vy: rand(-0.03, 0.03) }));
      },
      frame(dt) {
        clear();
        const d = 140, sp = dt * opt.speed;
        for (const p of this.p) {
          p.x += p.vx * sp; p.y += p.vy * sp;
          if (p.x < 0 || p.x > W) p.vx *= -1;
          if (p.y < 0 || p.y > H) p.vy *= -1;
        }
        ctx.lineWidth = 1;
        for (let i = 0; i < this.p.length; i++) {
          const a = this.p[i];
          for (let j = i + 1; j < this.p.length; j++) {
            const b = this.p[j], dx = a.x - b.x, dy = a.y - b.y, dd = dx * dx + dy * dy;
            if (dd < d * d) {
              ctx.strokeStyle = rgba(opt.accent, 0.35 * (1 - Math.sqrt(dd) / d));
              ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
          }
          ctx.fillStyle = rgba(opt.accent, 0.8);
          ctx.beginPath(); ctx.arc(a.x, a.y, 1.8, 0, Math.PI * 2); ctx.fill();
        }
      },
    },
    waves: {
      label: 'Valovi',
      init() { this.t = 0; },
      frame(dt) {
        this.t += dt * 0.0006 * opt.speed;
        clear();
        for (let l = 0; l < 4; l++) {
          ctx.fillStyle = rgba(pal(l), 0.12 + l * 0.03);
          ctx.beginPath();
          ctx.moveTo(0, H);
          const base = H * (0.55 + l * 0.1), amp = 30 + l * 12, f = 0.004 - l * 0.0006;
          for (let x = 0; x <= W; x += 12) {
            ctx.lineTo(x, base + Math.sin(x * f + this.t * (1 + l * 0.3)) * amp + Math.sin(x * f * 2.3 - this.t) * amp * 0.3);
          }
          ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
        }
      },
    },
    bubbles: {
      label: 'Mjehurići',
      init() { this.b = Array.from({ length: 45 }, () => this.newB(true)); },
      newB(any) { return { x: rand(0, W), y: any ? rand(0, H) : H + 60, r: rand(6, 46), v: rand(0.01, 0.05), c: pal((Math.random() * 4) | 0), w: rand(0, 6) }; },
      frame(dt) {
        clear();
        for (const b of this.b) {
          b.y -= b.v * dt * opt.speed; b.w += dt * 0.001;
          if (b.y < -60) Object.assign(b, this.newB(false));
          const x = b.x + Math.sin(b.w) * 12;
          const g = ctx.createRadialGradient(x - b.r / 3, b.y - b.r / 3, 1, x, b.y, b.r);
          g.addColorStop(0, rgba(b.c, 0.35)); g.addColorStop(1, rgba(b.c, 0.04));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = rgba(b.c, 0.3); ctx.stroke();
        }
      },
    },
    snow: {
      label: 'Snijeg',
      init() { this.f = Array.from({ length: 220 }, () => this.newF(true)); },
      newF(any) { return { x: rand(0, W), y: any ? rand(0, H) : -5, r: rand(0.8, 3), v: rand(0.02, 0.07), w: rand(0, 6) }; },
      frame(dt) {
        clear();
        ctx.fillStyle = rgba(opt.fg, 0.8);
        for (const f of this.f) {
          f.y += f.v * dt * opt.speed * (f.r / 2); f.w += dt * 0.0012;
          if (f.y > H + 5) Object.assign(f, this.newF(false));
          ctx.beginPath(); ctx.arc(f.x + Math.sin(f.w) * 15, f.y, f.r, 0, Math.PI * 2); ctx.fill();
        }
      },
    },
    grid: {
      label: 'Retro mreža',
      init() { this.t = 0; },
      frame(dt) {
        this.t = (this.t + dt * 0.00005 * opt.speed) % 1;
        clear();
        const hz = H * 0.55;
        const sky = ctx.createLinearGradient(0, 0, 0, hz);
        sky.addColorStop(0, opt.bg); sky.addColorStop(1, rgba(pal(1), 0.35));
        ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hz);
        const sunR = Math.min(W, H) * 0.18;
        const sun = ctx.createLinearGradient(0, hz - sunR * 2, 0, hz);
        sun.addColorStop(0, rgba(pal(2), 0.9)); sun.addColorStop(1, rgba(pal(1), 0.6));
        ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(W / 2, hz, sunR, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = rgba(opt.accent, 0.55); ctx.lineWidth = 1;
        for (let i = 0; i < 18; i++) {
          const p = (i + this.t * 1) / 18, y = hz + (H - hz) * p * p;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        for (let i = -20; i <= 20; i++) {
          ctx.beginPath(); ctx.moveTo(W / 2 + i * 20, hz); ctx.lineTo(W / 2 + i * W * 0.12, H); ctx.stroke();
        }
      },
    },
  };

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(100, ts - (last || ts));
    last = ts;
    if (document.hidden || !effect) return;
    effect.frame(dt);
  }

  window.MTermBackground = {
    effects: Object.fromEntries(Object.entries(EFFECTS).map(([k, v]) => [k, v.label])),
    set(o) {
      opt = { ...opt, ...o };
      cancelAnimationFrame(raf); raf = 0; last = 0;
      imgLayer.style.backgroundImage = '';
      imgLayer.classList.toggle('kenburns', false);
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && !opt.forceMotion;
      if (opt.name === 'image' && opt.image) {
        effect = null;
        canvas.style.display = 'none';
        imgLayer.style.display = 'block';
        imgLayer.style.backgroundImage = `url("${String(opt.image).replace(/"/g, '%22')}")`;
        imgLayer.classList.toggle('kenburns', !reduce && opt.speed > 0);
        imgLayer.style.animationDuration = (60 / Math.max(0.1, opt.speed)) + 's';
        return;
      }
      imgLayer.style.display = 'none';
      effect = EFFECTS[opt.name] || null;
      canvas.style.display = effect ? 'block' : 'none';
      if (!effect) return;
      resize();
      if (reduce) { effect.frame(16); return; } // jedna sličica bez animacije
      raf = requestAnimationFrame(loop);
    },
  };
  resize();
})();
