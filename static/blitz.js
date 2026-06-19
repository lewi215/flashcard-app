'use strict';

// ── Blitz Mode ────────────────────────────────────────────────────────
const B = {
  cards: [],
  cardIndex: 0,
  lives: 5,
  score: 0,
  combo: 0,
  bestCombo: 0,
  timeLeft: 60,
  timerInterval: null,
  cardAnswered: false,
  activeBubbles: [],
  xpEarned: 0,
};

async function startBlitzSection() {
  if (!S.activeSection) return;
  const { chapterPath, sectionSlug } = S.activeSection;
  try {
    const data = await api(`/api/cards?path=${encodeURIComponent(chapterPath)}&section_slug=${encodeURIComponent(sectionSlug)}`);
    const all = [...(data.generated || []), ...(data.user_created || [])];
    startBlitzMode(all);
  } catch (e) {
    toast('Could not load cards: ' + e.message, 'error');
  }
}

async function startBlitzFromConfig() {
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
  startBlitzMode(all);
}

function startBlitzMode(cards) {
  const mcCards = cards.filter(c => c.type === 'multiple_choice' && Array.isArray(c.options) && c.options.length >= 2);
  if (mcCards.length < 2) {
    toast('Blitz Mode needs multiple choice cards. Generate more cards or pick a larger section.', 'info');
    return;
  }

  Object.assign(B, {
    cards: [...mcCards].sort(() => Math.random() - 0.5),
    cardIndex: 0,
    lives: 5,
    score: 0,
    combo: 0,
    bestCombo: 0,
    timeLeft: 60,
    cardAnswered: false,
    activeBubbles: [],
    xpEarned: 0,
  });
  clearInterval(B.timerInterval);

  const overlay = document.getElementById('blitz-overlay');
  overlay.classList.remove('hidden');
  overlay.innerHTML = `
    <div class="blitz-wrap">
      <div class="blitz-topbar">
        <div class="blitz-lives" id="blitz-lives"></div>
        <div class="blitz-combo" id="blitz-combo"></div>
        <div class="blitz-score-wrap">
          <div class="blitz-score" id="blitz-score">0</div>
          <div class="blitz-score-label">pts</div>
        </div>
        <div class="blitz-timer" id="blitz-timer">1:00</div>
        <button class="blitz-quit" id="blitz-quit" title="Quit">✕</button>
      </div>
      <div class="blitz-question-wrap">
        <div class="blitz-question" id="blitz-question"></div>
      </div>
      <div class="blitz-arena" id="blitz-arena"></div>
    </div>`;

  document.getElementById('blitz-quit').addEventListener('click', () => {
    if (confirm('Quit Blitz Mode?')) blitzEnd(true);
  });

  blitzUpdateTopbar();
  blitzCountdown();
}

function blitzCountdown() {
  const qEl = document.getElementById('blitz-question');
  qEl.classList.add('blitz-countdown');
  let n = 3;
  qEl.textContent = n;
  const iv = setInterval(() => {
    n--;
    if (n > 0) {
      qEl.textContent = n;
    } else {
      clearInterval(iv);
      qEl.textContent = 'GO!';
      qEl.style.color = 'var(--success)';
      setTimeout(() => {
        qEl.classList.remove('blitz-countdown');
        qEl.style.color = '';
        blitzStartTimer();
        blitzNextCard();
      }, 600);
    }
  }, 700);
}

function blitzStartTimer() {
  clearInterval(B.timerInterval);
  B.timerInterval = setInterval(() => {
    B.timeLeft = Math.max(0, B.timeLeft - 1);
    const el = document.getElementById('blitz-timer');
    if (el) {
      const m = Math.floor(B.timeLeft / 60);
      const s = B.timeLeft % 60;
      el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
      el.className = 'blitz-timer' + (B.timeLeft <= 10 ? ' urgent' : B.timeLeft <= 20 ? ' warn' : '');
    }
    if (B.timeLeft <= 0) blitzEnd(false);
  }, 1000);
}

