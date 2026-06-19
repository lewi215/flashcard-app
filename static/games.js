'use strict';

// ── Match Mode ─────────────────────────────────────────────────────────
const MATCH = {
  originalCards: [],
  pairs: [],
  selected: null,
  matched: new Set(),
  mistakes: 0,
  startTime: 0,
  xpEarned: 0,
  locked: false,
};

async function startMatchSection() {
  if (!S.activeSection) return;
  const { chapterPath, sectionSlug } = S.activeSection;
  try {
    const data = await api(`/api/cards?path=${encodeURIComponent(chapterPath)}&section_slug=${encodeURIComponent(sectionSlug)}`);
    startMatchMode([...(data.generated || []), ...(data.user_created || [])]);
  } catch (e) {
    toast('Could not load cards: ' + e.message, 'error');
  }
}

async function startMatchFromConfig() {
  const selections = getStudySelections();
  if (!selections.length) { toast('Select at least one section', 'error'); return; }
  document.getElementById('study-config-modal').classList.add('hidden');
  const all = [];
  for (const sel of selections) {
    try {
      const data = await api(`/api/cards?path=${encodeURIComponent(sel.chapterPath)}&section_slug=${encodeURIComponent(sel.sectionSlug)}`);
      all.push(...(data.generated || []), ...(data.user_created || []));
    } catch (_) {}
  }
  startMatchMode(all);
}

function startMatchMode(cards) {
  const pairs = cards
    .map(c => ({
      id: c.id,
      question: c.front.replace(/\{blank\}/g, '___'),
      answer: c.type === 'multiple_choice' ? (c.options || [])[c.correct_index] : c.back,
    }))
    .filter(p => p.question && p.answer);

  if (pairs.length < 3) {
    toast('Match needs at least 3 cards. Generate more first.', 'info');
    return;
  }

  const chosen = [...pairs].sort(() => Math.random() - 0.5).slice(0, 6);
  Object.assign(MATCH, {
    originalCards: cards,
    pairs: chosen,
    selected: null,
    matched: new Set(),
    mistakes: 0,
    startTime: Date.now(),
    xpEarned: 0,
    locked: false,
  });

  document.getElementById('match-overlay').classList.remove('hidden');
  renderMatchBoard();
}

function renderMatchBoard() {
  const overlay = document.getElementById('match-overlay');
  const { pairs } = MATCH;

  const tiles = [
    ...pairs.map(p => ({ id: p.id, text: p.question, side: 'q' })),
    ...pairs.map(p => ({ id: p.id, text: p.answer,    side: 'a' })),
  ].sort(() => Math.random() - 0.5);

  overlay.innerHTML = `
    <div class="match-wrap">
      <div class="match-topbar">
        <button class="game-quit" id="match-quit">✕</button>
        <div class="match-title">Match the pairs</div>
        <div class="match-progress" id="match-progress">0 / ${pairs.length}</div>
      </div>
      <div class="match-grid" id="match-grid">
        ${tiles.map(t => `
          <button class="match-tile" data-id="${esc(t.id)}" data-side="${t.side}">
            ${esc(t.text)}
          </button>`).join('')}
      </div>
    </div>`;

  document.getElementById('match-quit').addEventListener('click', () => {
    if (confirm('Quit Match?')) overlay.classList.add('hidden');
  });

  overlay.querySelectorAll('.match-tile').forEach(tile => {
    tile.addEventListener('click', () => matchTileClick(tile));
  });
}

function matchTileClick(tile) {
  if (MATCH.locked) return;
  const id = tile.dataset.id;
  const side = tile.dataset.side;
  if (MATCH.matched.has(id)) return;

  if (tile.classList.contains('selected')) {
    tile.classList.remove('selected');
    MATCH.selected = null;
    return;
  }

  if (!MATCH.selected) {
    tile.classList.add('selected');
    MATCH.selected = { id, side, el: tile };
    return;
  }

  // Tapped same side — swap selection
  if (MATCH.selected.side === side) {
    MATCH.selected.el.classList.remove('selected');
    tile.classList.add('selected');
    MATCH.selected = { id, side, el: tile };
    return;
  }

  const prev = MATCH.selected;
  MATCH.selected = null;
  MATCH.locked = true;

  if (prev.id === id) {
    // Correct match
    MATCH.matched.add(id);
    prev.el.classList.remove('selected');
    prev.el.classList.add('match-correct');
    tile.classList.add('match-correct');
    MATCH.xpEarned += 10;

    document.getElementById('match-progress').textContent = `${MATCH.matched.size} / ${MATCH.pairs.length}`;

    setTimeout(() => {
      prev.el.classList.add('match-gone');
      tile.classList.add('match-gone');
      MATCH.locked = false;
      if (MATCH.matched.size === MATCH.pairs.length) setTimeout(matchComplete, 300);
    }, 480);
  } else {
    // Wrong
    MATCH.mistakes++;
    prev.el.classList.add('match-wrong');
    tile.classList.add('match-wrong');
    setTimeout(() => {
      prev.el.classList.remove('selected', 'match-wrong');
      tile.classList.remove('selected', 'match-wrong');
      MATCH.locked = false;
    }, 600);
  }
}

