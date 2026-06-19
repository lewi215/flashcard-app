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
