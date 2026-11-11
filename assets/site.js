/* F-43 Moto OS · f43moto.in — page motion and the test-ride cockpit. No libraries, no trackers. */
(() => {
  'use strict';
  window.__f43 = 1;
  const root = document.documentElement;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const store = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  // ── one requestAnimationFrame loop; tasks return true to keep running ──
  const tasks = new Set();
  let rafId = 0, lastT = 0;
  const frame = (now) => {
    rafId = 0;
    const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
    lastT = now;
    for (const t of [...tasks]) if (!t(dt, now)) tasks.delete(t);
    if (tasks.size) rafId = requestAnimationFrame(frame);
  };
  const wake = (t) => {
    tasks.add(t);
    if (!rafId) { lastT = performance.now(); rafId = requestAnimationFrame(frame); }
  };

  // ── pause and play for everything that keeps moving ──
  let still = false;
  const onStill = [];
  const motionBtn = $('#motion');
  const setStill = (v) => {
    still = v;
    root.classList.toggle('still', v);
    motionBtn.setAttribute('aria-pressed', String(v));
    $('#motionLbl').textContent = motionBtn.title = v ? 'Play motion' : 'Pause motion';
    onStill.forEach((f) => f(v));
  };
  motionBtn.addEventListener('click', () => setStill(!still));

  // ── sound: synthesized in the page, nothing to download, off until asked for ──
  const sfx = (() => {
    let ac = null, out = null, noiseBuf = null, on = false, gestured = false;
    const subs = [];
    try { on = localStorage.getItem('f43-sound') === '1'; } catch (e) { /* storage blocked */ }
    ['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => { gestured = true; }, { once: true, capture: true }));
    // browsers only start audio after a click or key press on the page
    const allowed = () => (navigator.userActivation ? navigator.userActivation.hasBeenActive : gestured);
    const ctx = () => {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC || !allowed()) return null;
      if (!ac) {
        ac = new AC();
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -20; comp.ratio.value = 4;
        out = ac.createGain(); out.gain.value = 0.8;
        out.connect(comp); comp.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    };
    const env = (g, t, vol, a, dur) => {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    };
    const tone = (f, { at = 0, dur = 0.08, vol = 0.1, type = 'sine', to = 0, a = 0.004 } = {}) => {
      const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      env(g, t, vol, a, dur);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.03);
    };
    const hiss = ({ at = 0, dur = 0.2, vol = 0.06, f = 2000, to = 0, q = 1, type = 'bandpass', a = 0.005 } = {}) => {
      const t = ac.currentTime + at, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = noiseBuf; s.loop = true;
      fl.type = type; fl.Q.value = q;
      fl.frequency.setValueAtTime(f, t);
      if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur);
      env(g, t, vol, a, dur);
      s.connect(fl); fl.connect(g); g.connect(out);
      s.start(t); s.stop(t + dur + 0.03);
    };
    const SOUNDS = {
      // a two-pip lock tone as the reticle locks on
      lock: () => { tone(1480, { dur: 0.03, vol: 0.03, type: 'square' }); tone(1976, { at: 0.045, dur: 0.03, vol: 0.025, type: 'square' }); },
      click: () => { tone(900, { dur: 0.05, vol: 0.06, type: 'triangle', to: 1400 }); hiss({ dur: 0.03, vol: 0.025, f: 5000 }); },
      on: () => [660, 990, 1320].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.2, vol: 0.07, type: 'triangle' })),
      off: () => [990, 660].forEach((f, i) => tone(f, { at: i * 0.07, dur: 0.15, vol: 0.05, type: 'triangle' })),
      // the screen collapsing to a line, then coming back
      crtOff: () => { tone(1700, { dur: 0.26, vol: 0.05, to: 70 }); hiss({ dur: 0.22, vol: 0.04, f: 4000, to: 300 }); },
      crtOn: () => { tone(80, { dur: 0.38, vol: 0.05, to: 1500, type: 'triangle' }); hiss({ dur: 0.32, vol: 0.03, f: 300, to: 6000 }); },
      // systems arming one by one, then a chord
      arm: () => {
        for (let k = 0; k < 9; k++) tone(700 + k * 60, { at: k * 0.045, dur: 0.03, vol: 0.04, type: 'square' });
        [1046.5, 1318.5, 1568].forEach((f) => tone(f, { at: 0.46, dur: 1, vol: 0.04, a: 0.01 }));
      },
      disarm: () => { for (let k = 0; k < 5; k++) tone(1100 - k * 100, { at: k * 0.04, dur: 0.03, vol: 0.035, type: 'square' }); },
      // a short fanfare that climbs with the rank
      promote: (j = 0) => {
        const b = 523.25 * 2 ** ((j * 1.5) / 12);
        [1, 1.26, 1.5, 2].forEach((m, i) => tone(b * m, { at: i * 0.075, dur: 0.34, vol: 0.06, type: 'triangle' }));
        hiss({ at: 0.22, dur: 0.5, vol: 0.02, f: 7000, type: 'highpass' });
      },
      open: () => tone(520, { dur: 0.08, vol: 0.045, to: 880, type: 'triangle' }),
      close: () => tone(880, { dur: 0.08, vol: 0.035, to: 520, type: 'triangle' }),
      // radar ping with a faint echo, as a new section comes up
      ping: () => { tone(1568, { dur: 0.45, vol: 0.02, a: 0.002 }); tone(1568, { at: 0.17, dur: 0.35, vol: 0.008, a: 0.002 }); },
      shift: () => { hiss({ dur: 0.05, vol: 0.05, f: 1800, q: 2 }); tone(190, { dur: 0.06, vol: 0.05, type: 'square', to: 120 }); },
      call: () => { tone(880, { dur: 0.11, vol: 0.04, type: 'square' }); tone(660, { at: 0.13, dur: 0.15, vol: 0.04, type: 'square' }); },
      cleared: () => [784, 1046.5, 1568].forEach((f, i) => tone(f, { at: i * 0.09, dur: 0.45, vol: 0.05, type: 'triangle' })),
    };
    let lastPlay = 0;
    const play = (name, arg) => {
      if (!on || !ctx()) return;
      if (name === 'lock') { const n = performance.now(); if (n - lastPlay < 70) return; lastPlay = n; }
      SOUNDS[name](arg);
    };
    const set = (v) => {
      on = v;
      try { localStorage.setItem('f43-sound', v ? '1' : '0'); } catch (e) { /* storage blocked */ }
      if (ctx()) SOUNDS[v ? 'on' : 'off']();
      subs.forEach((f) => f(v));
    };
    return {
      get on() { return on; },
      get out() { return out; },
      get noise() { return noiseBuf; },
      ready: () => on && !!ctx(),
      ctx, play, set,
      sub: (f) => subs.push(f),
    };
  })();
  const sfxBtn = $('#sfx');
  const showSfx = (v) => {
    sfxBtn.setAttribute('aria-pressed', String(v));
    sfxBtn.title = v ? 'Sound on' : 'Sound off';
    $('#sfxLbl').textContent = v ? 'Turn sound off' : 'Turn sound on';
  };
  sfx.sub(showSfx);
  showSfx(sfx.on);
  sfxBtn.addEventListener('click', (e) => { e.f43 = 1; sfx.set(!sfx.on); });
  // every other link and button gets a click; the ones with their own sound mark the event
  document.addEventListener('click', (e) => {
    if (e.f43) return;
    const el = e.target.closest && e.target.closest('a, button');
    if (el && !el.closest('#throttle')) sfx.play('click');
  });

  // ── text effects ──
  $$('.split').forEach((el) => {
    let i = 0;
    const word = (text) => {
      const w = document.createElement('span');
      w.className = 'w';
      const s = document.createElement('span');
      s.textContent = text;
      s.style.setProperty('--i', i++);
      w.append(s);
      return w;
    };
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((p) => {
            if (!p) return;
            frag.append(/^\s+$/.test(p) ? ' ' : word(p));
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) {
          if (n.classList.contains('nw')) n.replaceWith(word(n.textContent));
          else walk(n);
        }
      });
    };
    walk(el);
  });

  const GLYPHS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789#/<>*';
  const scramble = (el, dur = 650) => {
    if (reduce || !el) return;
    const tn = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).pop();
    if (!tn) return;
    const final = tn.__final || (tn.__final = tn.textContent);
    const t0 = performance.now();
    const step = (now) => {
      const p = clamp((now - t0) / dur);
      const n = Math.floor(p * final.length);
      let s = final.slice(0, n);
      for (let i = n; i < final.length; i++) s += final[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      tn.textContent = s;
      if (p < 1) requestAnimationFrame(step); else tn.textContent = final;
    };
    requestAnimationFrame(step);
  };
  const countUp = (el) => {
    const to = +el.dataset.count;
    if (reduce || !to) return;
    const t0 = performance.now();
    const step = (now) => {
      const p = clamp((now - t0) / 1300);
      el.textContent = Math.round(to * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  };
  const reveal = (el) => {
    el.classList.add('in');
    if (el.classList.contains('split')) return;
    el.querySelectorAll('.split').forEach((s) => s.classList.add('in'));
    el.querySelectorAll('[data-scramble]').forEach((s) => scramble(s));
    el.querySelectorAll('[data-count]').forEach(countUp);
    if (el.matches('[data-count]')) countUp(el);
  };
  const revealIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    reveal(e.target);
    revealIO.unobserve(e.target);
  }), { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
  $$('[data-reveal], .ticker, .fin-copy').forEach((el) => revealIO.observe(el));

  // ── boot: the power-on self-test, once per visit ──
  const ready = () => {
    if (root.classList.contains('ready')) return;
    root.classList.add('ready');
    $('#h1').classList.add('in');
    scramble($('.hero [data-scramble]'), 800);
  };
  if (root.classList.contains('booting')) {
    const boot = $('#boot');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      boot.classList.add('out');
      store.set('f43-boot', '1');
      setTimeout(ready, 260);
      setTimeout(() => root.classList.remove('booting'), 760);
    };
    setTimeout(finish, 1700);
    boot.addEventListener('click', finish);
    addEventListener('keydown', finish, { once: true });
  } else {
    ready();
  }

  // ── top bar, menu, progress ──
  const bar = $('#bar'), prog = $('#prog');
  const menu = $('#menu'), menuBtn = $('#menuBtn');
  let menuOpen = false;
  const setMenu = (v) => {
    menuOpen = v;
    menu.hidden = !v;
    menuBtn.setAttribute('aria-expanded', String(v));
    document.body.style.overflow = v ? 'hidden' : '';
    if (v) bar.classList.remove('away');
  };
  menuBtn.addEventListener('click', () => setMenu(!menuOpen));
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen) { setMenu(false); menuBtn.focus(); } });
  bar.addEventListener('focusin', () => bar.classList.remove('away'));

  // section tracking for the nav and the altitude rail
  const SECS = [['ride', 'Ride'], ['setup', 'Setup'], ['screens', 'Screens'], ['systems', 'Systems'], ['pro', 'Pro'], ['ranks', 'Ranks'], ['faq', 'FAQ'], ['takeoff', 'T/O']]
    .map(([id, l]) => ({ id, l, el: document.getElementById(id) }));
  const navLinks = $$('.nav a');
  const marks = $('#railMarks'), cur = $('#railCur');
  SECS.forEach((s) => {
    const a = document.createElement('a');
    a.href = '#' + s.id; a.tabIndex = -1; a.dataset.l = s.l;
    marks.append(a);
    s.mark = a;
  });
  const layoutMarks = () => {
    const max = Math.max(1, root.scrollHeight - innerHeight);
    SECS.forEach((s) => { s.mark.style.top = (clamp((s.el.getBoundingClientRect().top + scrollY) / max) * 100).toFixed(2) + '%'; });
  };
  let curSec = null;
  const secIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    const id = e.target.id;
    if (curSec && id !== curSec) sfx.play('ping');
    curSec = id;
    navLinks.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + id));
    SECS.forEach((s) => s.mark.classList.toggle('on', s.id === id));
  }), { rootMargin: '-45% 0px -50% 0px' });
  SECS.forEach((s) => secIO.observe(s.el));

  // ── scroll: one pass per frame drives everything tied to it ──
  const railL = $('#railL'), railR = $('#railR'), spdTape = $('#spdTape'), spdVal = $('#spdVal'), altVal = $('#altVal');
  const hero = $('#ride');
  let lastSY = scrollY, svel = 0, tapeO = 0;
  const scrollHooks = [];
  const onScroll = (dt) => {
    const y = scrollY, dy = y - lastSY;
    lastSY = y;
    svel = lerp(svel, Math.abs(dy) / dt, 0.2);
    if (!dy) svel *= 0.86;
    tapeO += dy * 0.5;

    bar.classList.toggle('solid', y > 30);
    if (!menuOpen) {
      if (y > 240 && dy > 3) bar.classList.add('away');
      else if (dy < -3 || y < 240) bar.classList.remove('away');
    }
    const max = Math.max(1, root.scrollHeight - innerHeight);
    const p = clamp(y / max);
    prog.style.setProperty('--p', p.toFixed(4));

    const showRails = y > hero.offsetHeight * 0.65;
    railL.classList.toggle('on', showRails);
    railR.classList.toggle('on', showRails);
    if (showRails) {
      spdTape.style.setProperty('--o', (tapeO % 60).toFixed(1) + 'px');
      spdVal.textContent = String(Math.min(999, Math.round(svel * 0.06))).padStart(3, '0');
      altVal.textContent = fmt(p * 35000).padStart(6, '0');
      cur.style.setProperty('--y', (p * marks.clientHeight).toFixed(1) + 'px');
    }
    scrollHooks.forEach((f) => f(y));
    return svel > 1.5;
  };
  addEventListener('scroll', () => wake(onScroll), { passive: true });
  addEventListener('resize', () => { layoutMarks(); wake(onScroll); });
  addEventListener('load', layoutMarks);
  layoutMarks();
  wake(onScroll);

  // ── the targeting reticle, for mouse pointers ──
  if (fine && !reduce) {
    const ret = $('#reticle');
    let x = -100, y = -100, w = 30, h = 30, px = -100, py = -100, lockEl = null;
    const LOCK = 'a,button,summary,input,[data-lock],[role=tab],label,.boards li';
    addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      px = e.clientX; py = e.clientY;
      const t = e.target.closest && e.target.closest(LOCK);
      const next = t && !t.closest('.boot, .menu') ? t : null;
      if (next && next !== lockEl) sfx.play('lock');
      lockEl = next;
      ret.classList.add('on');
      ret.classList.toggle('lock', !!lockEl);
      ret.classList.toggle('gold', !!(e.target.closest && e.target.closest('#pro, #ranks')));
      wake(follow);
    }, { passive: true });
    document.addEventListener('mouseleave', () => ret.classList.remove('on'));
    const follow = () => {
      let tx, ty, tw, th;
      if (lockEl && lockEl.isConnected) {
        const r = lockEl.getBoundingClientRect();
        tw = r.width + 12; th = r.height + 12; tx = r.left - 6; ty = r.top - 6;
      } else {
        tw = th = 30; tx = px - 15; ty = py - 15;
      }
      const k = lockEl ? 0.32 : 0.4;
      x = lerp(x, tx, k); y = lerp(y, ty, k); w = lerp(w, tw, k); h = lerp(h, th, k);
      ret.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
      ret.style.width = w.toFixed(1) + 'px';
      ret.style.height = h.toFixed(1) + 'px';
      return Math.abs(x - tx) + Math.abs(y - ty) + Math.abs(w - tw) + Math.abs(h - th) > 0.4 || !!lockEl;
    };
    addEventListener('scroll', () => { if (lockEl) wake(follow); }, { passive: true });
  }

  // magnetic Play buttons
  if (fine && !reduce) {
    $$('[data-magnet]').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        el.style.translate = `${(dx * 12).toFixed(1)}px ${(dy * 10).toFixed(1)}px`;
      });
      el.addEventListener('pointerleave', () => { el.style.translate = ''; });
    });
  }

  // cards: a glow that follows the pointer round the border
  $$('[data-glow]').forEach((el) => {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
    });
    el.addEventListener('pointerleave', () => { el.style.setProperty('--mx', '-999px'); el.style.setProperty('--my', '-999px'); });
  });

  // ── videos: load near the viewport, play while visible ──
  const vids = new Set();
  const vidIO = new IntersectionObserver((es) => es.forEach((e) => {
    const v = e.target;
    v.__vis = e.isIntersecting;
    if (e.isIntersecting) {
      if (!v.getAttribute('src') && v.dataset.src) v.src = v.dataset.src;
      if (!reduce && !still) v.play().catch(() => {});
    } else {
      v.pause();
    }
  }), { rootMargin: '150px 0px', threshold: 0.01 });
  $$('video[data-src]').forEach((v) => {
    vids.add(v);
    if (reduce) v.controls = true;
    vidIO.observe(v);
  });
  onStill.push((v) => vids.forEach((vd) => { if (v) vd.pause(); else if (vd.__vis && !reduce) vd.play().catch(() => {}); }));

  // ═════════ the test-ride cockpit ═════════
  (() => {
    const cv = $('#hud'), wrap = $('#hudWrap'), ctx = cv.getContext('2d');
    const thrBtn = $('#throttle'), thrFill = $('#thrFill'), modeEl = $('#hudMode');
    const tiltBtn = $('#tilt'), soundBtn = $('#sound');
    let W = 0, H = 0, dpr = 1, visible = true;

    const RATIO = [0, 6.2, 9.4, 12.2, 14.8, 16.8, 18.2]; // km/h per 1000 rpm
    const ACC = [0, 26, 18, 13, 10, 8, 6.6];              // km/h per s at full throttle
    const RED = 9000, IDLE = 1150, SHIFT = 7800;
    const S = { v: 0, rpm: IDLE, g: 1, thr: 0, lean: 0, pitch: 0, hdg: 84, dist: 0, cut: 0, cd: 0, g2: 1, flash: 0 };
    let t = 0, auto = !reduce, lastInput = -1e9;
    let holdBtn = false, holdKey = false, keyLean = 0, ptrLean = null, tiltLean = null;
    const input = () => { lastInput = performance.now(); if (auto) { auto = false; modeEl.textContent = 'Manual'; } wakeHud(); };

    // throttle button: pointer and keyboard
    const hold = (v) => { holdBtn = v; thrBtn.classList.toggle('held', v); if (v) input(); };
    thrBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); thrBtn.setPointerCapture(e.pointerId); hold(true); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => thrBtn.addEventListener(ev, () => hold(false)));
    thrBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    thrBtn.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); hold(true); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); keyLean = e.key === 'ArrowLeft' ? -1 : 1; input(); }
    });
    thrBtn.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') hold(false);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') keyLean = 0;
    });
    thrBtn.addEventListener('blur', () => { hold(false); keyLean = 0; });

    // W to ride, A and D to lean, while the cockpit is on screen
    const typing = (e) => e.target.closest && e.target.closest('input, textarea, [contenteditable]');
    addEventListener('keydown', (e) => {
      if (!visible || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'w') { holdKey = true; input(); }
      else if (k === 'a') { keyLean = -1; input(); }
      else if (k === 'd') { keyLean = 1; input(); }
    });
    addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w') holdKey = false;
      if ((k === 'a' && keyLean < 0) || (k === 'd' && keyLean > 0)) keyLean = 0;
    });

    // mouse leans the bike; a finger drags across the cockpit
    const center = () => (W >= 900 ? W * (W < 1280 ? 0.75 : 0.7) : W / 2);
    if (fine) {
      hero.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const r = wrap.getBoundingClientRect();
        ptrLean = clamp((e.clientX - r.left - center()) / (W * 0.28), -1, 1) * 48;
        input();
      });
      hero.addEventListener('pointerleave', () => { ptrLean = null; });
    }
    let dragId = null;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('button')) return;
      dragId = e.pointerId;
    });
    wrap.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragId) return;
      const r = wrap.getBoundingClientRect();
      ptrLean = clamp((e.clientX - r.left - center()) / (W * 0.4), -1, 1) * 48;
      input();
    });
    ['pointerup', 'pointercancel'].forEach((ev) => wrap.addEventListener(ev, (e) => { if (e.pointerId === dragId) { dragId = null; ptrLean = null; } }));

    // tilt the phone to lean
    const onOrient = (e) => {
      const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      const l = ang === 90 ? e.beta : (ang === 270 || ang === -90) ? -e.beta : e.gamma;
      if (l == null) return;
      tiltLean = clamp(l, -55, 55);
      input();
    };
    if (coarse && !fine && 'DeviceOrientationEvent' in window) {
      tiltBtn.hidden = false;
      let on = false;
      tiltBtn.addEventListener('click', async () => {
        if (!on) {
          try {
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
              const r = await DeviceOrientationEvent.requestPermission();
              if (r !== 'granted') return;
            }
          } catch (err) { return; }
          addEventListener('deviceorientation', onOrient);
          on = true;
          tiltBtn.textContent = 'Tilt to lean · On';
        } else {
          removeEventListener('deviceorientation', onOrient);
          on = false; tiltLean = null;
          tiltBtn.textContent = 'Tilt phone to lean';
        }
      });
    }

    // engine sound: a small synth on the page's sound switch
    let eng = null;
    const build = () => {
      const ac = sfx.ctx();
      if (!ac) return;
      {
        const o1 = ac.createOscillator(), o2 = ac.createOscillator(), o3 = ac.createOscillator();
        o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'triangle';
        const g1 = ac.createGain(), g2 = ac.createGain(), g3 = ac.createGain();
        g1.gain.value = 0.55; g2.gain.value = 0.16; g3.gain.value = 0.3;
        const ws = ac.createWaveShaper();
        const c = new Float32Array(512);
        for (let i = 0; i < 512; i++) { const x = i / 256 - 1; c[i] = Math.tanh(2.2 * x); }
        ws.curve = c;
        const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 4;
        const master = ac.createGain(); master.gain.value = 0;
        o1.connect(g1); o2.connect(g2); o3.connect(g3);
        [g1, g2, g3].forEach((g) => g.connect(ws));
        ws.connect(f); f.connect(master); master.connect(sfx.out);
        [o1, o2, o3].forEach((o) => o.start());
        eng = { ac, o1, o2, o3, f, master };
      }
    };
    const tuneSound = () => {
      const live = visible && !still && sfx.ready();
      if (!eng) { if (!live) return; build(); if (!eng) return; }
      const now = eng.ac.currentTime, fire = S.rpm / 30;
      eng.o1.frequency.setTargetAtTime(fire, now, 0.03);
      eng.o2.frequency.setTargetAtTime(fire * 0.5, now, 0.03);
      eng.o3.frequency.setTargetAtTime(fire * 2.01, now, 0.03);
      eng.f.frequency.setTargetAtTime(260 + S.rpm * 0.2 + S.thr * 900, now, 0.05);
      eng.master.gain.setTargetAtTime(live ? 0.04 + 0.07 * S.thr : 0, now, 0.08);
    };
    const showEng = (v) => {
      soundBtn.setAttribute('aria-pressed', String(v));
      soundBtn.querySelector('b').textContent = v ? 'On' : 'Off';
    };
    showEng(sfx.on);
    sfx.sub((v) => { showEng(v); tuneSound(); });
    soundBtn.addEventListener('click', (e) => { e.f43 = 1; sfx.set(!sfx.on); wakeHud(); });

    const step = (dt) => {
      t += dt;
      const now = performance.now();
      if (!auto && !reduce && !holdBtn && !holdKey && now - lastInput > 8000) { auto = true; modeEl.textContent = 'Autopilot'; }
      let thrIn, leanT;
      if (auto) {
        const ph = t % 11;
        thrIn = ph < 4.4 || (ph > 6.2 && ph < 8.8) ? 1 : 0;
        leanT = 30 * Math.sin(t * 0.55) * clamp(S.v / 50);
      } else {
        thrIn = holdBtn || holdKey ? 1 : 0;
        leanT = tiltLean ?? ptrLean ?? keyLean * 40;
      }
      S.thr += (thrIn - S.thr) * Math.min(1, dt * (thrIn > S.thr ? 7 : 5));
      const g = S.g;
      const torque = 0.78 + 0.3 * Math.sin(clamp((S.rpm - 1500) / 7000) * Math.PI);
      let acc = S.thr * ACC[g] * torque - 0.00043 * S.v * S.v - (1 - S.thr) * 3.4 * (S.v > 1 ? 1 : 0) - (S.v > 0.5 ? 0.6 : 0);
      if (S.cut > 0) { S.cut -= dt; acc = -0.00043 * S.v * S.v - 1.5; }
      if (S.rpm >= RED - 60 && acc > 0) acc = 0;
      S.v = Math.max(0, S.v + acc * dt);
      const rpmV = (S.v / RATIO[g]) * 1000;
      const target = g === 1 ? Math.max(rpmV, IDLE + S.thr * 3800 * (1 - clamp(S.v / 14))) : Math.max(IDLE, rpmV);
      S.rpm = Math.min(RED, S.rpm + (target - S.rpm) * Math.min(1, dt * 12));
      S.cd -= dt;
      if (S.cd <= 0) {
        if (S.rpm > 8350 && g < 6) { S.g++; S.cut = 0.14; S.cd = 0.5; S.flash = 1; sfx.play('shift'); }
        else if (g > 1 && rpmV < 2600 && (S.v / RATIO[g - 1]) * 1000 < 7000 && S.thr < 0.5) { S.g--; S.cd = 0.4; }
      }
      S.flash = Math.max(0, S.flash - dt * 3);
      S.lean += (clamp(leanT, -55, 55) - S.lean) * Math.min(1, dt * 4);
      if (S.v > 3) S.hdg = (S.hdg + clamp((9.81 * Math.tan((S.lean * Math.PI) / 180)) / (S.v / 3.6) * 57.3, -45, 45) * dt + 360) % 360;
      S.pitch += (clamp(acc * 0.28, -5, 6) - S.pitch) * Math.min(1, dt * 3);
      S.g2 = 1 / Math.cos((S.lean * Math.PI) / 180);
      S.dist += (S.v / 3.6) * dt;
      thrFill.style.setProperty('--thr', S.thr.toFixed(3));
      tuneSound();
    };

    // drawing helpers
    const line = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const CY = '53,224,240', TX = '232,238,244';

    const draw = () => {
      if (!W) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const wide = W >= 900;
      const cx = center(), cy = wide ? H * 0.47 : H * 0.42;
      const R = wide ? Math.min(H * 0.28, W * (W < 1280 ? 0.13 : 0.15)) : Math.min(H * 0.26, W * 0.29);
      const ppd = R / 22, lr = (S.lean * Math.PI) / 180, diag = Math.hypot(W, H);

      // the world: sky, road and pitch ladder roll with the bike
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(-lr); ctx.translate(0, S.pitch * ppd);
      let gr = ctx.createLinearGradient(0, -diag * 0.6, 0, 0);
      gr.addColorStop(0, `rgba(${CY},0)`); gr.addColorStop(1, `rgba(${CY},0.075)`);
      ctx.fillStyle = gr; ctx.fillRect(-diag, -diag * 0.6, diag * 2, diag * 0.6);
      gr = ctx.createLinearGradient(0, 0, 0, diag * 0.6);
      gr.addColorStop(0, 'rgba(9,15,21,0.9)'); gr.addColorStop(1, 'rgba(5,8,11,0.2)');
      ctx.fillStyle = gr; ctx.fillRect(-diag, 0, diag * 2, diag);

      const f = H * 0.5, camH = 1.25, gap = 8, off = S.dist % gap;
      ctx.lineWidth = 1;
      for (let k = -12; k <= 12; k++) {
        if (!k) continue;
        const edge = Math.abs(k) === 1;
        ctx.strokeStyle = `rgba(${CY},${edge ? 0.42 : 0.09})`;
        ctx.lineWidth = edge ? 1.6 : 1;
        const xb = edge ? k * 2.2 : k * 3.2;
        line(0, 0, (f * xb) / 0.6, (f * camH) / 0.6);
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < 34; i++) {
        const z = gap * i + (gap - off) + 1.2;
        const y = (f * camH) / z;
        // fade in from the horizon, and out again before the lines reach the camera
        const fade = clamp(y / (f * 0.35)) * clamp((f * 1.15 - y) / (f * 0.5));
        ctx.strokeStyle = `rgba(${CY},${(fade * 0.2).toFixed(3)})`;
        line(-diag, y, diag, y);
        if (z < 3.5) continue; // a dash this close would fill half the screen
        const z2 = z + 3, y2 = (f * camH) / z2;
        ctx.fillStyle = `rgba(${TX},${(fade * 0.45).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo((-f * 0.07) / z, y); ctx.lineTo((f * 0.07) / z, y);
        ctx.lineTo((f * 0.07) / z2, y2); ctx.lineTo((-f * 0.07) / z2, y2);
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(${CY},0.16)`; ctx.lineWidth = 7; line(-diag, 0, diag, 0);
      ctx.strokeStyle = 'rgba(138,240,250,0.95)'; ctx.lineWidth = 1.5; line(-diag, 0, diag, 0);

      ctx.save();
      ctx.beginPath(); ctx.arc(0, -S.pitch * ppd, R * 0.92, 0, Math.PI * 2); ctx.clip();
      ctx.font = `600 ${Math.round(R * 0.075)}px Oxanium, sans-serif`;
      ctx.textBaseline = 'middle';
      for (let p = -25; p <= 25; p += 5) {
        if (!p) continue;
        const y = -p * ppd, w = p % 10 === 0 ? R * 0.46 : R * 0.24, tk = (p > 0 ? 1 : -1) * R * 0.04;
        ctx.strokeStyle = `rgba(${TX},0.6)`; ctx.lineWidth = 1.4;
        ctx.setLineDash(p < 0 ? [R * 0.04, R * 0.03] : []);
        line(-w / 2, y, -R * 0.09, y); line(R * 0.09, y, w / 2, y);
        ctx.setLineDash([]);
        line(-w / 2, y, -w / 2, y + tk); line(w / 2, y, w / 2, y + tk);
        if (p % 10 === 0) {
          ctx.fillStyle = `rgba(${TX},0.65)`;
          ctx.textAlign = 'right'; ctx.fillText(Math.abs(p), -w / 2 - 6, y);
          ctx.textAlign = 'left'; ctx.fillText(Math.abs(p), w / 2 + 6, y);
        }
      }
      ctx.restore();
      ctx.restore();

      // fixed instruments
      ctx.strokeStyle = `rgba(${CY},0.25)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

      const br = R * 1.06;
      ctx.strokeStyle = `rgba(${TX},0.5)`; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(cx, cy, br, -Math.PI / 2 - 1.05, -Math.PI / 2 + 1.05); ctx.stroke();
      for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
        const ang = -Math.PI / 2 + (a * Math.PI) / 180, len = a % 30 === 0 ? R * 0.09 : R * 0.05;
        line(cx + Math.cos(ang) * br, cy + Math.sin(ang) * br, cx + Math.cos(ang) * (br + len), cy + Math.sin(ang) * (br + len));
      }
      const pa = -Math.PI / 2 - lr, hot = Math.abs(S.lean) > 40;
      ctx.fillStyle = hot ? '#F5B731' : '#35E0F0';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(pa) * (br - 2), cy + Math.sin(pa) * (br - 2));
      ctx.lineTo(cx + Math.cos(pa - 0.06) * (br - R * 0.11), cy + Math.sin(pa - 0.06) * (br - R * 0.11));
      ctx.lineTo(cx + Math.cos(pa + 0.06) * (br - R * 0.11), cy + Math.sin(pa + 0.06) * (br - R * 0.11));
      ctx.fill();

      // waterline
      ctx.strokeStyle = '#F5B731'; ctx.lineWidth = Math.max(2, R * 0.016); ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.4, cy); ctx.lineTo(cx - R * 0.15, cy); ctx.lineTo(cx - R * 0.075, cy + R * 0.075);
      ctx.lineTo(cx, cy); ctx.lineTo(cx + R * 0.075, cy + R * 0.075); ctx.lineTo(cx + R * 0.15, cy); ctx.lineTo(cx + R * 0.4, cy);
      ctx.stroke();

      // rev ladders, VECTOR style
      const N = 18, lit = (S.rpm / RED) * N, blink = S.rpm > SHIFT && ((t * 12) | 0) % 2 === 0;
      const sh = R * 0.075, sw = R * 0.3, sk = R * 0.06;
      for (let i = 0; i < N; i++) {
        const yr = 1 - (2 * i) / (N - 1), y = cy + yr * R;
        const xo = R * (1.24 - 0.26 * yr * yr);
        const on = i < lit, red = i >= 15;
        ctx.fillStyle = on ? (blink ? '#F5B731' : red ? '#FF2D46' : '#35E0F0') : red ? 'rgba(255,45,70,0.13)' : 'rgba(53,66,79,0.45)';
        for (const s of [-1, 1]) {
          const x0 = cx + s * xo, x1 = cx + s * (xo + sw);
          ctx.beginPath();
          ctx.moveTo(x0, y - sh / 2); ctx.lineTo(x1, y - sh / 2);
          ctx.lineTo(x1 - s * sk, y + sh / 2); ctx.lineTo(x0 - s * sk, y + sh / 2);
          ctx.fill();
        }
      }

      // heading tape
      const tw = R * 1.5, ty = cy - R * 1.42, ppdH = tw / 70;
      ctx.save();
      ctx.beginPath(); ctx.rect(cx - tw / 2, ty - R * 0.2, tw, R * 0.3); ctx.clip();
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = `700 ${Math.round(R * 0.085)}px Rajdhani, sans-serif`;
      for (let d = Math.floor((S.hdg - 40) / 5) * 5; d <= S.hdg + 40; d += 5) {
        const x = cx + (d - S.hdg) * ppdH, a = clamp(1 - Math.abs(x - cx) / (tw / 2)) * 0.85;
        const dd = ((d % 360) + 360) % 360, major = dd % 30 === 0;
        ctx.strokeStyle = `rgba(${TX},${a})`; ctx.lineWidth = 1.2;
        line(x, ty + R * 0.08, x, ty + R * (major ? -0.0 : 0.04));
        if (major) {
          ctx.fillStyle = `rgba(${TX},${a})`;
          ctx.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[dd] ?? String(dd / 10), x, ty - R * 0.03);
        }
      }
      ctx.restore();
      ctx.fillStyle = '#35E0F0';
      ctx.beginPath(); ctx.moveTo(cx, ty + R * 0.1); ctx.lineTo(cx - R * 0.035, ty + R * 0.16); ctx.lineTo(cx + R * 0.035, ty + R * 0.16); ctx.fill();
      ctx.font = `600 ${Math.round(R * 0.08)}px Oxanium, sans-serif`;
      ctx.fillText(String(Math.round(S.hdg) % 360).padStart(3, '0'), cx, ty + R * 0.26);

      // speed, gear and revs
      const bw = R * 0.66, bh = R * 0.36, bx = cx - bw / 2, by = cy + R * 0.36, c = R * 0.05;
      ctx.fillStyle = 'rgba(5,8,11,0.86)'; ctx.strokeStyle = `rgba(${CY},0.6)`; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(bx + c, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + bh - c); ctx.lineTo(bx + bw - c, by + bh);
      ctx.lineTo(bx, by + bh); ctx.lineTo(bx, by + c); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#E8EEF4'; ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.round(R * 0.27)}px Oxanium, sans-serif`;
      ctx.fillText(String(Math.round(S.v)), cx, by + bh * 0.53);
      ctx.fillStyle = `rgba(${TX},0.55)`;
      ctx.font = `700 ${Math.round(R * 0.062)}px Rajdhani, sans-serif`;
      ctx.fillText('KM/H', cx, by + bh + R * 0.07);
      const gx = cx + R * 0.52, gs = R * 0.24;
      ctx.fillStyle = 'rgba(5,8,11,0.86)'; ctx.strokeStyle = S.flash > 0 ? `rgba(245,183,49,${0.4 + S.flash * 0.6})` : `rgba(${CY},0.45)`;
      ctx.beginPath(); ctx.rect(gx - gs / 2, by + (bh - gs) / 2, gs, gs); ctx.fill(); ctx.stroke();
      ctx.fillStyle = S.flash > 0 ? '#F5B731' : '#E8EEF4';
      ctx.font = `600 ${Math.round(R * 0.17)}px Oxanium, sans-serif`;
      ctx.fillText(String(S.g), gx, by + bh / 2 + 1);
      ctx.fillStyle = `rgba(${TX},0.55)`;
      ctx.font = `700 ${Math.round(R * 0.055)}px Rajdhani, sans-serif`;
      ctx.fillText('GEAR', gx, by + bh + R * 0.07);
      const rx = cx - R * 0.55;
      ctx.fillStyle = S.rpm > SHIFT ? '#F5B731' : '#E8EEF4';
      ctx.font = `600 ${Math.round(R * 0.11)}px Oxanium, sans-serif`;
      ctx.fillText(fmt(S.rpm / 10) + '0', rx, by + bh / 2);
      ctx.fillStyle = `rgba(${TX},0.55)`;
      ctx.font = `700 ${Math.round(R * 0.055)}px Rajdhani, sans-serif`;
      ctx.fillText(S.rpm > SHIFT && blink ? 'SHIFT' : 'RPM', rx, by + bh + R * 0.07);

      // lean and load under the instrument
      const ly = cy + R * 1.2;
      ctx.font = `700 ${Math.round(R * 0.085)}px Rajdhani, sans-serif`;
      ctx.fillStyle = hot ? '#F5B731' : `rgba(${TX},0.8)`;
      const la = Math.abs(Math.round(S.lean));
      ctx.fillText(`LEAN ${la}°${la ? (S.lean < 0 ? ' L' : ' R') : ''}`, cx - R * 0.42, ly);
      ctx.fillStyle = `rgba(${TX},0.8)`;
      ctx.fillText(`G ${S.g2.toFixed(2)}`, cx + R * 0.42, ly);

      // brackets round the instrument on wide screens
      if (wide) {
        const ex = R * 1.78, ey = R * 1.62, L = R * 0.14;
        ctx.strokeStyle = `rgba(${CY},0.45)`; ctx.lineWidth = 1.5;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const x = cx + sx * ex, y = cy + sy * ey;
          ctx.beginPath(); ctx.moveTo(x, y - sy * -L); ctx.lineTo(x, y); ctx.lineTo(x - sx * L, y); ctx.stroke();
        }
        ctx.textAlign = 'left'; ctx.fillStyle = `rgba(${TX},0.45)`;
        ctx.font = `700 ${Math.round(R * 0.06)}px Rajdhani, sans-serif`;
        ctx.fillText('F-43 · FLIGHT INSTRUMENTS · SIMULATED', cx - ex + L * 0.6, cy - ey + R * 0.1);
        ctx.textAlign = 'right';
        ctx.fillText(auto ? 'AUTOPILOT' : 'MANUAL', cx + ex - L * 0.6, cy - ey + R * 0.1);
        ctx.textAlign = 'center';
      }
    };

    const loop = (dt) => {
      if (!visible || still) { tuneSound(); return false; }
      step(dt);
      draw();
      return true;
    };
    const wakeHud = () => { if (visible && !still) wake(loop); };
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      dpr = Math.min(2, devicePixelRatio || 1);
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      draw();
    };
    new ResizeObserver(resize).observe(wrap);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wakeHud(); else tuneSound(); }).observe(wrap);
    onStill.push(wakeHud);
    if (reduce) { S.v = 64; S.g = 4; S.rpm = 4300; S.lean = 14; modeEl.textContent = 'Manual'; }
    document.fonts && document.fonts.ready.then(draw);
    resize();
    wakeHud();
  })();

  // ── ticker of bike presets: drifts, and speeds up with the scroll ──
  (() => {
    const rows = $$('.tk-row').map((row) => {
      const track = row.querySelector('.tk-track');
      row.append(track.cloneNode(true));
      return { row, track, dir: +row.dataset.dir, x: 0 };
    });
    let vis = false;
    const run = (dt) => {
      if (!vis || still || reduce) return false;
      const boost = 1 + Math.min(6, svel / 400);
      rows.forEach((r) => {
        const w = r.track.offsetWidth;
        if (!w) return;
        r.x += r.dir * 38 * boost * dt;
        if (r.x <= -w) r.x += w;
        if (r.x > 0) r.x -= w;
        r.row.style.transform = `translate3d(${r.x.toFixed(1)}px,0,0)`;
      });
      return true;
    };
    rows.forEach((r) => { if (r.dir > 0) r.x = -1; });
    new IntersectionObserver(([e]) => { vis = e.isIntersecting; if (vis) wake(run); }).observe($('.ticker'));
    onStill.push((v) => { if (!v && vis) wake(run); });
  })();

  // ── on your bike: pinned steps on wide screens, a loop elsewhere ──
  (() => {
    const setup = $('#setup'), fig = $('#bikefig'), steps = $$('#steps li'), fill = $('#setupFill');
    const svg = $('.bf-over');
    const pinned = matchMedia('(min-width: 960px) and (prefers-reduced-motion: no-preference)');
    let lastStep = -1;
    const show = (s) => {
      if (s === lastStep) return;
      lastStep = s;
      fig.dataset.step = s;
      const k = Math.min(2, s - 1);
      steps.forEach((li, i) => { li.classList.toggle('on', i === k || (s >= 4 && i === 2)); li.classList.toggle('done', i < k); });
    };
    scrollHooks.push(() => {
      if (!pinned.matches) return;
      const r = setup.getBoundingClientRect();
      const p = clamp(-r.top / Math.max(1, r.height - innerHeight));
      fill.style.setProperty('--p', p.toFixed(3));
      show(p < 0.08 ? 0 : p < 0.3 ? 1 : p < 0.52 ? 2 : p < 0.78 ? 3 : 4);
    });
    let timer = 0, vis = false;
    const cycle = () => {
      if (pinned.matches || !vis) return;
      if (reduce) { show(4); return; }
      if (!still) show(lastStep >= 4 || lastStep < 1 ? 1 : lastStep + 1);
      timer = setTimeout(cycle, lastStep === 4 ? 2600 : lastStep === 3 ? 2400 : 1500);
    };
    new IntersectionObserver(([e]) => {
      vis = e.isIntersecting;
      clearTimeout(timer);
      if (vis && !pinned.matches) cycle();
    }, { threshold: 0.35 }).observe(fig);
    onStill.push((v) => { try { v ? svg.pauseAnimations() : svg.unpauseAnimations(); } catch (e) { /* no SMIL */ } });
  })();

  // ── real screens: the phone, the RIDE faces, the CRT switch ──
  (() => {
    const stage = $('#deviceStage'), device = $('#device'), screen = $('#screen'), vid = $('#faceVid');
    const tabs = $$('#faces [role=tab]');
    const nameEl = $('#faceName'), pill = $('#facePill'), desc = $('#faceDesc');
    let idx = 0, loaded = false, shown = 0, hold = 0, visible = false, hover = false;
    let hx = 0, hy = 0, sx = 0;

    const setTab = (i) => {
      tabs.forEach((b, j) => {
        b.setAttribute('aria-selected', String(j === i));
        b.tabIndex = j === i ? 0 : -1;
        b.style.setProperty('--fp', 0);
      });
      const b = tabs[i];
      nameEl.textContent = b.firstChild.textContent;
      const tier = b.dataset.t;
      pill.className = 'pill ' + (tier === 'all' ? '' : tier);
      pill.textContent = tier === 'pro' ? 'Pro' : tier === 'free' ? 'Free' : '5 free · 5 Pro';
      desc.textContent = b.dataset.d;
    };
    const load = (i) => {
      const v = tabs[i].dataset.v;
      vid.poster = `assets/video/${v}.webp`;
      vid.src = `assets/video/${v}.mp4`;
      loaded = true;
      shown = 0;
      hold = 0;
      if (!reduce && !still && visible) vid.play().catch(() => {});
    };
    const select = (i, user) => {
      if (i === idx && loaded) return;
      idx = i;
      setTab(i);
      if (user) tabs[i].scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduce ? 'auto' : 'smooth' });
      if (reduce || !loaded) { load(i); return; }
      if (user) sfx.play('crtOff');
      screen.classList.remove('on');
      screen.classList.add('off');
      setTimeout(() => {
        if (user) sfx.play('crtOn');
        load(i);
        screen.classList.remove('off');
        screen.classList.add('on');
        setTimeout(() => screen.classList.remove('on'), 520);
      }, 280);
    };
    tabs.forEach((b, i) => {
      b.addEventListener('click', (e) => { e.f43 = 1; select(i, true); });
      b.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const n = (idx + d + tabs.length) % tabs.length;
        select(n, true);
        tabs[n].focus();
      });
    });
    setTab(0);
    if (reduce) vid.controls = true;

    vid.addEventListener('loadedmetadata', () => { hold = clamp(vid.duration * 2, 6, 10); });
    // the selected tab fills while its face plays, then the next one comes on
    const tick = (dt) => {
      if (!visible || still || reduce) return false;
      if (hold && !hover && !vid.paused) {
        shown += dt;
        tabs[idx].style.setProperty('--fp', clamp(shown / hold).toFixed(3));
        if (shown >= hold) select((idx + 1) % tabs.length);
      }
      return true;
    };
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) {
        if (!loaded) load(idx);
        else if (!reduce && !still) vid.play().catch(() => {});
        wake(tick);
      } else vid.pause();
    }, { rootMargin: '100px 0px' }).observe(stage);
    onStill.push((v) => { if (v) vid.pause(); else if (visible && !reduce) { vid.play().catch(() => {}); wake(tick); } });

    // tilt with the pointer, settle flat as it scrolls into place
    const apply = () => {
      device.style.setProperty('--rx', (sx * 16 + hy * -7).toFixed(2) + 'deg');
      device.style.setProperty('--ry', (hx * 9).toFixed(2) + 'deg');
      device.style.setProperty('--ds', (1 - sx * 0.08).toFixed(3));
      screen.style.setProperty('--gx', (30 + hx * 40).toFixed(1) + '%');
      screen.style.setProperty('--gy', (hy * 50).toFixed(1) + '%');
    };
    if (fine && !reduce) {
      stage.addEventListener('pointermove', (e) => {
        const r = device.getBoundingClientRect();
        hx = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1);
        hy = clamp((e.clientY - r.top) / r.height * 2 - 1, -1, 1);
        hover = true;
        apply();
      });
      stage.addEventListener('pointerleave', () => { hx = hy = 0; hover = false; apply(); });
    }
    if (!reduce) {
      scrollHooks.push(() => {
        const r = stage.getBoundingClientRect();
        sx = 1 - smooth((innerHeight - r.top) / (innerHeight * 0.75));
        apply();
      });
    }
  })();

  // ── fault code terminal ──
  (() => {
    const CODES = [
      ['P0562', 'System voltage low', 'Check the charging system: battery, regulator, connections.'],
      ['P0133', 'O2 sensor slow response', 'Check the sensor wiring, and for exhaust leaks before the sensor.'],
      ['P0117', 'Coolant temp sensor low input', 'Check the sensor plug and wiring for a short.'],
      ['P0335', 'Crankshaft position sensor', 'Check the sensor gap, plug and wiring.'],
    ];
    const code = $('#tCode'), txt = $('#tTxt'), fix = $('#tFix');
    let k = 0, timer = 0, vis = false;
    const type = (el, s, cb) => {
      let i = 0;
      const go = () => { el.textContent = s.slice(0, ++i); if (i < s.length) timer = setTimeout(go, 28); else cb && cb(); };
      go();
    };
    const run = () => {
      if (!vis) return;
      if (still) { timer = setTimeout(run, 600); return; }
      const [c, t, f] = CODES[k++ % CODES.length];
      txt.textContent = ''; fix.textContent = '';
      let n = 0;
      const dec = () => {
        n++;
        code.textContent = c.split('').map((ch, i) => (i < n / 2 ? ch : GLYPHS[(Math.random() * 36) | 0])).join('');
        if (n < c.length * 2) timer = setTimeout(dec, 40);
        else { code.textContent = c; type(txt, t, () => { fix.textContent = f; timer = setTimeout(run, 3200); }); }
      };
      dec();
    };
    if (reduce) return;
    new IntersectionObserver(([e]) => {
      vis = e.isIntersecting;
      clearTimeout(timer);
      if (vis) timer = setTimeout(run, 400);
    }, { threshold: 0.4 }).observe($('#term'));
  })();

  // ── odometer ──
  (() => {
    const el = $('#odo');
    let km = 9002.4;
    const digits = [];
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('span');
      d.className = 'dg' + (i === 5 ? ' t' : '');
      d.innerHTML = '<span>' + Array.from({ length: 11 }, (_, n) => n % 10).join('<br>') + '</span>';
      el.append(d);
      digits.push(d.firstChild);
    }
    const show = () => {
      const s = String(Math.floor(km * 10)).padStart(6, '0');
      digits.forEach((d, i) => { d.style.translate = `0 ${-(+s[i]) * 1.3}em`; });
    };
    show();
    if (reduce) return;
    let vis = false;
    new IntersectionObserver(([e]) => { vis = e.isIntersecting; }).observe(el);
    setInterval(() => { if (vis && !still) { km += 0.1; show(); } }, 900);
  })();

  // ── the Mechanical Lab grows into place ──
  if (!reduce) {
    const lab = $('#lab .lab-frame');
    scrollHooks.push(() => {
      const r = lab.getBoundingClientRect();
      const p = smooth((innerHeight - r.top) / (innerHeight * 0.85));
      lab.style.setProperty('--ls', lerp(0.86, 1, p).toFixed(4));
      lab.style.setProperty('--lr', lerp(16, 0, p).toFixed(2) + 'deg');
    });
  }

  // ── free / with Pro ──
  (() => {
    const box = $('#compare'), n = $('#cmpN');
    const btns = $$('.seg button', box);
    $$('.cmp-list li[data-t=pro]', box).forEach((li, k) => li.style.setProperty('--k', k));
    const free = $$('.cmp-list li[data-t=free]', box).length;
    const all = $$('.cmp-list li', box).length;
    let cur = free, timer = 0;
    btns.forEach((b) => b.addEventListener('click', (e) => {
      e.f43 = 1;
      const mode = b.dataset.mode;
      if (box.dataset.mode === mode) return;
      box.dataset.mode = mode;
      sfx.play(mode === 'pro' ? 'arm' : 'disarm');
      btns.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      const to = mode === 'pro' ? all : free;
      clearInterval(timer);
      if (reduce) { n.textContent = cur = to; return; }
      timer = setInterval(() => {
        cur += Math.sign(to - cur);
        n.textContent = cur;
        if (cur === to) clearInterval(timer);
      }, 45);
    }));
  })();

  // ═════════ pilot ranks ═════════
  (() => {
    const lis = $$('#boards li');
    const R = lis.map((li) => {
      const [bars, thin, broad] = li.dataset.ins.split(',').map(Number);
      const name = li.firstChild.textContent.trim();
      const hs = [];
      if (broad) hs.push(26);
      for (let i = 0; i < bars; i++) { hs.push(11); if (i === 0 && thin > 0 && bars >= 2) hs.push(5.6); }
      if (thin > 0 && bars < 2) hs.push(5.6);
      let y = 184;
      const rects = hs.map((h, i) => { y -= h; const r = `<rect x="10" y="${y.toFixed(1)}" width="80" height="${h}" style="--s:${i}"/>`; y -= 6.4; return r; }).join('');
      li.insertAdjacentHTML('afterbegin',
        '<svg viewBox="-8 -8 116 216" aria-hidden="true"><path class="bd" d="M0 200V42Q0 14.7 50 0Q100 14.7 100 42V200Z"/>' +
        '<circle class="gd" cx="50" cy="26" r="7"/><svg x="19" y="50" width="62" height="62" viewBox="0 0 100 100"><use class="gd" href="#jet"/></svg>' +
        `<g class="st">${rects}</g></svg>`);
      return { li, name, km: +li.dataset.km, r: +li.dataset.r };
    });
    const slider = $('#rkSlider'), nowEl = $('#rankNow'), kmEl = $('#rkKm'), ridesEl = $('#rkRides');
    const nextEl = $('#rankNext'), promo = $('#rankPromo'), play = $('#rkPlay');
    let cur = 0;
    const at = (x) => {
      x = clamp(x, 0, 8);
      const i = Math.min(7, Math.floor(x)), f = x - i, a = R[i], b = R[i + 1];
      return { km: lerp(a.km, b.km, f), rides: Math.round(lerp(a.r, b.r, f)) };
    };
    const sparks = (li) => {
      if (reduce) return;
      for (let i = 0; i < 12; i++) {
        const s = document.createElement('i');
        s.className = 'spark';
        const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 50;
        s.style.setProperty('--sx', (Math.cos(a) * d).toFixed(0) + 'px');
        s.style.setProperty('--sy', (Math.sin(a) * d - 20).toFixed(0) + 'px');
        li.append(s);
        setTimeout(() => s.remove(), 950);
      }
    };
    const update = (v, quiet) => {
      const { km, rides } = at(v / 100);
      let j = 0;
      R.forEach((r, i) => { if (km >= r.km && rides >= r.r) j = i; });
      kmEl.textContent = fmt(km);
      ridesEl.textContent = fmt(rides);
      slider.style.setProperty('--v', (v / 8).toFixed(2) + '%');
      slider.setAttribute('aria-valuetext', `${fmt(km)} km, ${rides} rides: ${R[j].name}`);
      if (j !== cur || quiet === 'init') {
        const up = j > cur;
        cur = j;
        R.forEach((r, i) => {
          r.li.classList.toggle('got', i <= j);
          r.li.classList.toggle('cur', i === j);
          r.li.classList.remove('promo');
        });
        nowEl.textContent = R[j].name;
        // on phones the boards scroll sideways: keep the current one in view
        const box = R[j].li.parentElement;
        if (box.scrollWidth > box.clientWidth + 2) {
          box.scrollTo({ left: R[j].li.offsetLeft - (box.clientWidth - R[j].li.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
        }
        if (up && quiet !== 'init') {
          void R[j].li.offsetWidth;
          R[j].li.classList.add('promo');
          promo.classList.remove('on'); void promo.offsetWidth; promo.classList.add('on');
          scramble(nowEl, 500);
          sparks(R[j].li);
          sfx.play('promote', j);
        }
        const n = R[j + 1];
        nextEl.textContent = n ? `Next: ${n.name} at ${fmt(n.km)} km and ${n.r} rides` : 'Top of the service. Blue skies, Air Marshal.';
      }
    };
    let anim = 0;
    const stop = () => { cancelAnimationFrame(anim); anim = 0; };
    slider.addEventListener('input', () => { stop(); update(+slider.value); });
    R.forEach((r, i) => r.li.addEventListener('click', () => { stop(); slider.value = i * 100; update(i * 100); }));
    const career = () => {
      stop();
      if (reduce) { slider.value = 800; update(800); return; }
      const t0 = performance.now(), from = +slider.value >= 790 ? 0 : +slider.value;
      const dur = 7500 * (1 - from / 800) + 400;
      const go = (now) => {
        if (still) { anim = requestAnimationFrame(go); return; }
        const p = clamp((now - t0) / dur);
        const v = lerp(from, 800, p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
        slider.value = v;
        update(v);
        anim = p < 1 ? requestAnimationFrame(go) : 0;
      };
      anim = requestAnimationFrame(go);
    };
    play.addEventListener('click', career);
    update(0, 'init');
    if (!reduce) {
      const io = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        setTimeout(career, 500);
      }, { threshold: 0.5 });
      io.observe($('#boards'));
    }
  })();

  // ── privacy lines slide past each other ──
  if (!reduce) {
    const pv = $('.privacy'), lines = $$('.pv-line');
    scrollHooks.push(() => {
      const r = pv.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const p = (innerHeight - r.top) / (innerHeight + r.height);
      lines.forEach((l) => l.style.setProperty('--x', (+l.dataset.px * (p - 0.5) * innerWidth * 0.45).toFixed(1) + 'px'));
    });
  }

  // ── FAQ: search and topics ──
  (() => {
    const q = $('#faqQ'), items = $$('#faqList details'), none = $('#faqNone');
    const cats = $$('#faqCats button');
    let cat = 'all';
    items.forEach((d) => { d.__q = d.querySelector('summary span'); d.__s = d.__q.textContent; });
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const apply = () => {
      const term = q.value.trim().toLowerCase();
      const re = term.length > 1 ? new RegExp('(' + esc(term) + ')', 'ig') : null;
      let shown = 0;
      const hits = [];
      items.forEach((d) => {
        const ok = (cat === 'all' || d.dataset.c === cat) && (!term || d.textContent.toLowerCase().includes(term));
        d.hidden = !ok;
        const sum = d.__q;
        sum.textContent = d.__s;
        if (ok && re) { sum.innerHTML = sum.innerHTML.replace(re, '<mark>$1</mark>'); hits.push(d); }
        if (ok) shown++;
      });
      if (re && hits.length && hits.length <= 3) hits.forEach((d) => { d.open = true; });
      none.hidden = shown > 0;
    };
    q.addEventListener('input', apply);
    items.forEach((d) => d.addEventListener('toggle', () => { if (!d.hidden) sfx.play(d.open ? 'open' : 'close'); }));
    cats.forEach((b) => b.addEventListener('click', () => {
      cat = b.dataset.c;
      cats.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      apply();
    }));
  })();

  // ═════════ finale: warp to the runway ═════════
  (() => {
    const sec = $('#takeoff'), cv = $('#warp'), ctx = cv.getContext('2d');
    const pad = $('#pad'), call = $('#call'), callBox = call.parentElement;
    let W = 0, H = 0, dpr = 1, vis = false, boost = 0, boostT = 0, speed = 0.05, prog = 0;
    const N = innerWidth < 700 ? 170 : 300;
    const stars = Array.from({ length: N }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() }));
    const resize = () => {
      const r = sec.getBoundingClientRect();
      dpr = Math.min(2, devicePixelRatio || 1);
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    };
    new ResizeObserver(resize).observe(sec);
    const CALLS = [[0, 'Line up and wait'], [0.35, 'Take-off power'], [0.55, 'V1'], [0.68, 'Rotate'], [0.8, 'Positive climb'], [0.92, 'Cleared · get it on Google Play']];
    let lastCall = '';
    const setCall = (s) => {
      if (s === lastCall) return;
      lastCall = s;
      call.textContent = s;
      callBox.classList.toggle('amber', s === 'V1' || s === 'Rotate' || s === 'Afterburner');
      if (s === 'V1' || s === 'Rotate') sfx.play('call');
      else if (s.startsWith('Cleared')) sfx.play('cleared');
    };
    // rushing air that rises with the warp, and an afterburner rumble under it
    let wind = null;
    const windTune = (live) => {
      live = live && sfx.ready();
      if (!wind) {
        if (!live) return;
        const ac = sfx.ctx();
        const s = ac.createBufferSource(), bp = ac.createBiquadFilter(), lp = ac.createBiquadFilter();
        const g1 = ac.createGain(), g2 = ac.createGain();
        s.buffer = sfx.noise; s.loop = true;
        bp.type = 'bandpass'; bp.Q.value = 0.7;
        lp.type = 'lowpass'; lp.frequency.value = 150;
        g1.gain.value = 0; g2.gain.value = 0;
        s.connect(bp); bp.connect(g1); g1.connect(sfx.out);
        s.connect(lp); lp.connect(g2); g2.connect(sfx.out);
        s.start();
        wind = { ac, bp, g1, g2 };
      }
      const t = wind.ac.currentTime;
      wind.g1.gain.setTargetAtTime(live ? 0.012 + speed * 0.045 : 0, t, 0.15);
      wind.bp.frequency.setTargetAtTime(500 + speed * 2200, t, 0.15);
      wind.g2.gain.setTargetAtTime(live ? boostT * 0.55 : 0, t, 0.1);
    };
    sfx.sub(() => windTune(vis && !still));
    scrollHooks.push(() => {
      const r = sec.getBoundingClientRect();
      prog = clamp((innerHeight - r.top) / innerHeight);
      if (!boost) {
        let c = CALLS[0][1];
        for (const [a, s] of CALLS) if (prog >= a) c = s;
        setCall(c);
      }
      pad.classList.toggle('lit', prog > 0.92 || boost > 0);
    });
    const on = () => { boost = 1; setCall('Afterburner'); wakeWarp(); };
    const off = () => { boost = 0; lastCall = ''; wake(onScroll); };
    pad.addEventListener('pointerenter', on);
    pad.addEventListener('pointerleave', off);
    pad.addEventListener('focusin', on);
    pad.addEventListener('focusout', off);

    const loop = (dt) => {
      if (!vis || still) { windTune(false); return false; }
      boostT = lerp(boostT, boost, Math.min(1, dt * 3));
      const target = 0.06 + prog * 0.32 + boostT * 1.1 + Math.min(0.5, svel / 3000);
      speed = lerp(speed, target, Math.min(1, dt * 2));
      windTune(true);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(7,11,15,0.32)';
      ctx.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, sc = Math.max(W, H) * 0.5;
      ctx.lineCap = 'round';
      for (const s of stars) {
        const z0 = s.z;
        s.z -= speed * dt;
        if (s.z <= 0.02) { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; continue; }
        const x1 = cx + (s.x / z0) * sc * 0.5, y1 = cy + (s.y / z0) * sc * 0.5;
        const x2 = cx + (s.x / s.z) * sc * 0.5, y2 = cy + (s.y / s.z) * sc * 0.5;
        const a = clamp((1 - s.z) * 1.4);
        const hot = boostT > 0.3 && s.x * s.x + s.y * s.y < 0.18;
        ctx.strokeStyle = hot ? `rgba(255,170,90,${a})` : `rgba(${boostT > 0.5 ? '200,250,255' : '53,224,240'},${a})`;
        ctx.lineWidth = Math.max(0.6, (1 - s.z) * 2.6);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      return true;
    };
    const wakeWarp = () => { if (vis && !still && !reduce) wake(loop); };
    new IntersectionObserver(([e]) => { vis = e.isIntersecting; wakeWarp(); }).observe(sec);
    onStill.push((v) => { if (!v) wakeWarp(); });
    if (reduce) {
      resize();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars.forEach((s) => {
        ctx.fillStyle = `rgba(53,224,240,${(1 - s.z) * 0.8})`;
        ctx.fillRect(W / 2 + (s.x / (s.z + 0.3)) * W * 0.3, H / 2 + (s.y / (s.z + 0.3)) * H * 0.3, 1.5, 1.5);
      });
    }
  })();
})();