function matchComplete() {
  const elapsed = Math.round((Date.now() - MATCH.startTime) / 1000);
  const timeStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const stars = MATCH.mistakes === 0 ? 3 : MATCH.mistakes <= 2 ? 2 : 1;

  const gsResult = gsEarnXP(MATCH.xpEarned);
  renderGamBar();
  if (gsResult.leveledUp) setTimeout(() => showLevelUpToast(gsResult.newLevel), 600);
  const { pct, level } = gsLevelProgress();

  const overlay = document.getElementById('match-overlay');
  overlay.innerHTML = `
    <div class="game-end-wrap">
      <div class="game-end-stars">${'⭐'.repeat(stars)}</div>
      <div class="game-end-title">Matched!</div>
      <div class="game-end-stats">
        <div class="game-end-stat"><div class="game-end-num">${timeStr}</div><div class="game-end-label">Time</div></div>
        <div class="game-end-stat"><div class="game-end-num">${MATCH.mistakes}</div><div class="game-end-label">Mistakes</div></div>
        <div class="game-end-stat"><div class="game-end-num" style="color:var(--accent)">+${MATCH.xpEarned}</div><div class="game-end-label">XP</div></div>
      </div>
      <div class="blitz-end-xp-section">
        <div class="blitz-end-xp-label">Level ${level} progress</div>
        <div class="blitz-xp-bar-wrap"><div class="blitz-xp-bar" id="match-xp-bar" style="width:0%"></div></div>
      </div>
      ${gsResult.leveledUp ? `<div class="blitz-levelup-banner">⬆ Level Up! Now Level ${gsResult.newLevel}</div>` : ''}
      <div class="blitz-end-actions">
        <button class="btn btn-secondary" id="match-home">← Back</button>
        <button class="btn btn-match" id="match-again">🃏 Play Again</button>
      </div>
    </div>`;

  setTimeout(() => { const b = document.getElementById('match-xp-bar'); if (b) b.style.width = pct + '%'; }, 300);
  document.getElementById('match-home').addEventListener('click', () => overlay.classList.add('hidden'));
  document.getElementById('match-again').addEventListener('click', () => startMatchMode(MATCH.originalCards));
}

// ── Sprint Mode ────────────────────────────────────────────────────────
const SP = {
  originalCards: [],
  cards: [],
  index: 0,
  correct: 0,
  xpEarned: 0,
  startTime: 0,
};

async function startSprintSection() {
  if (!S.activeSection) return;
  const { chapterPath, sectionSlug } = S.activeSection;
  try {
    const data = await api(`/api/cards?path=${encodeURIComponent(chapterPath)}&section_slug=${encodeURIComponent(sectionSlug)}`);
    startSprintMode([...(data.generated || []), ...(data.user_created || [])]);
  } catch (e) {
    toast('Could not load cards: ' + e.message, 'error');
  }
}

async function startSprintFromConfig() {
  const selections = getStudySelections();
  if (!selections.length) { toast('Select at least one section', 'error'); return; }
  document.getElementById('study-config-modal').classList.add('hidden');
  const all = [];
  for (const sel of selections) {
    try {
      const data = await api(`/api/cards?path=${encodeURIComponent(sel.chapterPath)}&section_slug=${encodeURIComponent(sel.sectionSlug)}`);
      all.push(...(data.generated || []), ...(data.user_created || []));
    } catch (_) {}
  }
  startSprintMode(all);
}

