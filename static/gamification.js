'use strict';

// ── Gamification state (localStorage-backed) ──────────────────────────
const GS = {
  xp: 0,
  streakDays: 0,
  lastStudyDate: null,
  dailyXP: 0,
  dailyGoal: 100,
};

// XP required at the START of each level (index = level - 1)
const GS_LEVELS = [
  0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200,
  4000, 5000, 6500, 8200, 10200, 12700, 15700, 19200, 23200, 28000,
];

function gsLoad() {
  try {
    Object.assign(GS, JSON.parse(localStorage.getItem('flashcard_gs') || '{}'));
  } catch (_) {}
}

function gsSave() {
  localStorage.setItem('flashcard_gs', JSON.stringify(GS));
}

function gsTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function gsCurrentLevel() {
  for (let i = GS_LEVELS.length - 1; i >= 0; i--) {
    if (GS.xp >= GS_LEVELS[i]) return i + 1;
  }
  return 1;
}

function gsLevelProgress() {
  const lvl = gsCurrentLevel();
  const start = GS_LEVELS[lvl - 1] ?? 0;
  const end = GS_LEVELS[lvl] ?? (start + 1000);
  return { level: lvl, pct: Math.min(((GS.xp - start) / (end - start)) * 100, 100) };
}

function gsEarnXP(amount) {
  if (amount <= 0) return { leveledUp: false, newLevel: gsCurrentLevel() };
  const today = gsTodayStr();
  const prevLevel = gsCurrentLevel();

  if (GS.lastStudyDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);
    GS.streakDays = GS.lastStudyDate === yStr ? GS.streakDays + 1 : 1;
    GS.lastStudyDate = today;
    GS.dailyXP = 0;
  }

  GS.xp += amount;
  GS.dailyXP += amount;
  gsSave();

  const newLevel = gsCurrentLevel();
  return { leveledUp: newLevel > prevLevel, newLevel };
}

function renderGamBar() {
  const bar = document.getElementById('gam-bar');
  if (!bar) return;

  const { level, pct } = gsLevelProgress();
  const dailyPct = Math.min((GS.dailyXP / GS.dailyGoal) * 100, 100);
  const goalDone = GS.dailyXP >= GS.dailyGoal;
  const streak = GS.streakDays;

  bar.innerHTML = `
    <div class="gam-top">
      <div class="gam-streak${streak > 0 ? ' lit' : ''}">
        <span class="gam-fire">${streak > 0 ? '🔥' : '💤'}</span>
        <strong>${streak}</strong>&nbsp;day streak
      </div>
      <div class="gam-lvl">
        <span class="gam-lvl-badge">Lv ${level}</span>
        <div class="gam-xp-track"><div class="gam-xp-fill" style="width:${pct}%"></div></div>
      </div>
    </div>
    <div class="gam-daily">
      <div class="gam-daily-track">
        <div class="gam-daily-fill${goalDone ? ' done' : ''}" style="width:${dailyPct}%"></div>
      </div>
      <span class="gam-daily-label${goalDone ? ' done' : ''}">
        ${goalDone ? '✓ Daily goal!' : `${GS.dailyXP} / ${GS.dailyGoal} XP today`}
      </span>
    </div>
  `;
}

function showLevelUpToast(newLevel) {
  const el = document.createElement('div');
  el.className = 'levelup-toast';
  el.innerHTML = `<span>⬆</span>&nbsp;Level Up — <strong>Level ${newLevel}</strong>!`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 500); }, 3000);
}