function blitzUpdateTopbar() {
  const livesEl = document.getElementById('blitz-lives');
  const comboEl = document.getElementById('blitz-combo');
  const scoreEl = document.getElementById('blitz-score');

  if (livesEl) {
    livesEl.innerHTML = [0, 1, 2, 3, 4].map(i =>
      `<span class="blitz-heart${i >= B.lives ? ' lost' : ''}">${i < B.lives ? '❤️' : '🖤'}</span>`
    ).join('');
  }

  if (comboEl) {
    if (B.combo >= 3) {
      const mult = B.combo >= 10 ? '×3' : B.combo >= 5 ? '×2' : '×1.5';
      comboEl.innerHTML = `<span class="blitz-combo-pill">${B.combo} ${mult}</span>`;
    } else if (B.combo >= 1) {
      comboEl.innerHTML = `<span class="blitz-combo-pill dim">${B.combo}</span>`;
    } else {
      comboEl.innerHTML = '';
    }
  }

  if (scoreEl) scoreEl.textContent = B.score.toLocaleString();
}

function blitzNextCard() {
  if (B.timeLeft <= 0) return;
  if (B.cardIndex >= B.cards.length) B.cardIndex = 0;

  const card = B.cards[B.cardIndex++];
  B.cardAnswered = false;

  const arena = document.getElementById('blitz-arena');
  if (arena) arena.innerHTML = '';
  B.activeBubbles = [];

  const qEl = document.getElementById('blitz-question');
  if (qEl) {
    const qText = card.front.replace(/\{blank\}/g, '___');
    qEl.textContent = qText;
    qEl.style.fontSize = gameFontSize(qText);
  }

  // Speed: 7000ms → 3500ms as time runs out; longer answers get more time
  const elapsed = 60 - B.timeLeft;
  const baseSpeed = Math.max(3500, 7000 - elapsed * 58);

  const options = card.options.map((text, i) => ({ text, isCorrect: i === card.correct_index }));
  const shuffled = [...options].sort(() => Math.random() - 0.5);

  shuffled.forEach((opt, i) => {
    setTimeout(() => {
      if (B.cardAnswered || B.timeLeft <= 0) return;
      const n = opt.text.length;
      const mult = n > 80 ? 2.0 : n > 50 ? 1.6 : n > 28 ? 1.25 : 1.0;
      blitzSpawnBubble(opt.text, opt.isCorrect, Math.round(baseSpeed * mult));
    }, i * 420);
  });
}

function blitzSpawnBubble(text, isCorrect, duration) {
  const arena = document.getElementById('blitz-arena');
  if (!arena || B.cardAnswered) return;

  const el = document.createElement('button');
  el.className = 'blitz-bubble';
  el.textContent = text;
  el.style.fontSize = gameFontSize(text);
  el.setAttribute('aria-label', text);
  arena.appendChild(el);

  const arenaW = arena.offsetWidth || 400;
  const arenaH = arena.offsetHeight || 300;
  const bW = Math.min(280, arenaW * 0.65);

  const goRight = Math.random() > 0.5;
  const startX = goRight ? -(bW + 10) : arenaW + 10;
  const endX = goRight ? arenaW + 10 : -(bW + 10);
  const startY = arenaH * (0.08 + Math.random() * 0.72);
  const endY = arenaH * (0.08 + Math.random() * 0.72);
  const arcPeak = -(50 + Math.random() * 90);

  const bubble = { el, isCorrect, done: false };
  B.activeBubbles.push(bubble);

  el.style.width = bW + 'px';
  el.style.left = startX + 'px';
  el.style.top = startY + 'px';

  const startTime = performance.now();

  function tick(now) {
    if (bubble.done) return;
    const t = Math.min((now - startTime) / duration, 1);
    const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease in-out
    const x = startX + (endX - startX) * eased;
    const arcY = arcPeak * 4 * eased * (1 - eased);
    const y = startY + (endY - startY) * eased + arcY;
    el.style.left = x + 'px';
    el.style.top = y + 'px';

    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      bubble.done = true;
      el.remove();
      if (isCorrect && !B.cardAnswered) blitzMiss();
    }
  }

  requestAnimationFrame(tick);

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (bubble.done || B.cardAnswered) return;
    bubble.done = true;
    if (isCorrect) blitzCorrect(el);
    else blitzWrong(el);
  });
}