function startSprintMode(cards) {
  const mc = cards.filter(c => c.type === 'multiple_choice' && Array.isArray(c.options) && c.options.length >= 2);
  if (mc.length < 3) {
    toast('Sprint needs multiple choice cards. Generate more first.', 'info');
    return;
  }

  const chosen = [...mc].sort(() => Math.random() - 0.5).slice(0, 10);
  Object.assign(SP, { originalCards: cards, cards: chosen, index: 0, correct: 0, xpEarned: 0, startTime: Date.now() });

  const overlay = document.getElementById('sprint-overlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <div class="sprint-wrap">
      <div class="sprint-topbar">
        <button class="game-quit" id="sprint-quit">✕</button>
        <div class="sprint-bar-wrap">
          <div class="sprint-bar" id="sprint-bar" style="width:0%"></div>
        </div>
        <div class="sprint-counter" id="sprint-counter">1 / ${chosen.length}</div>
      </div>
      <div class="sprint-card-area" id="sprint-card-area"></div>
    </div>`;

  document.getElementById('sprint-quit').addEventListener('click', () => {
    if (confirm('Quit Sprint?')) overlay.classList.add('hidden');
  });

  sprintShowCard();
}

function sprintShowCard() {
  if (SP.index >= SP.cards.length) { sprintEnd(); return; }

  const card = SP.cards[SP.index];
  const area   = document.getElementById('sprint-card-area');
  const counter = document.getElementById('sprint-counter');
  const bar     = document.getElementById('sprint-bar');

  if (counter) counter.textContent = `${SP.index + 1} / ${SP.cards.length}`;
  if (bar)     bar.style.width = `${(SP.index / SP.cards.length) * 100}%`;

  const opts = card.options.map((text, i) => ({ text, correct: i === card.correct_index }));
  const shuffled = [...opts].sort(() => Math.random() - 0.5);

  area.innerHTML = `
    <div class="sprint-card">
      <div class="sprint-q">${esc(card.front.replace(/\{blank\}/g, '___'))}</div>
      <div class="sprint-opts">
        ${shuffled.map((o, i) => `
          <button class="sprint-opt" data-correct="${o.correct}">
            <span class="sprint-letter">${'ABCD'[i]}</span>
            <span class="sprint-opt-text">${esc(o.text)}</span>
          </button>`).join('')}
      </div>
    </div>`;

  area.querySelectorAll('.sprint-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const correct = btn.dataset.correct === 'true';
      area.querySelectorAll('.sprint-opt').forEach(b => {
        b.disabled = true;
        if (b.dataset.correct === 'true') b.classList.add('sprint-correct');
        else if (b === btn && !correct) b.classList.add('sprint-wrong');
      });
      if (correct) { SP.correct++; SP.xpEarned += 15; }
      else SP.xpEarned += 3;
      SP.index++;
      setTimeout(sprintShowCard, correct ? 500 : 1100);
    });
  });
}

function sprintEnd() {
  const elapsed  = Math.round((Date.now() - SP.startTime) / 1000);
  const timeStr  = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const total    = SP.cards.length;
  const pctScore = Math.round((SP.correct / total) * 100);

  const gsResult = gsEarnXP(SP.xpEarned);
  renderGamBar();
  if (gsResult.leveledUp) setTimeout(() => showLevelUpToast(gsResult.newLevel), 600);
  const { pct, level } = gsLevelProgress();

  const overlay = document.getElementById('sprint-overlay');
  overlay.innerHTML = `
    <div class="game-end-wrap">
      <div class="sprint-end-score">${SP.correct}<span class="sprint-end-total">/${total}</span></div>
      <div class="sprint-end-pct" style="color:${pctScore >= 80 ? 'var(--success)' : pctScore >= 50 ? 'var(--warning)' : 'var(--error)'}">
        ${pctScore}% correct
      </div>
      <div class="game-end-stats">
        <div class="game-end-stat"><div class="game-end-num">${timeStr}</div><div class="game-end-label">Time</div></div>
        <div class="game-end-stat"><div class="game-end-num" style="color:var(--accent)">+${SP.xpEarned}</div><div class="game-end-label">XP</div></div>
      </div>
      <div class="blitz-end-xp-section">
        <div class="blitz-end-xp-label">Level ${level} progress</div>
        <div class="blitz-xp-bar-wrap"><div class="blitz-xp-bar" id="sprint-xp-bar" style="width:0%"></div></div>
      </div>
      ${gsResult.leveledUp ? `<div class="blitz-levelup-banner">⬆ Level Up! Now Level ${gsResult.newLevel}</div>` : ''}
      <div class="blitz-end-actions">
        <button class="btn btn-secondary" id="sprint-home">← Back</button>
        <button class="btn btn-sprint" id="sprint-again">🏃 Play Again</button>
      </div>
    </div>`;

  setTimeout(() => { const b = document.getElementById('sprint-xp-bar'); if (b) b.style.width = pct + '%'; }, 300);
  document.getElementById('sprint-home').addEventListener('click', () => overlay.classList.add('hidden'));
  document.getElementById('sprint-again').addEventListener('click', () => startSprintMode(SP.originalCards));
}

// ── Gravity Mode ───────────────────────────────────────────────────────
// Answers fall from the top — tap the right one before it exits.
const GV = {
  originalCards: [],
  cards: [],
  cardIndex: 0,
  lives: 3,
  score: 0,
  combo: 0,
  bestCombo: 0,
  timeLeft: 60,
  timerInterval: null,
  cardAnswered: false,
  activeFallers: [],
  xpEarned: 0,
};

async function startGravitySection() {
  if (!S.activeSection) return;
  const { chapterPath, sectionSlug } = S.activeSection;
  try {
    const data = await api(`/api/cards?path=${encodeURIComponent(chapterPath)}&section_slug=${encodeURIComponent(sectionSlug)}`);
    startGravityMode([...(data.generated || []), ...(data.user_created || [])]);
  } catch (e) { toast('Could not load cards: ' + e.message, 'error'); }
}

async function startGravityFromConfig() {
  const selections = getStudySelections();
  if (!selections.length) { toast('Select at least one section', 'error'); return; }
  document.getElementById('study-config-modal').classList.add('hidden');
  const all = [];
  for (const sel of selections) {
    try {
      const data = await api(`/api/cards?path=${encodeURIComponent(sel.chapterPath)}&section_slug=${encodeURIComponent(sel.sectionSlug)}`);
      all.push(...(data.generated || []), ...(data.user_created || []));
    } catch (_) {}
  }
  startGravityMode(all);
}

function startGravityMode(cards) {
  const mc = cards.filter(c => c.type === 'multiple_choice' && Array.isArray(c.options) && c.options.length >= 2);
  if (mc.length < 2) { toast('Gravity needs multiple choice cards. Generate more first.', 'info'); return; }

  Object.assign(GV, {
    originalCards: cards,
    cards: [...mc].sort(() => Math.random() - 0.5),
    cardIndex: 0, lives: 3, score: 0, combo: 0, bestCombo: 0,
    timeLeft: 60, cardAnswered: false, activeFallers: [], xpEarned: 0,
  });
  clearInterval(GV.timerInterval);

  const overlay = document.getElementById('gravity-overlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <div class="blitz-wrap">
      <div class="blitz-topbar">
        <div class="blitz-lives" id="gv-lives"></div>
        <div class="blitz-combo" id="gv-combo"></div>
        <div class="blitz-score-wrap">
          <div class="blitz-score" id="gv-score">0</div>
          <div class="blitz-score-label">pts</div>
        </div>
        <div class="blitz-timer" id="gv-timer">1:00</div>
        <button class="blitz-quit" id="gv-quit" title="Quit">✕</button>
      </div>
      <div class="blitz-question-wrap">
        <div class="blitz-question" id="gv-question"></div>
      </div>
      <div class="blitz-arena" id="gv-arena"></div>
    </div>`;

  document.getElementById('gv-quit').addEventListener('click', () => {
    if (confirm('Quit Gravity?')) gravityEnd(true);
  });

  gravityUpdateTopbar();

  // Countdown
  const qEl = document.getElementById('gv-question');
  qEl.classList.add('blitz-countdown');
  let n = 3;
  qEl.textContent = n;
  const iv = setInterval(() => {
    n--;
    if (n > 0) { qEl.textContent = n; }
    else {
      clearInterval(iv);
      qEl.textContent = 'GO!';
      qEl.style.color = 'var(--success)';
      setTimeout(() => {
        qEl.classList.remove('blitz-countdown');
        qEl.style.color = '';
        gravityStartTimer();
        gravityNextCard();
      }, 600);
    }
  }, 700);
}

function gravityStartTimer() {
  clearInterval(GV.timerInterval);
  GV.timerInterval = setInterval(() => {
    GV.timeLeft = Math.max(0, GV.timeLeft - 1);
    const el = document.getElementById('gv-timer');
    if (el) {
      const m = Math.floor(GV.timeLeft / 60), s = GV.timeLeft % 60;
      el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      el.className = 'blitz-timer' + (GV.timeLeft <= 10 ? ' urgent' : GV.timeLeft <= 20 ? ' warn' : '');
    }
    if (GV.timeLeft <= 0) gravityEnd(false);
  }, 1000);
}

function gravityUpdateTopbar() {
  const livesEl = document.getElementById('gv-lives');
  const comboEl = document.getElementById('gv-combo');
  const scoreEl = document.getElementById('gv-score');
  if (livesEl) livesEl.innerHTML = [0,1,2].map(i => `<span class="blitz-heart${i >= GV.lives ? ' lost' : ''}">${i < GV.lives ? '❤️' : '🖤'}</span>`).join('');
  if (comboEl) {
    if (GV.combo >= 3) {
      const mult = GV.combo >= 10 ? '×3' : GV.combo >= 5 ? '×2' : '×1.5';
      comboEl.innerHTML = `<span class="blitz-combo-pill">${GV.combo} ${mult}</span>`;
    } else if (GV.combo >= 1) {
      comboEl.innerHTML = `<span class="blitz-combo-pill dim">${GV.combo}</span>`;
    } else comboEl.innerHTML = '';
  }
  if (scoreEl) scoreEl.textContent = GV.score.toLocaleString();
}

function gravityNextCard() {
  if (GV.timeLeft <= 0) return;
  if (GV.cardIndex >= GV.cards.length) GV.cardIndex = 0;
  const card = GV.cards[GV.cardIndex++];
  GV.cardAnswered = false;

  const arena = document.getElementById('gv-arena');
  if (arena) arena.innerHTML = '';
  GV.activeFallers = [];

  const qEl = document.getElementById('gv-question');
  if (qEl) qEl.textContent = card.front.replace(/\{blank\}/g, '___');

  // Speed: 6000ms → 3500ms as time runs out
  const elapsed = 60 - GV.timeLeft;
  const speed = Math.max(3500, 6000 - elapsed * 42);

  const options = card.options.map((text, i) => ({ text, isCorrect: i === card.correct_index }));
  const shuffled = [...options].sort(() => Math.random() - 0.5);

  shuffled.forEach((opt, i) => {
    setTimeout(() => {
      if (GV.cardAnswered || GV.timeLeft <= 0) return;
      gravitySpawnFaller(opt.text, opt.isCorrect, speed);
    }, i * 500);
  });
}

function gravitySpawnFaller(text, isCorrect, duration) {
  const arena = document.getElementById('gv-arena');
  if (!arena || GV.cardAnswered) return;

  const el = document.createElement('button');
  el.className = 'gravity-faller';
  el.textContent = text;
  arena.appendChild(el);

  const arenaW = arena.offsetWidth || 360;
  const arenaH = arena.offsetHeight || 300;
  const fW = Math.min(170, arenaW * 0.42);

  const startX = fW / 2 + Math.random() * (arenaW - fW - 20);
  const startY = -(fW * 0.6 + 10);
  const endY = arenaH + 20;

  el.style.width = fW + 'px';
  el.style.left = startX + 'px';
  el.style.top = startY + 'px';

  const faller = { el, isCorrect, done: false };
  GV.activeFallers.push(faller);
  const startTime = performance.now();

  function tick(now) {
    if (faller.done) return;
    const t = Math.min((now - startTime) / duration, 1);
    const y = startY + (endY - startY) * t;
    const wobble = Math.sin(t * Math.PI * 3) * 6;
    el.style.top = y + 'px';
    el.style.left = (startX + wobble) + 'px';
    if (t < 1) { requestAnimationFrame(tick); }
    else {
      faller.done = true;
      el.remove();
      if (isCorrect && !GV.cardAnswered) gravityMiss();
    }
  }
  requestAnimationFrame(tick);

  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (faller.done || GV.cardAnswered) return;
    faller.done = true;
    if (isCorrect) gravityCorrect(el);
    else gravityWrong(el);
  });
}

