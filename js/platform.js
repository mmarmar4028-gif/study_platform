/* Зачётка — платформа подготовки к зачётам: кабинет, курсы, темы, тесты, разбор ошибок, создание курсов */
(function () {
  const { h, shuffle, renderWidget } = window.ZP;
  const app = document.getElementById('app');
  const tabsEl = document.getElementById('tabs');
  const subEl = document.getElementById('subtabs');
  const stripEl = document.getElementById('progressStrip');
  const avatarEl = document.getElementById('avatar');

  // ================= хранилище =================
  const ls = {
    get(k, d) { try { const v = localStorage.getItem('zp:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('zp:' + k, JSON.stringify(v)); return true; } catch (e) { toast('Не удалось сохранить: в браузере закончилось место'); return false; } },
    del(k) { try { localStorage.removeItem('zp:' + k); } catch (e) {} },
    keys() { try { return Object.keys(localStorage).filter(k => k.startsWith('zp:')).map(k => k.slice(3)); } catch (e) { return []; } }
  };
  const idb = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        try {
          const r = indexedDB.open('zachetka', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('courses', { keyPath: 'id' });
          r.onsuccess = () => { this._db = r.result; res(r.result); };
          r.onerror = () => rej(r.error);
        } catch (e) { rej(e); }
      });
    },
    async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('courses', mode); const st = t.objectStore('courses'); const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); },
    async all() { try { const db = await this.open(); return await new Promise((res, rej) => { const r = db.transaction('courses').objectStore('courses').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); } catch (e) { return ls.get('courses-fallback', []); } },
    async put(c) { try { await this.tx('readwrite', st => st.put(c)); } catch (e) { const all = ls.get('courses-fallback', []).filter(x => x.id !== c.id); all.push(c); ls.set('courses-fallback', all); } },
    async del(id) { try { await this.tx('readwrite', st => st.delete(id)); } catch (e) { ls.set('courses-fallback', ls.get('courses-fallback', []).filter(x => x.id !== id)); } }
  };

  // ================= утилиты =================
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // <template> — инертный контейнер: картинки не грузятся, обработчики не запускаются
  const strip = html => { const t = document.createElement('template'); t.innerHTML = String(html == null ? '' : html); return (t.content.textContent || '').replace(/\s+/g, ' ').trim(); };
  function toast(msg) { const t = h('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), 3200); }
  const slug = s => (s || 'course').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 30) + '-' + Math.random().toString(36).slice(2, 6);
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
  const fmtDate = ts => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  // Санитайзер HTML для пользовательских и сгенерированных курсов
  const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'DIV', 'SPAN', 'SMALL', 'SUP', 'SUB', 'H3', 'H4', 'CODE', 'MARK', 'A', 'HR', 'BLOCKQUOTE']);
  function sanitize(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html || '');
    const walk = node => {
      [...node.childNodes].forEach(ch => {
        if (ch.nodeType === 1) {
          if (!ALLOWED.has(ch.tagName)) { if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'INPUT', 'TEXTAREA', 'BUTTON', 'SVG', 'MATH', 'IMG', 'VIDEO', 'AUDIO'].includes(ch.tagName)) { ch.remove(); return; } const frag = document.createDocumentFragment(); while (ch.firstChild) frag.append(ch.firstChild); ch.replaceWith(frag); walk(node); return; }
          [...ch.attributes].forEach(a => {
            const n = a.name.toLowerCase(), v = a.value;
            const ok = n === 'class' || n === 'colspan' || n === 'rowspan' || (n === 'style' && !/url\(|expression|javascript:/i.test(v)) || (n === 'href' && /^(https?:|#)/i.test(v.trim()));
            if (!ok) ch.removeAttribute(a.name);
          });
          if (ch.tagName === 'A' && /^https?:/i.test(ch.getAttribute('href') || '')) { ch.setAttribute('target', '_blank'); ch.setAttribute('rel', 'noopener'); }
          walk(ch);
        } else if (ch.nodeType !== 3) ch.remove();
      });
    };
    walk(tpl.content);
    return tpl.innerHTML;
  }

  // ================= курсы =================
  let COURSES = [];
  const course = id => COURSES.find(c => c.id === id);

  function normalizeTopic(t, idx, trusted) {
    const S = trusted ? (x => x) : sanitize;
    const T = x => trusted ? x : esc(strip(x));
    const topic = {
      id: idx + 1,
      short: T(t.short || t.title || 'Тема ' + (idx + 1)).slice(0, 60),
      title: T(t.title || 'Тема ' + (idx + 1)),
      lecture: T(t.lecture || ''),
      subtitle: T(t.subtitle || ''),
      source: T(t.source || ''),
      game: t.game && t.game.url && /^https?:/i.test(t.game.url) ? { name: T(t.game.name), url: t.game.url, text: S(t.game.text || '') } : null,
      summary: { intro: S((t.summary && t.summary.intro) || ''), points: ((t.summary && t.summary.points) || []).map(S) },
      sections: (t.sections || []).filter(s => s && Array.isArray(s.blocks)).map(s => ({
        title: T(s.title || 'Раздел'),
        slides: T(s.slides || ''),
        blocks: s.blocks.map(b => normalizeBlock(b, trusted)).filter(Boolean)
      })),
      cheatsheet: (t.cheatsheet || []).map(S),
      quiz: (t.quiz || []).filter(q => q && q.q && Array.isArray(q.opts) && q.opts.length >= 2 && Number.isInteger(q.a) && q.a >= 0 && q.a < q.opts.length).map(q => ({
        q: S(q.q), opts: q.opts.map(S), a: q.a, hint: q.hint ? S(q.hint) : '', explain: S(q.explain || ''),
        why: q.why && typeof q.why === 'object' ? Object.fromEntries(Object.entries(q.why).map(([k, v]) => [k, S(v)])) : null,
        ref: Number.isInteger(q.ref) ? q.ref : null
      }))
    };
    return topic;
  }
  const SAFE_WIDGETS = new Set(['flashcards', 'classify', 'order', 'match', 'stages']);
  function normalizeBlock(b, trusted) {
    if (!b || typeof b !== 'object') return null;
    if (trusted) return b;
    const S = sanitize, T = x => esc(strip(x));
    switch (b.type) {
      case 'html': return { type: 'html', html: S(b.html) };
      case 'callout': return { type: 'callout', kind: ['def', 'exam', 'warn', 'tip', 'scheme'].includes(b.kind) ? b.kind : 'tip', title: b.title ? S(b.title) : '', html: S(b.html) };
      case 'scheme': return { type: 'scheme', title: b.title ? T(b.title) : '', html: S(b.html), explain: S(b.explain || '') };
      case 'formula': return { type: 'formula', name: b.name ? T(b.name) : '', expr: S(b.expr), parts: (b.parts || []).filter(p => Array.isArray(p) && p.length >= 2).map(([a, c]) => [S(a), S(c)]), why: S(b.why || ''), example: S(b.example || '') };
      case 'widget': {
        if (!SAFE_WIDGETS.has(b.kind)) return null;
        const w = { type: 'widget', kind: b.kind, title: T(b.title || 'Практика'), intro: b.intro ? S(b.intro) : '' };
        if (b.kind === 'flashcards') w.cards = (b.cards || []).filter(c => Array.isArray(c)).map(([f, k]) => [T(f), S(k)]);
        if (b.kind === 'classify') { w.buckets = (b.buckets || []).map(T); w.items = (b.items || []).map(i => ({ text: S(i.text), bucket: T(i.bucket), why: i.why ? S(i.why) : '' })).filter(i => w.buckets.includes(i.bucket)); }
        if (b.kind === 'order') { w.items = (b.items || []).map(T); w.explain = b.explain ? S(b.explain) : ''; }
        if (b.kind === 'match') w.pairs = (b.pairs || []).filter(p => Array.isArray(p)).map(([l, r, why]) => [S(l), T(r), why ? S(why) : '']);
        if (b.kind === 'stages') { w.stages = (b.stages || []).map(s => ({ name: T(s.name), text: S(s.text) })); w.legend = b.legend ? S(b.legend) : ''; }
        return w;
      }
      default: return null;
    }
  }
  function normalizeCourse(c, trusted) {
    const out = {
      id: c.id || slug(c.title), builtin: !!c.builtin,
      title: trusted ? c.title : esc(strip(c.title || 'Новый курс')),
      short: trusted ? (c.short || c.title) : esc(strip(c.short || c.title || 'Курс')).slice(0, 40),
      emoji: (c.emoji || '📘').slice(0, 4),
      description: trusted ? (c.description || '') : esc(strip(c.description || '')),
      exam: { n: Math.max(5, Math.min(100, +((c.exam && c.exam.n) || 24))), pass: Math.max(1, +((c.exam && c.exam.pass) || 15)), note: trusted ? ((c.exam && c.exam.note) || '') : esc(strip((c.exam && c.exam.note) || '')) },
      game: c.game && c.game.url && /^https?:/i.test(c.game.url) ? c.game : null,
      context: trusted ? (c.context || '') : esc(strip(c.context || '')),
      sources: c.sources || {},
      createdAt: c.createdAt || Date.now(),
      topics: (c.topics || []).map((t, i) => normalizeTopic(t, i, trusted))
    };
    if (c.slides) out.topics.forEach(t => { const arr = c.slides[t.id]; if (arr) t.sections.forEach((s, i) => { if (!s.slides && arr[i]) s.slides = arr[i]; }); });
    out.topics.forEach(t => { if (!t.source && out.sources[t.id]) t.source = out.sources[t.id]; });
    assignRefs(out);
    return out;
  }

  // Привязка вопроса к разделу темы (для разбора ошибок), если её не указал автор
  const stem = w => w.slice(0, 6);
  const tokens = s => (strip(s).toLowerCase().match(/[a-zа-яё0-9]{4,}/gi) || []).map(stem);
  function assignRefs(c) {
    c.topics.forEach(t => {
      if (!t.sections.length) return;
      const secTok = t.sections.map(s => { const set = new Set(tokens(s.title + ' ' + s.title + ' ' + s.blocks.map(blockText).join(' '))); return set; });
      const df = {}; secTok.forEach(set => set.forEach(w => df[w] = (df[w] || 0) + 1));
      t.quiz.forEach(q => {
        if (Number.isInteger(q.ref) && q.ref >= 0 && q.ref < t.sections.length) return;
        const qt = tokens(q.q + ' ' + q.opts[q.a] + ' ' + q.explain);
        let bestI = 0, bestS = -1;
        secTok.forEach((set, i) => { let sc = 0; qt.forEach(w => { if (set.has(w)) sc += 1 / df[w]; }); if (sc > bestS) { bestS = sc; bestI = i; } });
        q.ref = bestI;
      });
    });
  }
  function blockText(b) {
    if (!b) return '';
    if (b.type === 'widget') return [b.title, b.intro, ...(b.items || []).map(i => typeof i === 'string' ? i : (i.text || '') + ' ' + (i.bucket || '')), ...(b.pairs || []).map(p => p.join(' ')), ...(b.cards || []).map(c => c.join(' ')), ...(b.stages || []).map(s => s.name + ' ' + s.text)].join(' ');
    return [b.title, b.html, b.explain, b.name, b.expr, b.why, b.example, ...(b.parts || []).map(p => p.join(' '))].filter(Boolean).join(' ');
  }

  async function loadCourses() {
    const builtin = Object.values(window.ZP_BUILTIN || {}).map(c => normalizeCourse(Object.assign({}, c, { topics: c.topics.slice().sort((a, b) => a.id - b.id) }), true));
    const user = (await idb.all()).map(c => normalizeCourse(c, false));
    COURSES = [...builtin, ...user.sort((a, b) => a.createdAt - b.createdAt)];
  }
  async function saveCourse(raw) { await idb.put(raw); await loadCourses(); }

  // ================= прогресс =================
  const P = {
    done: (cid, tid) => new Set(ls.get(`done:${cid}:${tid}`, [])),
    setDone: (cid, tid, set) => ls.set(`done:${cid}:${tid}`, [...set]),
    best: (cid, key) => ls.get(`quiz:${cid}:${key}`, null),
    setBest: (cid, key, v) => ls.set(`quiz:${cid}:${key}`, v),
    exams: cid => ls.get(`exams:${cid}`, []),
    addExam: (cid, r) => { const a = ls.get(`exams:${cid}`, []); a.push(r); ls.set(`exams:${cid}`, a.slice(-30)); },
    weak: cid => ls.get(`weak:${cid}`, {}),
    markWeak: (cid, tid, sec, delta) => { const w = ls.get(`weak:${cid}`, {}); const k = tid + ':' + sec; w[k] = Math.max(0, (w[k] || 0) + delta); if (!w[k]) delete w[k]; ls.set(`weak:${cid}`, w); },
    courseStats(c) {
      const steps = c.topics.reduce((s, t) => s + t.sections.length, 0);
      const done = c.topics.reduce((s, t) => s + [...P.done(c.id, t.id)].filter(i => i < t.sections.length).length, 0);
      const passed = c.topics.filter(t => (P.best(c.id, t.id) || {}).pct >= 70).length;
      const ex = P.exams(c.id); const bestEx = ex.reduce((m, e) => Math.max(m, e.score), -1);
      return { steps, done, passed, topics: c.topics.length, exams: ex.length, bestEx: bestEx >= 0 ? bestEx : null, pct: steps ? Math.round(done / steps * 100) : 0 };
    }
  };
  const profile = () => ls.get('profile', { name: '', model: 'claude-opus-5-5', apiKey: '' });
  const setProfile = p => ls.set('profile', p);

  // ================= тема оформления =================
  const themeBtn = document.getElementById('themeBtn');
  const savedTheme = ls.get('theme', null);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  themeBtn.onclick = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark'; ls.set('theme', dark ? 'light' : 'dark');
  };

  // ================= навигация =================
  function renderNav(r) {
    const p = profile();
    avatarEl.textContent = p.name ? [...p.name.trim()][0].toUpperCase() : '🙂';
    tabsEl.innerHTML = '';
    tabsEl.append(h('a', { href: '#/', class: 'tab' + (r.page === 'home' || r.page === 'profile' ? ' active' : '') }, '🏠 Кабинет'));
    COURSES.forEach(c => tabsEl.append(h('a', { href: '#/c/' + c.id, class: 'tab' + (r.cid === c.id ? ' active' : ''), title: c.title }, c.emoji + ' ' + c.short)));
    tabsEl.append(h('a', { href: '#/new', class: 'tab add' + (r.page === 'new' ? ' active' : '') }, '＋ Новый курс'));
    const act = tabsEl.querySelector('.active'); if (act) act.scrollIntoView({ inline: 'center', block: 'nearest' });

    subEl.classList.toggle('hidden', !r.cid);
    const st = subEl.querySelector('.tabs'); st.innerHTML = '';
    if (r.cid && course(r.cid)) {
      const c = course(r.cid);
      st.append(h('a', { href: '#/c/' + c.id, class: 'tab' + (r.page === 'course' ? ' active' : '') }, 'Обзор'));
      c.topics.forEach(t => { const b = P.best(c.id, t.id); st.append(h('a', { href: `#/c/${c.id}/t/${t.id}`, class: 'tab' + (r.tid === t.id ? ' active' : ''), title: t.title }, h('span', { class: 'n' }, String(t.id)), t.short, b && b.pct >= 70 ? h('span', { class: 'ok' }, '✓') : null)); });
      if (c.topics.length) st.append(h('a', { href: `#/c/${c.id}/exam`, class: 'tab exam-tab' + (r.page === 'exam' ? ' active' : '') }, '🎯 Пробный зачёт'));
      st.append(h('a', { href: `#/c/${c.id}/manage`, class: 'tab' + (r.page === 'manage' ? ' active' : '') }, '⚙️ Управление'));
      const a2 = st.querySelector('.active'); if (a2) a2.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }
  function parseRoute() {
    const hsh = location.hash.split('#')[1] || '/';
    const parts = hsh.split('/').filter(Boolean);
    if (!parts.length) return { page: 'home' };
    if (parts[0] === 'profile') return { page: 'profile' };
    if (parts[0] === 'new') return { page: 'new' };
    if (parts[0] === 'c' && parts[1]) {
      const cid = decodeURIComponent(parts[1]);
      if (parts[2] === 't' && parts[3]) return { page: 'topic', cid, tid: +parts[3] };
      if (parts[2] === 'exam') return { page: 'exam', cid };
      if (parts[2] === 'manage') return { page: 'manage', cid };
      return { page: 'course', cid };
    }
    return { page: 'home' };
  }
  function updateStrip(c, t) {
    if (!c || !t || !t.sections.length) { stripEl.hidden = true; return; }
    stripEl.hidden = false;
    stripEl.firstChild.style.width = Math.round([...P.done(c.id, t.id)].filter(i => i < t.sections.length).length / t.sections.length * 100) + '%';
  }
  function route() {
    const r = parseRoute();
    if (r.cid && !course(r.cid)) { location.hash = '#/'; return; }
    renderNav(r);
    app.innerHTML = '';
    const c = r.cid ? course(r.cid) : null;
    if (r.page === 'topic') { const t = c.topics.find(x => x.id === r.tid); if (!t) { location.hash = '#/c/' + c.id; return; } ls.set('last', { cid: c.id, tid: t.id }); renderTopic(c, t); updateStrip(c, t); }
    else { updateStrip(null); }
    if (r.page === 'home') renderHome();
    if (r.page === 'profile') renderProfile();
    if (r.page === 'new') renderNew();
    if (r.page === 'course') renderCourse(c);
    if (r.page === 'exam') renderExam(c);
    if (r.page === 'manage') renderManage(c);
    const anchor = location.hash.split('#')[2];
    if (anchor) { const el = document.getElementById(anchor); if (el) setTimeout(() => el.scrollIntoView(), 30); } else window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  // ================= личный кабинет =================
  function renderHome() {
    const p = profile();
    if (!p.name) {
      const inp = h('input', { type: 'text', placeholder: 'Например, Маша', 'aria-label': 'Имя' });
      app.append(h('div', { class: 'card accent' }, h('p', { class: 'eyebrow' }, 'Добро пожаловать в Зачётку'), h('h1', {}, 'Как тебя зовут?'),
        h('p', { class: 'muted' }, 'Имя нужно только для личного кабинета. Всё хранится в этом браузере.'),
        h('div', { class: 'row' }, h('div', { style: { flex: '1 1 220px' } }, inp), h('button', { class: 'btn primary', onclick: () => { const v = inp.value.trim(); if (!v) return inp.focus(); setProfile(Object.assign(profile(), { name: v })); route(); } }, 'Продолжить'))));
      return;
    }
    const totals = COURSES.reduce((a, c) => { const s = P.courseStats(c); a.steps += s.steps; a.done += s.done; a.passed += s.passed; a.topics += s.topics; a.exams += s.exams; return a; }, { steps: 0, done: 0, passed: 0, topics: 0, exams: 0 });
    const last = ls.get('last', null); const lastC = last && course(last.cid); const lastT = lastC && lastC.topics.find(t => t.id === last.tid);
    app.append(
      h('section', { class: 'hero' }, h('p', { class: 'eyebrow' }, 'Личный кабинет'), h('h1', {}, `Привет, ${p.name}! 👋`),
        h('p', { class: 'lead' }, 'Здесь все твои предметы. Открой курс, читай темы по шагам, решай тесты и сдавай пробный зачёт. Ошибся — сайт сразу покажет, что повторить и где читать подробнее.')),
      h('div', { class: 'card summary' },
        h('h2', {}, 'Твой прогресс'),
        h('div', { class: 'stats-row' },
          h('div', { class: 'stat' }, h('b', {}, String(COURSES.length)), h('span', {}, plural(COURSES.length, 'курс', 'курса', 'курсов'))),
          h('div', { class: 'stat' }, h('b', {}, `${totals.done}/${totals.steps}`), h('span', {}, 'шагов изучено')),
          h('div', { class: 'stat' }, h('b', {}, `${totals.passed}/${totals.topics}`), h('span', {}, 'тестов по темам сдано')),
          h('div', { class: 'stat' }, h('b', {}, String(totals.exams)), h('span', {}, 'пробных зачётов'))),
        lastT ? h('div', { class: 'row', style: { marginTop: '14px' } }, h('a', { class: 'btn primary', href: `#/c/${lastC.id}/t/${lastT.id}` }, `Продолжить: ${lastC.emoji} ${lastT.short} →`)) : null),
      h('h2', { style: { marginTop: '26px' } }, 'Мои курсы'),
      (() => {
        const g = h('div', { class: 'course-grid' });
        COURSES.forEach(c => {
          const s = P.courseStats(c);
          g.append(h('a', { href: '#/c/' + c.id, class: 'course-card' },
            h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'emoji' }, c.emoji), c.builtin ? h('span', { class: 'badge' }, 'готовый') : h('span', { class: 'badge gray' }, 'мой')),
            h('div', { class: 't' }, c.title),
            h('div', { class: 's' }, `${s.topics} ${plural(s.topics, 'тема', 'темы', 'тем')} · шагов ${s.done}/${s.steps} · тестов сдано ${s.passed}` + (s.bestEx != null ? ` · зачёт: лучший ${s.bestEx}/${c.exam.n}` : '')),
            h('div', { class: 'bar' }, h('i', { style: { width: s.pct + '%' } }))));
        });
        g.append(h('a', { href: '#/new', class: 'course-card new' }, h('span', { class: 'emoji' }, '＋'), h('div', { class: 't' }, 'Новый курс'), h('div', { class: 's' }, 'Загрузи лекции — получишь конспект, тесты и пробный зачёт')));
        return g;
      })());
    // слабые места
    const weakRows = [];
    COURSES.forEach(c => Object.entries(P.weak(c.id)).forEach(([k, n]) => { const [tid, sec] = k.split(':').map(Number); const t = c.topics.find(x => x.id === tid); if (t && t.sections[sec]) weakRows.push({ c, t, sec, n }); }));
    weakRows.sort((a, b) => b.n - a.n);
    if (weakRows.length) app.append(h('div', { class: 'card', style: { marginTop: '18px' } }, h('h2', {}, '🔁 Что повторить в первую очередь'), h('p', { class: 'muted small' }, 'Разделы, по которым больше всего ошибок в тестах и пробных зачётах.'),
      ...weakRows.slice(0, 6).map(w => h('div', { class: 'list-row' }, h('span', {}, `${w.c.emoji} Тема ${w.t.id} · ${w.t.sections[w.sec].title}`), h('a', { class: 'btn small', href: `#/c/${w.c.id}/t/${w.t.id}#s${w.sec + 1}` }, `${w.n} ${plural(w.n, 'ошибка', 'ошибки', 'ошибок')} · повторить`)))));
    const allEx = []; COURSES.forEach(c => P.exams(c.id).forEach(e => allEx.push(Object.assign({ c }, e))));
    allEx.sort((a, b) => b.ts - a.ts);
    if (allEx.length) app.append(h('div', { class: 'card' }, h('h2', {}, '🎯 Последние пробные зачёты'),
      ...allEx.slice(0, 5).map(e => h('div', { class: 'list-row' }, h('span', {}, `${e.c.emoji} ${e.c.short} · ${fmtDate(e.ts)}`), h('b', { style: { color: e.passed ? 'var(--good)' : 'var(--bad)' } }, `${e.score}/${e.total} ${e.passed ? '✓ сдан' : '✗ не сдан'}`)))));
    app.append(h('div', { class: 'card' }, h('h2', {}, 'Как читать конспекты: цвет = смысл'),
      h('div', { class: 'legend', html: '<div class="def"><b>📘 Определение</b><br>термин</div><div class="exam"><b>🎯 На зачёт</b><br>выучить почти дословно</div><div class="warn"><b>⚠️ Важно</b><br>ловушка, частая ошибка</div><div class="tip"><b>💡 Пояснение</b><br>простыми словами</div><div class="formula"><b>📐 Формула</b><br>с разбором</div><div class="scheme"><b>🧩 Схема</b><br>как читать картинку</div><div class="practice"><b>✋ Практика</b><br>интерактив</div>' })));
  }

  // ================= профиль =================
  function renderProfile() {
    const p = profile();
    const name = h('input', { type: 'text', value: p.name || '' });
    const key = h('input', { type: 'password', value: p.apiKey || '', placeholder: 'sk-ant-…', autocomplete: 'off' });
    const model = h('select', {}, [['claude-opus-5-5', 'Claude Opus 5.5 — лучшее качество (по умолчанию)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 — дешевле, чуть проще']].map(([v, l]) => h('option', { value: v }, l)));
    model.value = p.model || 'claude-opus-5-5';
    const importInp = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
    importInp.onchange = async () => { const f = importInp.files[0]; if (!f) return; try { const data = JSON.parse(await f.text()); await restoreBackup(data); toast('Резервная копия восстановлена'); route(); } catch (e) { toast('Не получилось прочитать файл: ' + e.message); } };
    app.append(h('div', { class: 'topic-hero' }, h('p', { class: 'eyebrow' }, 'Личный кабинет'), h('h1', {}, '👤 Профиль и настройки')),
      h('div', { class: 'card' }, h('h2', {}, 'Профиль'),
        h('div', { class: 'field' }, h('label', {}, 'Имя'), name),
        h('div', { class: 'notice orange small', html: 'Профиль и прогресс хранятся <b>в этом браузере</b>. На другом устройстве или в другом браузере будет чистый кабинет. Чтобы перенести прогресс, сделай резервную копию ниже и восстанови её там.' })),
      h('div', { class: 'card' }, h('h2', {}, '✨ Генерация курсов с помощью Claude'),
        h('p', { class: 'muted small', html: 'Чтобы платформа сама превращала лекции в конспект и тесты, нужен твой API-ключ Anthropic (создаётся на <a href="https://platform.claude.com/" target="_blank" rel="noopener">platform.claude.com</a>, оплата по факту использования). Ключ хранится только в этом браузере и отправляется только в Anthropic. Без ключа курсы можно загружать готовыми файлами (импорт JSON).' }),
        h('div', { class: 'field' }, h('label', {}, 'API-ключ Anthropic'), key, h('div', { class: 'help' }, 'Не делись ключом и не вводи его на чужих устройствах.')),
        h('div', { class: 'field' }, h('label', {}, 'Модель'), model)),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { setProfile(Object.assign(profile(), { name: name.value.trim(), apiKey: key.value.trim(), model: model.value })); toast('Сохранено'); renderNav(parseRoute()); } }, 'Сохранить')),
      h('div', { class: 'card', style: { marginTop: '18px' } }, h('h2', {}, '💾 Резервная копия'),
        h('p', { class: 'muted small' }, 'Сохраняет профиль (без API-ключа), весь прогресс и твои собственные курсы в один файл.'),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: makeBackup }, '⬇️ Скачать копию'), h('button', { class: 'btn', onclick: () => importInp.click() }, '⬆️ Восстановить из файла'), importInp)),
      h('div', { class: 'card' }, h('h2', {}, 'Сброс'),
        h('p', { class: 'muted small' }, 'Удаляет прогресс по всем курсам (шаги, тесты, зачёты). Сами курсы остаются.'),
        h('button', { class: 'btn danger', onclick: () => { if (!confirm('Удалить весь прогресс по всем курсам? Это нельзя отменить.')) return; ls.keys().filter(k => /^(done|quiz|exams|weak):/.test(k) || k === 'last').forEach(ls.del); toast('Прогресс сброшен'); route(); } }, 'Сбросить прогресс')));
  }
  async function makeBackup() {
    const data = { app: 'zachetka', version: 1, ts: Date.now(), local: {}, courses: await idb.all() };
    ls.keys().forEach(k => { data.local[k] = ls.get(k); });
    if (data.local.profile) data.local.profile = Object.assign({}, data.local.profile, { apiKey: '' });
    download(`zachetka-backup-${new Date().toISOString().slice(0, 10)}.json`, data);
  }
  async function restoreBackup(data) {
    if (!data || data.app !== 'zachetka') throw new Error('это не резервная копия Зачётки');
    const keep = profile().apiKey;
    Object.entries(data.local || {}).forEach(([k, v]) => ls.set(k, v));
    setProfile(Object.assign(profile(), { apiKey: keep }));
    for (const c of data.courses || []) await idb.put(c);
    await loadCourses();
  }
  function download(name, obj) {
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' })), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ================= страница курса =================
  function renderCourse(c) {
    const s = P.courseStats(c);
    const ex = P.exams(c.id);
    app.append(h('div', { class: 'topic-hero' }, h('p', { class: 'eyebrow' }, c.builtin ? 'Готовый курс' : 'Мой курс'), h('h1', {}, c.emoji + ' ' + c.title), c.description ? h('p', { class: 'lead' }, c.description) : null));
    if (!c.topics.length) {
      app.append(h('div', { class: 'card accent' }, h('h2', {}, 'В курсе пока нет тем'), h('p', {}, 'Загрузи материалы лекций — платформа сделает конспект, тесты и пробный зачёт. Или импортируй готовый файл курса.'), h('a', { class: 'btn primary', href: `#/c/${c.id}/manage` }, '⚙️ Добавить лекции')));
      return;
    }
    const nextT = c.topics.find(t => P.done(c.id, t.id).size < t.sections.length) || c.topics[0];
    app.append(h('div', { class: 'card summary' },
      h('div', { class: 'stats-row' },
        h('div', { class: 'stat' }, h('b', {}, `${s.done}/${s.steps}`), h('span', {}, 'шагов изучено')),
        h('div', { class: 'stat' }, h('b', {}, `${s.passed}/${s.topics}`), h('span', {}, 'тестов сдано (≥70%)')),
        h('div', { class: 'stat' }, h('b', {}, s.bestEx != null ? `${s.bestEx}/${c.exam.n}` : '—'), h('span', {}, 'лучший пробный зачёт'))),
      h('div', { class: 'row', style: { marginTop: '14px' } }, h('a', { class: 'btn primary', href: `#/c/${c.id}/t/${nextT.id}` }, 'Продолжить учиться →'), h('a', { class: 'btn', href: `#/c/${c.id}/exam` }, '🎯 Пробный зачёт'))),
      h('div', { class: 'card' }, h('h2', {}, 'Формат зачёта'), h('p', { html: `Пробный зачёт: <b>${c.exam.n} ${plural(c.exam.n, 'вопрос', 'вопроса', 'вопросов')}</b> из всех тем, сдан при <b>${c.exam.pass}</b> правильных.` }), c.exam.note ? h('p', { class: 'muted' }, c.exam.note) : null,
        c.game ? h('p', { html: `Тренировка: <a href="${c.game.url}" target="_blank" rel="noopener">${esc(c.game.name)}</a>` }) : null),
      h('h2', { style: { marginTop: '24px' } }, 'Темы'),
      (() => { const g = h('div', { class: 'topic-grid' }); c.topics.forEach(t => { const b = P.best(c.id, t.id), d = [...P.done(c.id, t.id)].filter(i => i < t.sections.length).length; g.append(h('a', { href: `#/c/${c.id}/t/${t.id}`, class: 'topic-card' }, h('div', { class: 'n' }, `ТЕМА ${t.id}`), h('div', { class: 't' }, t.title), h('div', { class: 's' }, `Шагов: ${d}/${t.sections.length} · Тест: ${b ? b.score + '/' + b.total : 'не пройден'}`), h('div', { class: 'bar' }, h('i', { style: { width: (t.sections.length ? Math.round(d / t.sections.length * 100) : 0) + '%' } })))); }); return g; })());
    if (ex.length) app.append(h('div', { class: 'card', style: { marginTop: '18px' } }, h('h2', {}, 'История пробных зачётов'), ...ex.slice().reverse().slice(0, 8).map(e => h('div', { class: 'list-row' }, h('span', {}, fmtDate(e.ts)), h('b', { style: { color: e.passed ? 'var(--good)' : 'var(--bad)' } }, `${e.score}/${e.total}`)))));
  }

  // ================= тема =================
  const KIND_LABEL = { def: '📘 Определение', exam: '🎯 На зачёт', warn: '⚠️ Важно', tip: '💡 Пояснение', scheme: '🧩 Как читать схему' };
  function renderBlock(b) {
    switch (b.type) {
      case 'html': return h('div', { html: b.html });
      case 'callout': { const k = b.kind || 'tip'; return h('div', { class: 'callout ' + k, html: `<span class="kind">${KIND_LABEL[k] || ''}</span>` + (b.title ? `<span class="ttl">${b.title}</span>` : '') + b.html }); }
      case 'scheme': return h('div', {}, h('div', { class: 'diagram', html: `<div class="cap">🧩 Схема${b.title ? ': ' + b.title : ''}</div>` + b.html }), b.explain ? h('div', { class: 'callout scheme', html: `<span class="kind">${KIND_LABEL.scheme}</span>` + b.explain }) : null);
      case 'formula': return h('div', { class: 'formula' }, h('div', { class: 'step-label' }, '📐 Формула' + (b.name ? ': ' + strip(b.name) : '')), h('div', { class: 'expr', html: b.expr }),
        h('div', { class: 'parts' }, (b.parts || []).map(([s, d]) => h('div', { class: 'part' }, h('span', { class: 'sym', html: s }), h('span', { html: d })))),
        b.why ? h('div', { class: 'why', html: '<b>Зачем нужна:</b> ' + b.why }) : null, b.example ? h('div', { class: 'why', style: { marginTop: '6px' }, html: '<b>Пример:</b> ' + b.example }) : null);
      case 'widget': return renderWidget(b);
      default: return h('div');
    }
  }
  const sourceLine = (t, s) => t.source ? `📄 ${esc(t.source)}${s && s.slides ? ', слайды ' + esc(s.slides) : ''}` : (s && s.slides ? `📄 слайды ${esc(s.slides)}` : '');

  function renderTopic(c, t) {
    const secs = t.sections, done = P.done(c.id, t.id);
    const toc = h('div', { class: 'toc' });
    const drawToc = () => { toc.innerHTML = ''; secs.forEach((s, i) => toc.append(h('a', { href: `#/c/${c.id}/t/${t.id}#s${i + 1}`, class: done.has(i) ? 'done' : '' }, done.has(i) ? '✓' : `${i + 1}.`, s.title))); toc.append(h('a', { href: `#/c/${c.id}/t/${t.id}#cheat` }, '📋 Шпаргалка'), h('a', { href: `#/c/${c.id}/t/${t.id}#quiz` }, '📝 Тест')); };
    drawToc();
    app.append(h('div', { class: 'breadcrumbs' }, h('a', { href: '#/' }, 'Кабинет'), ' / ', h('a', { href: '#/c/' + c.id }, c.emoji + ' ' + c.short), ' / ', `Тема ${t.id}`),
      h('div', { class: 'topic-hero' }, h('p', { class: 'eyebrow' }, `Тема ${t.id}` + (t.lecture ? ' · ' + strip(t.lecture) : '')), h('h1', {}, strip(t.title)), t.subtitle ? h('p', { class: 'lead' }, strip(t.subtitle)) : null, t.source ? h('p', { class: 'source-ref' }, '📄 Источник: ' + strip(t.source)) : null),
      h('div', { class: 'card summary' }, h('h2', {}, '🗺 Что мы изучим'), t.summary.intro ? h('p', { html: t.summary.intro }) : null, h('ol', {}, t.summary.points.map(p => h('li', { html: p }))),
        h('p', { class: 'muted small', style: { marginTop: '10px' } }, 'Читай по шагам. В конце каждого шага нажми «Шаг понятен» — полоска вверху покажет прогресс.'), toc));
    secs.forEach((s, i) => {
      const card = h('section', { class: 'card' + (done.has(i) ? ' done' : ''), id: 's' + (i + 1) }, h('div', { class: 'step-label' }, `Шаг ${i + 1} из ${secs.length}`), h('h2', {}, h('span', { class: 'num' }, String(i + 1)), s.title));
      s.blocks.forEach(b => card.append(renderBlock(b)));
      const btn = h('button', { class: 'done-btn' + (done.has(i) ? ' on' : '') }, done.has(i) ? '✓ Шаг понятен' : 'Отметить: шаг понятен');
      btn.onclick = () => {
        if (done.has(i)) done.delete(i); else done.add(i);
        P.setDone(c.id, t.id, done);
        btn.className = 'done-btn' + (done.has(i) ? ' on' : ''); btn.textContent = done.has(i) ? '✓ Шаг понятен' : 'Отметить: шаг понятен';
        card.classList.toggle('done', done.has(i)); drawToc(); updateStrip(c, t);
        if (done.has(i) && secs[i + 1]) document.getElementById('s' + (i + 2)).scrollIntoView({ behavior: 'smooth' });
      };
      card.append(h('div', { class: 'done-row' }, h('span', { class: 'source-ref', html: sourceLine(t, s) }), btn));
      app.append(card);
    });
    if (t.cheatsheet.length) app.append(h('section', { class: 'card summary', id: 'cheat' }, h('h2', {}, '📋 Шпаргалка: главное за 2 минуты'), h('ul', {}, t.cheatsheet.map(x => h('li', { html: x })))));
    if (t.game) app.append(h('div', { class: 'card game-link' }, h('div', {}, h('b', {}, '🎮 Практика: ' + strip(t.game.name)), h('div', { class: 'muted small', html: t.game.text || '' })), h('a', { class: 'btn primary', href: t.game.url, target: '_blank', rel: 'noopener' }, 'Открыть ↗')));
    if (t.quiz.length) app.append(renderQuiz({ c, key: t.id, title: '📝 Тест по теме', pool: () => shuffle(t.quiz.map(q => Object.assign({ _t: t }, q))) }));
    const idx = c.topics.indexOf(t), prev = c.topics[idx - 1], next = c.topics[idx + 1];
    app.append(h('div', { class: 'pager' }, prev ? h('a', { class: 'btn', href: `#/c/${c.id}/t/${prev.id}` }, '← ' + prev.short) : h('span'),
      next ? h('a', { class: 'btn primary', href: `#/c/${c.id}/t/${next.id}` }, next.short + ' →') : h('a', { class: 'btn primary', href: `#/c/${c.id}/exam` }, '🎯 Пробный зачёт →')));
  }

  // ================= тест + разбор ошибок =================
  function reviewBlock(c, t, q) {
    const s = t.sections[q.ref]; if (!s) return null;
    const key = s.blocks.filter(b => b.type === 'callout' && (b.kind === 'exam' || b.kind === 'def')).slice(0, 3);
    const formula = s.blocks.find(b => b.type === 'formula');
    const body = h('div', { class: 'rv-body' });
    body.append(h('p', { style: { margin: '8px 0' }, html: `Вопрос относится к <b>теме ${t.id}</b>, шаг ${q.ref + 1} — «${s.title}». Вот главное из этого шага:` }));
    if (key.length || formula) { key.forEach(b => body.append(renderBlock(b))); if (formula) body.append(renderBlock(formula)); }
    else { const first = s.blocks.find(b => b.type === 'html' || b.type === 'callout'); if (first) { const txt = strip(first.html); body.append(h('p', {}, txt.length > 700 ? txt.slice(0, 700) + '…' : txt)); } }
    body.append(h('div', { class: 'rv-links' }, h('a', { class: 'btn small primary', href: `#/c/${c.id}/t/${t.id}#s${q.ref + 1}` }, '📖 Открыть шаг полностью'), sourceLine(t, s) ? h('span', { class: 'source-ref', html: 'Где читать подробнее: ' + sourceLine(t, s) }) : null));
    return h('details', { class: 'review' }, h('summary', {}, `📖 Повторить материал: тема ${t.id} · «${s.title}»`), body);
  }

  function renderQuiz(cfg) {
    const { c } = cfg;
    const sec = h('section', { class: 'card quiz-card', id: 'quiz' });
    const scoreBar = h('div', { class: 'quiz-score' }), list = h('div'), banner = h('div');
    let state, qs;
    const start = (only) => {
      qs = only || cfg.pool();
      state = { answered: 0, right: 0, wrong: [], retry: !!only };
      list.innerHTML = ''; banner.innerHTML = '';
      qs.forEach((q, qi) => list.append(renderQ(q, qi, qs.length)));
      upd();
    };
    const upd = () => {
      const total = qs.length;
      scoreBar.innerHTML = '';
      scoreBar.append(h('span', {}, `Отвечено ${state.answered}/${total} · верно ${state.right}`), h('span', { class: 'meter' }, h('i', { style: { width: Math.round(state.answered / total * 100) + '%' } })),
        h('button', { class: 'btn small', onclick: () => { start(); sec.scrollIntoView(); } }, cfg.exam ? 'Новый вариант' : 'Заново'));
      if (state.answered !== total) return;
      const pct = Math.round(state.right / total * 100);
      const pass = cfg.exam ? state.right >= c.exam.pass : pct >= 70;
      if (!state.retry) {
        if (cfg.exam) P.addExam(c.id, { ts: Date.now(), score: state.right, total, passed: pass });
        const prev = P.best(c.id, cfg.key); if (!prev || prev.score < state.right) P.setBest(c.id, cfg.key, { score: state.right, total, pct });
      }
      renderNav(parseRoute());
      banner.innerHTML = '';
      // план повторения
      const groups = {};
      state.wrong.forEach(q => { const k = q._t.id + ':' + q.ref; (groups[k] = groups[k] || { t: q._t, ref: q.ref, n: 0 }).n++; });
      const plan = Object.values(groups).sort((a, b) => b.n - a.n);
      banner.append(h('div', { class: 'result-banner ' + (pass ? 'pass' : 'fail') },
        h('b', { class: 'big' }, `${state.right} из ${total}`),
        h('div', { html: cfg.exam ? (pass ? `🎉 Зачёт сдан! Нужно было ${c.exam.pass}.` : `Пока не хватает ${c.exam.pass - state.right} ${plural(c.exam.pass - state.right, 'правильного ответа', 'правильных ответов', 'правильных ответов')} до ${c.exam.pass}.`) : (pass ? '🎉 Тема засчитана (70% и больше).' : 'Перечитай шпаргалку и разделы из плана ниже, потом попробуй ещё раз.') }),
        plan.length ? h('div', { style: { marginTop: '12px' } }, h('b', {}, '📋 План повторения'), ...plan.map(p => { const s = p.t.sections[p.ref]; return h('div', { class: 'plan-item' }, h('a', { href: `#/c/${c.id}/t/${p.t.id}#s${p.ref + 1}` }, `Тема ${p.t.id} · шаг ${p.ref + 1}: ${s ? s.title : ''}`), ` — ${p.n} ${plural(p.n, 'ошибка', 'ошибки', 'ошибок')}`, s && sourceLine(p.t, s) ? h('div', { class: 'source-ref', html: sourceLine(p.t, s) }) : null); })) : null,
        state.wrong.length ? h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn primary', onclick: () => { start(shuffle(state.wrong)); sec.scrollIntoView(); } }, `🔁 Повторить только ошибки (${state.wrong.length})`)) : null));
    };
    function renderQ(q, qi, total) {
      const t = q._t;
      const box = h('div', { class: 'quiz-q' }, h('div', { class: 'qn' }, `ВОПРОС ${qi + 1} ИЗ ${total}`, cfg.exam ? h('span', { class: 'src' }, 'Тема ' + t.id) : null), h('div', { class: 'qt', html: q.q }));
      const opts = h('div', { class: 'opts' }), extra = h('div');
      shuffle(q.opts.map((o, i) => i)).forEach((i, pos) => {
        const b = h('button', { class: 'opt', onclick: () => {
          if (box.classList.contains('answered')) return;
          box.classList.add('answered'); state.answered++;
          const ok = i === q.a;
          if (ok) { state.right++; P.markWeak(c.id, t.id, q.ref, -1); } else { state.wrong.push(q); P.markWeak(c.id, t.id, q.ref, +1); }
          b.classList.add(ok ? 'right' : 'wrong');
          if (!ok) opts.querySelector(`[data-i="${q.a}"]`).classList.add('right');
          const why = q.why && q.why[i] ? `<p style="margin:4px 0 0"><b>Почему этот вариант неверен:</b> ${q.why[i]}</p>` : '';
          extra.append(h('div', { class: 'explain ' + (ok ? 'good' : 'bad'), html: ok ? `<span class="h">✓ Верно!</span>${q.explain}` : `<span class="h">✗ Ошибка. Правильно: «${strip(q.opts[q.a])}»</span>${why}<p style="margin:4px 0 0"><b>Объяснение:</b> ${q.explain}</p>` }));
          if (!ok) { const rv = reviewBlock(c, t, q); if (rv) { rv.open = true; extra.append(rv); } }
          upd();
        } }, h('span', { class: 'letter' }, 'АБВГДЕЖЗ'[pos]), h('span', { html: q.opts[i] }));
        b.dataset.i = i; opts.append(b);
      });
      box.append(opts);
      if (q.hint) { const hb = h('button', { class: 'hint-btn', onclick: () => hb.replaceWith(h('div', { class: 'hint', html: '💡 ' + q.hint })) }, '💡 Показать подсказку'); box.append(hb); }
      box.append(extra);
      return box;
    }
    sec.append(h('h2', {}, cfg.title), h('p', { class: 'muted', style: { fontSize: '15.5px' } }, cfg.desc || 'Выбирай ответ. При ошибке увидишь правильный вариант, объяснение и разбор нужного раздела лекции со ссылкой, где читать подробнее. В конце — план повторения.'), list, banner, scoreBar);
    start();
    return sec;
  }

  function renderExam(c) {
    const ready = c.topics.filter(t => t.quiz.length);
    if (!ready.length) { app.append(h('div', { class: 'card' }, 'В этом курсе пока нет вопросов.')); return; }
    const pool = () => {
      const N = c.exam.n, per = Math.floor(N / ready.length); let rest = N - per * ready.length, out = [];
      shuffle(ready).forEach(t => { const n = per + (rest-- > 0 ? 1 : 0); out = out.concat(shuffle(t.quiz).slice(0, n).map(q => Object.assign({ _t: t }, q))); });
      if (out.length < N) { const used = new Set(out); const extraQ = shuffle(ready.flatMap(t => t.quiz.map(q => Object.assign({ _t: t }, q)))).filter(q => !out.some(o => o.q === q.q)); out = out.concat(extraQ.slice(0, N - out.length)); }
      return shuffle(out);
    };
    app.append(h('div', { class: 'breadcrumbs' }, h('a', { href: '#/' }, 'Кабинет'), ' / ', h('a', { href: '#/c/' + c.id }, c.emoji + ' ' + c.short), ' / Пробный зачёт'),
      h('div', { class: 'topic-hero' }, h('p', { class: 'eyebrow' }, 'Формат настоящего зачёта'), h('h1', {}, '🎯 Пробный зачёт'),
        h('p', { class: 'lead' }, `${c.exam.n} случайных вопросов из всех тем курса. Чтобы сдать, нужно ${c.exam.pass} правильных. После ошибки сайт покажет нужный раздел лекции и где читать подробнее.`)),
      renderQuiz({ c, key: 'exam', exam: true, title: 'Вопросы', desc: 'Подсказки есть, но на настоящем зачёте их не будет — попробуй сначала без них.', pool }));
  }

  // ================= создание курса =================
  const EMOJIS = ['📘', '📗', '📙', '🧠', '💼', '📊', '⚖️', '🧪', '🧮', '🌍', '💻', '🏛', '🎨', '🩺', '📈', '🗣'];
  function materialsPicker(onChange) {
    const files = [];
    const inp = h('input', { type: 'file', multiple: true, accept: '.pdf,.txt,.md,application/pdf,text/plain,text/markdown', class: 'hidden' });
    const list = h('div', { class: 'file-list' });
    const natural = (a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true });
    const add = fl => { [...fl].forEach(f => { if (/\.(pdf|txt|md)$/i.test(f.name) && !files.some(x => x.name === f.name && x.size === f.size)) files.push(f); }); files.sort(natural); draw(); };
    const draw = () => {
      list.innerHTML = '';
      files.forEach((f, i) => {
        const item = h('div', { class: 'file-item' }, h('span', {}, /\.pdf$/i.test(f.name) ? '📄' : '📝'), h('span', {}, h('b', {}, `Лекция ${i + 1}: `), f.name, h('span', { class: 'muted small' }, ` · ${(f.size / 1048576).toFixed(1)} МБ`)),
          h('span', { class: 'row' }, h('button', { class: 'btn small', title: 'Выше', onclick: () => { if (i) { [files[i - 1], files[i]] = [files[i], files[i - 1]]; draw(); } } }, '▲'), h('button', { class: 'btn small', title: 'Ниже', onclick: () => { if (i < files.length - 1) { [files[i + 1], files[i]] = [files[i], files[i + 1]]; draw(); } } }, '▼'), h('button', { class: 'btn small danger', title: 'Убрать', onclick: () => { files.splice(i, 1); draw(); } }, '✕')));
        f._el = item; list.append(item);
      });
      onChange && onChange(files);
    };
    const dz = h('div', { class: 'dropzone', tabindex: '0', onclick: () => inp.click(), onkeydown: e => { if (e.key === 'Enter') inp.click(); } }, '📂 Перетащи сюда PDF лекций (или .txt / .md) — или нажми, чтобы выбрать', h('div', { class: 'muted small', style: { fontWeight: '400', marginTop: '6px' } }, 'Одна лекция = один файл = одна тема. Порядок — по названию файлов, его можно поменять стрелками.'));
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); add(e.dataTransfer.files); });
    inp.onchange = () => { add(inp.files); inp.value = ''; };
    return { el: h('div', {}, dz, inp, list), files };
  }

  function renderNew() {
    let emoji = '📘';
    const title = h('input', { type: 'text', placeholder: 'Например: Маркетинг, 2 курс' });
    const short = h('input', { type: 'text', placeholder: 'Короткое имя для вкладки (необязательно)' });
    const desc = h('textarea', { placeholder: 'О чём курс (необязательно)' });
    const ctx = h('textarea', { placeholder: 'Например: зачёт — тест из 30 вопросов; преподаватель любит спрашивать определения и формулы' });
    const n = h('input', { type: 'number', min: 5, max: 100, value: 24 }), pass = h('input', { type: 'number', min: 1, max: 100, value: 15 });
    const ep = h('div', { class: 'emoji-pick' });
    EMOJIS.forEach(e => { const b = h('button', { class: e === emoji ? 'on' : '', type: 'button', onclick: () => { emoji = e; ep.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); } }, e); ep.append(b); });
    const picker = materialsPicker();
    const status = h('div');
    const raw = () => ({ id: slug(title.value || 'course'), title: title.value.trim() || 'Новый курс', short: short.value.trim() || (title.value.trim() || 'Новый курс').slice(0, 24), emoji, description: desc.value.trim(), context: ctx.value.trim(), exam: { n: +n.value || 24, pass: +pass.value || 15 }, createdAt: Date.now(), topics: [] });
    const importInp = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
    importInp.onchange = async () => { const f = importInp.files[0]; if (!f) return; try { const data = JSON.parse(await f.text()); const c = await importCoursePackage(data); toast('Курс импортирован'); location.hash = '#/c/' + c.id; } catch (e) { toast('Не получилось импортировать: ' + e.message); } };
    app.append(h('div', { class: 'topic-hero' }, h('p', { class: 'eyebrow' }, 'Новый курс'), h('h1', {}, '＋ Создать курс'), h('p', { class: 'lead' }, 'Загрузи материалы лекций — и получишь то же, что в готовом курсе: конспект по каждой теме с разбором схем и формул, интерактивные задания, тесты и пробный зачёт.')),
      h('div', { class: 'card' }, h('h2', {}, '1. О курсе'),
        h('div', { class: 'field' }, h('label', {}, 'Название предмета'), title),
        h('div', { class: 'field' }, h('label', {}, 'Короткое имя для вкладки'), short),
        h('div', { class: 'field' }, h('label', {}, 'Иконка'), ep),
        h('div', { class: 'field' }, h('label', {}, 'Описание'), desc),
        h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', {}, 'Вопросов в пробном зачёте'), n), h('div', { class: 'field' }, h('label', {}, 'Нужно правильных, чтобы сдать'), pass)),
        h('div', { class: 'field' }, h('label', {}, 'Что важно знать о зачёте ', h('small', {}, '(подскажет ИИ, на что делать упор)')), ctx)),
      h('div', { class: 'card' }, h('h2', {}, '2. Материалы лекций'), picker.el),
      h('div', { class: 'card accent' }, h('h2', {}, '3. Создать'),
        h('p', { class: 'small', html: '<b>✨ С помощью Claude</b> — платформа отправит каждую лекцию в Claude и соберёт тему: конспект, схемы, формулы, задания и 20–25 вопросов со ссылками на слайды. Нужен твой API-ключ в <a href="#/profile">профиле</a>. Одна лекция обрабатывается 2–6 минут и стоит примерно $0,5–1,5 (зависит от объёма).' }),
        h('p', { class: 'small', html: '<b>📦 Из готового файла</b> — если курс уже сделан (например, Claude подготовил его в чате), импортируй файл <code>.json</code>.' }),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: async () => {
            if (!title.value.trim()) { toast('Введи название предмета'); title.focus(); return; }
            if (!picker.files.length) { toast('Добавь хотя бы один файл лекции'); return; }
            if (!profile().apiKey) { status.innerHTML = ''; status.append(h('div', { class: 'notice warn', html: 'Нужен API-ключ Anthropic. Добавь его в <a href="#/profile">профиле</a> и вернись — введённые данные курса придётся заполнить заново, поэтому лучше сначала открыть профиль в новой вкладке.' })); return; }
            const c = raw(); await saveCourse(c);
            await generateIntoCourse(c.id, picker.files, status);
          } }, '✨ Создать с помощью Claude'),
          h('button', { class: 'btn', onclick: async () => { if (!title.value.trim()) { toast('Введи название предмета'); title.focus(); return; } const c = raw(); await saveCourse(c); toast('Курс создан'); location.hash = '#/c/' + c.id + '/manage'; } }, 'Создать пустой курс'),
          h('button', { class: 'btn', onclick: () => importInp.click() }, '📦 Импорт готового курса'), importInp),
        status));
  }

  async function importCoursePackage(data) {
    // принимает курс целиком ({title, topics:[...]}) или одну тему ({title, sections, quiz})
    if (!data || typeof data !== 'object') throw new Error('пустой файл');
    if (data.app === 'zachetka') throw new Error('это резервная копия — восстанови её в профиле');
    if (!Array.isArray(data.topics)) throw new Error('в файле нет списка тем (topics)');
    const c = { id: slug(data.title || 'course'), title: data.title || 'Импортированный курс', short: data.short || data.title, emoji: data.emoji || '📗', description: data.description || '', context: data.context || '', exam: data.exam || { n: 24, pass: 15 }, game: data.game || null, createdAt: Date.now(), topics: data.topics };
    if (!normalizeCourse(c, false).topics.length) throw new Error('не удалось прочитать ни одной темы');
    await saveCourse(c); return c;
  }

  // Генерация тем по лекциям (по одной, с сохранением после каждой)
  async function generateIntoCourse(cid, files, statusEl) {
    const p = profile();
    statusEl.innerHTML = '';
    const log = h('div', { class: 'log' }, 'Подключаюсь к Claude…');
    const items = h('div', { class: 'file-list' });
    statusEl.append(h('h3', {}, 'Генерация'), h('p', { class: 'muted small' }, 'Не закрывай и не обновляй вкладку, пока идёт генерация. Каждая готовая тема сохраняется сразу.'), items, log);
    const rows = files.map((f, i) => { const st = h('span', { class: 'st' }, 'в очереди'); const el = h('div', { class: 'file-item' }, h('span', {}, '⏳'), h('span', {}, `Лекция ${i + 1}: ${f.name}`), st); items.append(el); return { el, st, ico: el.firstChild }; });
    let ai;
    try { ai = await import(new URL('js/ai.js', document.baseURI).href); } catch (e) { log.textContent = 'Не удалось загрузить модуль генерации: ' + e.message; return; }
    let okCount = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i], r = rows[i];
      r.el.className = 'file-item run'; r.ico.textContent = '✨'; r.st.textContent = 'читаю лекцию…';
      const rawC = (await idb.all()).find(x => x.id === cid);
      try {
        const topic = await ai.generateTopic({
          apiKey: p.apiKey, model: p.model || 'claude-opus-5-5', file: f, courseTitle: rawC.title, courseContext: rawC.context || '',
          topicNumber: rawC.topics.length + 1, previousTitles: rawC.topics.map(t => t.title),
          onProgress: (chars, phase) => { r.st.textContent = phase === 'thinking' ? 'думаю над структурой…' : `пишу конспект… ${Math.round(chars / 1000)} тыс. символов`; }
        });
        topic.source = f.name;
        rawC.topics.push(topic);
        await saveCourse(rawC);
        okCount++;
        r.el.className = 'file-item ok'; r.ico.textContent = '✅'; r.st.textContent = `готово: ${topic.sections ? topic.sections.length : 0} шагов, ${topic.quiz ? topic.quiz.length : 0} вопросов`;
        log.textContent = `Тема «${strip(topic.title)}» сохранена.`;
      } catch (e) {
        r.el.className = 'file-item err'; r.ico.textContent = '⚠️'; r.st.textContent = 'ошибка';
        log.textContent = `Лекция «${f.name}»: ${e.message}`;
        if (e.fatal) break;
      }
    }
    renderNav(parseRoute());
    statusEl.append(h('div', { class: 'row', style: { marginTop: '10px' } }, h('a', { class: 'btn primary', href: '#/c/' + cid }, okCount ? `Открыть курс (${okCount} ${plural(okCount, 'тема', 'темы', 'тем')}) →` : 'Открыть курс'), h('a', { class: 'btn', href: `#/c/${cid}/manage` }, '⚙️ Управление курсом')));
  }

  // ================= управление курсом =================
  function renderManage(c) {
    app.append(h('div', { class: 'breadcrumbs' }, h('a', { href: '#/' }, 'Кабинет'), ' / ', h('a', { href: '#/c/' + c.id }, c.emoji + ' ' + c.short), ' / Управление'),
      h('div', { class: 'topic-hero' }, h('p', { class: 'eyebrow' }, 'Управление курсом'), h('h1', {}, '⚙️ ' + c.title)));
    if (c.builtin) {
      app.append(h('div', { class: 'card' }, h('p', {}, 'Это готовый встроенный курс: его темы нельзя удалить или изменить. Можно скачать его как файл (например, чтобы посмотреть формат для своих курсов).'),
        h('button', { class: 'btn', onclick: () => download(c.id + '.json', exportable(c)) }, '⬇️ Скачать курс (.json)'),
        h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn danger', onclick: () => { if (!confirm('Сбросить прогресс по этому курсу?')) return; ls.keys().filter(k => k.includes(':' + c.id) || k.startsWith('done:' + c.id) || k.startsWith('quiz:' + c.id) || k === 'exams:' + c.id || k === 'weak:' + c.id).forEach(ls.del); toast('Прогресс по курсу сброшен'); } }, 'Сбросить прогресс по курсу'))));
      return;
    }
    const picker = materialsPicker();
    const status = h('div');
    const importInp = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
    importInp.onchange = async () => {
      const f = importInp.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const rawC = (await idb.all()).find(x => x.id === c.id);
        const add = Array.isArray(data.topics) ? data.topics : (data.sections ? [data] : null);
        if (!add) throw new Error('нужна тема (sections, quiz) или курс (topics)');
        rawC.topics.push(...add); await saveCourse(rawC); toast(`Добавлено тем: ${add.length}`); route();
      } catch (e) { toast('Не получилось: ' + e.message); }
    };
    const title = h('input', { type: 'text', value: strip(c.title) }), short = h('input', { type: 'text', value: strip(c.short) });
    const n = h('input', { type: 'number', value: c.exam.n }), pass = h('input', { type: 'number', value: c.exam.pass });
    app.append(
      h('div', { class: 'card' }, h('h2', {}, '➕ Добавить лекции'), h('p', { class: 'muted small' }, 'Новые файлы станут следующими темами курса.'), picker.el,
        h('div', { class: 'row', style: { marginTop: '12px' } },
          h('button', { class: 'btn primary', onclick: async () => { if (!picker.files.length) return toast('Добавь файлы лекций'); if (!profile().apiKey) { status.innerHTML = '<div class="notice warn">Нужен API-ключ Anthropic — добавь его в <a href="#/profile">профиле</a>.</div>'; return; } await generateIntoCourse(c.id, picker.files, status); } }, '✨ Сгенерировать темы'),
          h('button', { class: 'btn', onclick: () => importInp.click() }, '📦 Импорт темы из .json'), importInp), status),
      h('div', { class: 'card' }, h('h2', {}, 'Темы курса'),
        c.topics.length ? h('div', {}, ...c.topics.map((t, i) => h('div', { class: 'list-row' }, h('span', {}, `${t.id}. ${strip(t.title)}`, h('span', { class: 'muted small' }, ` · ${t.sections.length} шагов, ${t.quiz.length} вопросов`)),
          h('span', { class: 'row' }, h('button', { class: 'btn small', onclick: () => moveTopic(c.id, i, -1) }, '▲'), h('button', { class: 'btn small', onclick: () => moveTopic(c.id, i, 1) }, '▼'), h('button', { class: 'btn small danger', onclick: async () => { if (!confirm(`Удалить тему «${strip(t.title)}»?`)) return; const rawC = (await idb.all()).find(x => x.id === c.id); rawC.topics.splice(i, 1); await saveCourse(rawC); route(); } }, 'Удалить'))))) : h('p', { class: 'muted' }, 'Тем пока нет.')),
      h('div', { class: 'card' }, h('h2', {}, 'Настройки'),
        h('div', { class: 'field' }, h('label', {}, 'Название'), title), h('div', { class: 'field' }, h('label', {}, 'Короткое имя'), short),
        h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', {}, 'Вопросов в зачёте'), n), h('div', { class: 'field' }, h('label', {}, 'Нужно правильных'), pass)),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => { const rawC = (await idb.all()).find(x => x.id === c.id); Object.assign(rawC, { title: title.value.trim() || rawC.title, short: short.value.trim() || rawC.short, exam: Object.assign({}, rawC.exam, { n: +n.value || 24, pass: +pass.value || 15 }) }); await saveCourse(rawC); toast('Сохранено'); route(); } }, 'Сохранить'),
          h('button', { class: 'btn', onclick: async () => download(c.id + '.json', exportable((await idb.all()).find(x => x.id === c.id))) }, '⬇️ Скачать курс (.json)'),
          h('button', { class: 'btn danger', onclick: async () => { if (!confirm(`Удалить курс «${strip(c.title)}» вместе с темами? Это нельзя отменить.`)) return; await idb.del(c.id); await loadCourses(); toast('Курс удалён'); location.hash = '#/'; } }, 'Удалить курс'))));
  }
  async function moveTopic(cid, i, d) { const rawC = (await idb.all()).find(x => x.id === cid); const j = i + d; if (j < 0 || j >= rawC.topics.length) return; [rawC.topics[i], rawC.topics[j]] = [rawC.topics[j], rawC.topics[i]]; await saveCourse(rawC); route(); }
  function exportable(c) { const o = JSON.parse(JSON.stringify(c)); delete o.builtin; (o.topics || []).forEach(t => (t.quiz || []).forEach(q => { delete q._t; })); return o; }

  // ================= старт =================
  loadCourses().then(route);
  window.ZP.platform = { loadCourses, route, sanitize };
})();