function blitzCorrect(el) {
  B.cardAnswered = true;
  B.combo++;
  if (B.combo > B.bestCombo) B.bestCombo = B.combo;

  const mult = B.combo >= 10 ? 3 : B.combo >= 5 ? 2 : B.combo >= 3 ? 1.5 : 1;
  const pts = Math.round(100 * mult);
  B.score += pts;
  B.xpEarned += Math.round(20 * mult);

  el.classList.add('blitz-bubble-correct');

  // Score pop
  const arena = document.getElementById('blitz-arena');
  if (arena) {
    const pop = document.createElement('div');
    pop.className = 'blitz-score-pop';
    pop.textContent = `+${pts}`;
    const elRect = el.getBoundingClientRect();
    const arenaRect = arena.getBoundingClientRect();
    pop.style.left = (elRect.left - arenaRect.left + elRect.width / 2) + 'px';
    pop.style.top = (elRect.top - arenaRect.top) + 'px';
    arena.appendChild(pop);
    setTimeout(() => pop.remove(), 900);
  }

  blitzUpdateTopbar();

  // Kill remaining bubbles and advance
  setTimeout(() => {
    B.activeBubbles.forEach(b => { b.done = true; b.el?.remove(); });
    B.activeBubbles = [];
    blitzNextCard();
  }, 450);
}

function blitzWrong(el) {
  B.combo = 0;
  B.lives--;
  el.classList.add('blitz-bubble-wrong');

  const overlay = document.getElementById('blitz-overlay');
  overlay.classList.add('blitz-flash-red');
  setTimeout(() => overlay.classList.remove('blitz-flash-red'), 400);

  blitzUpdateTopbar();

  if (B.lives <= 0) {
    setTimeout(() => blitzEnd(false), 700);
    return;
  }
  setTimeout(() => { if (el.parentNode) el.remove(); }, 350);
}

function blitzMiss() {
  B.combo = 0;
  B.lives--;

  const arena = document.getElementById('blitz-arena');
  if (arena) {
    const pop = document.createElement('div');
    pop.className = 'blitz-miss-pop';
    pop.textContent = 'Missed!';
    arena.appendChild(pop);
    setTimeout(() => pop.remove(), 800);
  }

  const overlay = document.getElementById('blitz-overlay');
  overlay.classList.add('blitz-flash-red');
  setTimeout(() => overlay.classList.remove('blitz-flash-red'), 400);

  blitzUpdateTopbar();

  if (B.lives <= 0) {
    setTimeout(() => blitzEnd(false), 700);
    return;
  }

  B.activeBubbles.forEach(b => { b.done = true; b.el?.remove(); });
  B.activeBubbles = [];
  B.cardAnswered = true;
  setTimeout(blitzNextCard, 650);
}

function blitzEnd(quit) {
  clearInterval(B.timerInterval);
  B.activeBubbles.forEach(b => { b.done = true; b.el?.remove(); });

  const overlay = document.getElementById('blitz-overlay');

  if (quit) {
    overlay.classList.add('hidden');
    return;
  }

  const gsResult = gsEarnXP(B.xpEarned);
  renderGamBar();
  if (gsResult.leveledUp) setTimeout(() => showLevelUpToast(gsResult.newLevel), 600);

  const { pct } = gsLevelProgress();

  overlay.innerHTML = `
    <div class="blitz-end-wrap">
      <div class="blitz-end-badge">BLITZ COMPLETE</div>
      <div class="blitz-end-score">${B.score.toLocaleString()}</div>
      <div class="blitz-end-pts-label">points</div>
      <div class="blitz-end-stats">
        <div class="blitz-end-stat">
          <div class="blitz-end-stat-num">${B.bestCombo}</div>
          <div class="blitz-end-stat-label">Best Combo</div>
        </div>
        <div class="blitz-end-stat">
          <div class="blitz-end-stat-num" style="color:var(--accent)">+${B.xpEarned}</div>
          <div class="blitz-end-stat-label">XP Earned</div>
        </div>
      </div>
      <div class="blitz-end-xp-section">
        <div class="blitz-end-xp-label">Level ${gsLevelProgress().level} progress</div>
        <div class="blitz-xp-bar-wrap">
          <div class="blitz-xp-bar" id="blitz-end-xp-bar" style="width:0%"></div>
        </div>
      </div>
      ${gsResult.leveledUp ? `<div class="blitz-levelup-banner">⬆ Level Up! Now Level ${gsResult.newLevel}</div>` : ''}
      <div class="blitz-end-actions">
        <button class="btn btn-secondary" id="blitz-end-home">← Back</button>
        <button class="btn btn-blitz" id="blitz-end-again">⚡ Play Again</button>
      </div>
    </div>`;

  setTimeout(() => {
    const bar = document.getElementById('blitz-end-xp-bar');
    if (bar) bar.style.width = pct + '%';
  }, 300);

  document.getElementById('blitz-end-home').addEventListener('click', () => {
    overlay.classList.add('hidden');
  });
  document.getElementById('blitz-end-again').addEventListener('click', () => {
    startBlitzMode(B.cards);
  });
}