function gravityCorrect(el) {
  GV.cardAnswered = true;
  GV.combo++;
  if (GV.combo > GV.bestCombo) GV.bestCombo = GV.combo;
  const mult = GV.combo >= 10 ? 3 : GV.combo >= 5 ? 2 : GV.combo >= 3 ? 1.5 : 1;
  const pts = Math.round(100 * mult);
  GV.score += pts;
  GV.xpEarned += Math.round(20 * mult);
  el.classList.add('blitz-bubble-correct');

  const arena = document.getElementById('gv-arena');
  if (arena) {
    const pop = document.createElement('div');
    pop.className = 'blitz-score-pop';
    pop.textContent = `+${pts}`;
    const r1 = el.getBoundingClientRect(), r2 = arena.getBoundingClientRect();
    pop.style.left = (r1.left - r2.left + r1.width / 2) + 'px';
    pop.style.top  = (r1.top  - r2.top) + 'px';
    arena.appendChild(pop);
    setTimeout(() => pop.remove(), 900);
  }
  gravityUpdateTopbar();
  setTimeout(() => {
    GV.activeFallers.forEach(f => { f.done = true; f.el?.remove(); });
    GV.activeFallers = [];
    gravityNextCard();
  }, 400);
}

function gravityWrong(el) {
  GV.combo = 0;
  GV.lives--;
  el.classList.add('blitz-bubble-wrong');
  const overlay = document.getElementById('gravity-overlay');
  overlay.classList.add('blitz-flash-red');
  setTimeout(() => overlay.classList.remove('blitz-flash-red'), 400);
  gravityUpdateTopbar();
  if (GV.lives <= 0) { setTimeout(() => gravityEnd(false), 700); return; }
  setTimeout(() => { if (el.parentNode) el.remove(); }, 350);
}

function gravityMiss() {
  GV.combo = 0;
  GV.lives--;
  const arena = document.getElementById('gv-arena');
  if (arena) {
    const pop = document.createElement('div');
    pop.className = 'blitz-miss-pop';
    pop.textContent = 'Missed!';
    arena.appendChild(pop);
    setTimeout(() => pop.remove(), 800);
  }
  const overlay = document.getElementById('gravity-overlay');
  overlay.classList.add('blitz-flash-red');
  setTimeout(() => overlay.classList.remove('blitz-flash-red'), 400);
  gravityUpdateTopbar();
  if (GV.lives <= 0) { setTimeout(() => gravityEnd(false), 700); return; }
  GV.activeFallers.forEach(f => { f.done = true; f.el?.remove(); });
  GV.activeFallers = [];
  GV.cardAnswered = true;
  setTimeout(gravityNextCard, 650);
}

function gravityEnd(quit) {
  clearInterval(GV.timerInterval);
  GV.activeFallers.forEach(f => { f.done = true; f.el?.remove(); });
  const overlay = document.getElementById('gravity-overlay');
  if (quit) { overlay.classList.add('hidden'); return; }

  const gsResult = gsEarnXP(GV.xpEarned);
  renderGamBar();
  if (gsResult.leveledUp) setTimeout(() => showLevelUpToast(gsResult.newLevel), 600);
  const { pct } = gsLevelProgress();

  overlay.innerHTML = `
    <div class="blitz-end-wrap">
      <div class="blitz-end-badge">GRAVITY COMPLETE</div>
      <div class="blitz-end-score">${GV.score.toLocaleString()}</div>
      <div class="blitz-end-pts-label">points</div>
      <div class="blitz-end-stats">
        <div class="blitz-end-stat"><div class="blitz-end-stat-num">${GV.bestCombo}</div><div class="blitz-end-stat-label">Best Combo</div></div>
        <div class="blitz-end-stat"><div class="blitz-end-stat-num" style="color:var(--accent)">+${GV.xpEarned}</div><div class="blitz-end-stat-label">XP Earned</div></div>
      </div>
      <div class="blitz-end-xp-section">
        <div class="blitz-end-xp-label">Level ${gsLevelProgress().level} progress</div>
        <div class="blitz-xp-bar-wrap"><div class="blitz-xp-bar" id="gv-xp-bar" style="width:0%"></div></div>
      </div>
      ${gsResult.leveledUp ? `<div class="blitz-levelup-banner">⬆ Level Up! Now Level ${gsResult.newLevel}</div>` : ''}
      <div class="blitz-end-actions">
        <button class="btn btn-secondary" id="gv-home">← Back</button>
        <button class="btn btn-gravity" id="gv-again">⬇ Play Again</button>
      </div>
    </div>`;

  setTimeout(() => { const b = document.getElementById('gv-xp-bar'); if (b) b.style.width = pct + '%'; }, 300);
  document.getElementById('gv-home').addEventListener('click', () => overlay.classList.add('hidden'));
  document.getElementById('gv-again').addEventListener('click', () => startGravityMode(GV.originalCards));
}

// ── Type It Mode ───────────────────────────────────────────────────────
// Type the answer before the timer runs out. Works with all card types.
const TY = {
  originalCards: [],
  cards: [],
  index: 0,
  correct: 0,
  xpEarned: 0,
  startTime: 0,
  timerInterval: null,
  timePerQ: 14,
};

async function startTypeItSection() {
  if (!S.activeSection) return;
  const { chapterPath, sectionSlug } = S.activeSection;
  try {
    const data = await api(`/api/cards?path=${encodeURIComponent(chapterPath)}&section_slug=${encodeURIComponent(sectionSlug)}`);
    startTypeItMode([...(data.generated || []), ...(data.user_created || [])]);
  } catch (e) { toast('Could not load cards: ' + e.message, 'error'); }
}

async function startTypeItFromConfig() {
  const selections = getStudySelections();
  if (!selections.length) { toast('Select at least one section', 'error'); return; }
  document.getElementById('study-config-modal').classList.add('hidden');
  const all = [];
  for (const sel of selections) {
    try {
      const data = await api(`/api/cards?path=${encodeURIComponent(sel.chapterPath)}&section_slug=${encodeURIComponent(sel.sectionSlug)}`);
      all.push(...(data.generated || []), ...(data.user_created || []));
    } catch (_) {}
  }
  startTypeItMode(all);
}

function startTypeItMode(cards) {
  const usable = cards.filter(c => {
    const ans = c.type === 'multiple_choice' ? (c.options || [])[c.correct_index] : c.back;
    return c.front && ans;
  });
  if (usable.length < 3) { toast('Type It needs at least 3 cards. Generate more first.', 'info'); return; }

  const chosen = [...usable].sort(() => Math.random() - 0.5).slice(0, 10);
  Object.assign(TY, { originalCards: cards, cards: chosen, index: 0, correct: 0, xpEarned: 0, startTime: Date.now() });
  clearInterval(TY.timerInterval);

  const overlay = document.getElementById('typeit-overlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <div class="sprint-wrap">
      <div class="sprint-topbar">
        <button class="game-quit" id="ty-quit">✕</button>
        <div class="sprint-bar-wrap"><div class="sprint-bar" id="ty-bar" style="width:0%"></div></div>
        <div class="sprint-counter" id="ty-counter">1 / ${chosen.length}</div>
      </div>
      <div class="sprint-card-area" id="ty-card-area"></div>
    </div>`;

  document.getElementById('ty-quit').addEventListener('click', () => {
    clearInterval(TY.timerInterval);
    if (confirm('Quit Type It?')) overlay.classList.add('hidden');
  });

  typeItShowQuestion();
}

function typeItShowQuestion() {
  if (TY.index >= TY.cards.length) { typeItEnd(); return; }
  clearInterval(TY.timerInterval);

  const card = TY.cards[TY.index];
  const answer = card.type === 'multiple_choice'
    ? (card.options || [])[card.correct_index]
    : card.back;

  const counter = document.getElementById('ty-counter');
  const topBar  = document.getElementById('ty-bar');
  if (counter) counter.textContent = `${TY.index + 1} / ${TY.cards.length}`;
  if (topBar)  topBar.style.width = `${(TY.index / TY.cards.length) * 100}%`;

  const area = document.getElementById('ty-card-area');
  area.innerHTML = `
    <div class="typeit-card">
      <div class="typeit-q">${esc(card.front.replace(/\{blank\}/g, '_____'))}</div>
      <div class="typeit-timer-wrap">
        <div class="typeit-timer-bar" id="ty-qbar" style="width:100%"></div>
      </div>
      <div class="typeit-input-row">
        <input class="typeit-input" id="ty-input" placeholder="Type your answer…" autocomplete="off" autocorrect="off" spellcheck="false">
        <button class="btn-hint ty-hint" id="ty-hint">Hint</button>
      </div>
      <button class="btn btn-ghost btn-sm ty-skip" id="ty-skip">Skip →</button>
    </div>`;

  const input = document.getElementById('ty-input');
  input.focus();

  let timeLeft = TY.timePerQ;
  const qBar = document.getElementById('ty-qbar');
  TY.timerInterval = setInterval(() => {
    timeLeft--;
    if (qBar) qBar.style.width = `${(timeLeft / TY.timePerQ) * 100}%`;
    if (qBar) qBar.style.background = timeLeft <= 4 ? 'var(--error)' : timeLeft <= 7 ? 'var(--warning)' : 'var(--accent)';
    if (timeLeft <= 0) { clearInterval(TY.timerInterval); typeItReveal(false, answer); }
  }, 1000);

  const submit = () => {
    clearInterval(TY.timerInterval);
    const typed = input.value.trim().toLowerCase();
    const expected = answer.trim().toLowerCase();
    typeItReveal(typed === expected, answer);
  };

  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  document.getElementById('ty-skip').addEventListener('click', () => {
    clearInterval(TY.timerInterval);
    typeItReveal(false, answer);
  });
  document.getElementById('ty-hint').addEventListener('click', () => {
    const hint = answer.split('').map((c, i) => i === 0 ? c.toUpperCase() : c === ' ' ? ' ' : '_').join('');
    input.placeholder = `Hint: ${hint}`;
    document.getElementById('ty-hint').disabled = true;
  });
}

function typeItReveal(correct, answer) {
  const input = document.getElementById('ty-input');
  if (input) input.disabled = true;

  const card = document.querySelector('.typeit-card');
  if (card) {
    const res = document.createElement('div');
    res.className = `typeit-result ${correct ? 'ty-correct' : 'ty-wrong'}`;
    res.innerHTML = correct
      ? `✓ Correct!`
      : `✗ Answer: <strong>${esc(answer)}</strong>`;
    card.appendChild(res);
  }

  if (correct) { TY.correct++; TY.xpEarned += 15; }
  else TY.xpEarned += 2;
  TY.index++;
  setTimeout(typeItShowQuestion, correct ? 700 : 1500);
}

function typeItEnd() {
  const total = TY.cards.length;
  const pctScore = Math.round((TY.correct / total) * 100);
  const elapsed = Math.round((Date.now() - TY.startTime) / 1000);
  const timeStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  const gsResult = gsEarnXP(TY.xpEarned);
  renderGamBar();
  if (gsResult.leveledUp) setTimeout(() => showLevelUpToast(gsResult.newLevel), 600);
  const { pct, level } = gsLevelProgress();

  const overlay = document.getElementById('typeit-overlay');
  overlay.innerHTML = `
    <div class="game-end-wrap">
      <div class="sprint-end-score">${TY.correct}<span class="sprint-end-total">/${total}</span></div>
      <div class="sprint-end-pct" style="color:${pctScore >= 80 ? 'var(--success)' : pctScore >= 50 ? 'var(--warning)' : 'var(--error)'}">
        ${pctScore}% typed correctly
      </div>
      <div class="game-end-stats">
        <div class="game-end-stat"><div class="game-end-num">${timeStr}</div><div class="game-end-label">Time</div></div>
        <div class="game-end-stat"><div class="game-end-num" style="color:var(--accent)">+${TY.xpEarned}</div><div class="game-end-label">XP</div></div>
      </div>
      <div class="blitz-end-xp-section">
        <div class="blitz-end-xp-label">Level ${level} progress</div>
        <div class="blitz-xp-bar-wrap"><div class="blitz-xp-bar" id="ty-xp-bar" style="width:0%"></div></div>
      </div>
      ${gsResult.leveledUp ? `<div class="blitz-levelup-banner">⬆ Level Up! Now Level ${gsResult.newLevel}</div>` : ''}
      <div class="blitz-end-actions">
        <button class="btn btn-secondary" id="ty-home">← Back</button>
        <button class="btn btn-typeit" id="ty-again">⌨ Play Again</button>
      </div>
    </div>`;

  setTimeout(() => { const b = document.getElementById('ty-xp-bar'); if (b) b.style.width = pct + '%'; }, 300);
  document.getElementById('ty-home').addEventListener('click', () => overlay.classList.add('hidden'));
  document.getElementById('ty-again').addEventListener('click', () => startTypeItMode(TY.originalCards));
}

// ── Sudden Death Mode ──────────────────────────────────────────────────
// One wrong answer ends the game. How far can you go?
const SD = {
  originalCards: [],
  cards: [],
  index: 0,
  streak: 0,
  xpEarned: 0,
};

function sdHighScore() { return parseInt(localStorage.getItem('flashcard_sd_hs') || '0'); }
function sdSaveHS(n) { if (n > sdHighScore()) localStorage.setItem('flashcard_sd_hs', n); }

async function startSuddenDeathSection() {
  if (!S.activeSection) return;
  const { chapterPath, sectionSlug } = S.activeSection;
  try {
    const data = await api(`/api/cards?path=${encodeURIComponent(chapterPath)}&section_slug=${encodeURIComponent(sectionSlug)}`);
    startSuddenDeathMode([...(data.generated || []), ...(data.user_created || [])]);
  } catch (e) { toast('Could not load cards: ' + e.message, 'error'); }
}

async function startSuddenDeathFromConfig() {
  const selections = getStudySelections();
  if (!selections.length) { toast('Select at least one section', 'error'); return; }
  document.getElementById('study-config-modal').classList.add('hidden');
  const all = [];
  for (const sel of selections) {
    try {
      const data = await api(`/api/cards?path=${encodeURIComponent(sel.chapterPath)}&section_slug=${encodeURIComponent(sel.sectionSlug)}`);
      all.push(...(data.generated || []), ...(data.user_created || []));
    } catch (_) {}
  }
  startSuddenDeathMode(all);
}

function startSuddenDeathMode(cards) {
  const mc = cards.filter(c => c.type === 'multiple_choice' && Array.isArray(c.options) && c.options.length >= 2);
  if (mc.length < 2) { toast('Sudden Death needs multiple choice cards. Generate more first.', 'info'); return; }

  Object.assign(SD, {
    originalCards: cards,
    cards: [...mc].sort(() => Math.random() - 0.5),
    index: 0, streak: 0, xpEarned: 0,
  });

  const overlay = document.getElementById('sudden-overlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <div class="sprint-wrap">
      <div class="sprint-topbar">
        <button class="game-quit" id="sd-quit">✕</button>
        <div class="sd-label">Sudden Death</div>
        <div class="sd-streak" id="sd-streak">0 <span style="font-weight:400;font-size:.75rem;color:var(--text3)">streak</span></div>
      </div>
      <div class="sprint-card-area" id="sd-card-area"></div>
    </div>`;

  document.getElementById('sd-quit').addEventListener('click', () => {
    if (confirm('Quit Sudden Death?')) overlay.classList.add('hidden');
  });

  sdShowCard();
}

function sdShowCard() {
  if (SD.index >= SD.cards.length) SD.index = 0; // cycle cards
  const card = SD.cards[SD.index++];

  const streakEl = document.getElementById('sd-streak');
  if (streakEl) streakEl.innerHTML = `${SD.streak} <span style="font-weight:400;font-size:.75rem;color:var(--text3)">streak</span>`;

  const area = document.getElementById('sd-card-area');
  const opts = card.options.map((text, i) => ({ text, correct: i === card.correct_index }));
  const shuffled = [...opts].sort(() => Math.random() - 0.5);

  area.innerHTML = `
    <div class="sprint-card sd-card">
      <div class="sd-hs">Best: ${sdHighScore()}</div>
      <div class="sprint-q">${esc(card.front.replace(/\{blank\}/g, '___'))}</div>
      <div class="sprint-opts">
        ${shuffled.map((o, i) => `
          <button class="sprint-opt" data-correct="${o.correct}">
            <span class="sprint-letter">${'ABCD'[i]}</span>
            <span class="sprint-opt-text">${esc(o.text)}</span>
          </button>`).join('')}
      </div>
    </div>`;

  area.querySelectorAll('.sprint-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const correct = btn.dataset.correct === 'true';
      area.querySelectorAll('.sprint-opt').forEach(b => {
        b.disabled = true;
        if (b.dataset.correct === 'true') b.classList.add('sprint-correct');
        else if (b === btn && !correct) b.classList.add('sprint-wrong');
      });

      if (correct) {
        SD.streak++;
        SD.xpEarned += 10;
        setTimeout(sdShowCard, 480);
      } else {
        sdGameOver();
      }
    });
  });
}

function sdGameOver() {
  sdSaveHS(SD.streak);
  const isRecord = SD.streak > 0 && SD.streak >= sdHighScore();
  const gsResult = gsEarnXP(SD.xpEarned);
  renderGamBar();
  if (gsResult.leveledUp) setTimeout(() => showLevelUpToast(gsResult.newLevel), 600);
  const { pct, level } = gsLevelProgress();

  const overlay = document.getElementById('sudden-overlay');

  // Brief flash before end screen
  overlay.classList.add('blitz-flash-red');
  setTimeout(() => overlay.classList.remove('blitz-flash-red'), 400);

  setTimeout(() => {
    overlay.innerHTML = `
      <div class="game-end-wrap">
        <div class="sd-end-title">GAME OVER</div>
        <div class="sd-end-streak">${SD.streak}</div>
        <div class="sd-end-label">correct in a row</div>
        ${isRecord ? '<div class="sd-record">🏆 New Record!</div>' : `<div class="sd-best">Best: ${sdHighScore()}</div>`}
        <div class="game-end-stats" style="margin-top:.5rem">
          <div class="game-end-stat"><div class="game-end-num" style="color:var(--accent)">+${SD.xpEarned}</div><div class="game-end-label">XP</div></div>
        </div>
        <div class="blitz-end-xp-section">
          <div class="blitz-end-xp-label">Level ${level} progress</div>
          <div class="blitz-xp-bar-wrap"><div class="blitz-xp-bar" id="sd-xp-bar" style="width:0%"></div></div>
        </div>
        ${gsResult.leveledUp ? `<div class="blitz-levelup-banner">⬆ Level Up! Now Level ${gsResult.newLevel}</div>` : ''}
        <div class="blitz-end-actions">
          <button class="btn btn-secondary" id="sd-home">← Back</button>
          <button class="btn btn-sudden" id="sd-again">💀 Try Again</button>
        </div>
      </div>`;

    setTimeout(() => { const b = document.getElementById('sd-xp-bar'); if (b) b.style.width = pct + '%'; }, 300);
    document.getElementById('sd-home').addEventListener('click', () => overlay.classList.add('hidden'));
    document.getElementById('sd-again').addEventListener('click', () => startSuddenDeathMode(SD.originalCards));
  }, 500);
}
