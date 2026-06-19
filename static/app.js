'use strict';

// ── State ────────────────────────────────────────────────────────────
const S = {
  vault: [],
  expandedTopics: new Set(),
  expandedChapters: new Set(),
  activeSection: null,   // {topicSlug, chapterPath, heading, sectionSlug}
  currentCards: null,    // {generated, user_created}
  config: null,
  session: null,         // StudySession instance
  studyConfig: null,     // pending study config
};

// ── API ──────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Toast ─────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ── Theme ─────────────────────────────────────────────────────────────
function loadTheme() {
  const t = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
  const toggle = document.getElementById('theme-toggle');
  if (toggle) toggle.checked = t === 'dark';
}

function setTheme(dark) {
  const t = dark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  // Update manifest theme-color
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#1e1e1e' : '#4f6ef7');
}

// ── Vault sidebar ─────────────────────────────────────────────────────
async function loadVault() {
  const tree = document.getElementById('vault-tree');
  tree.innerHTML = '<div class="tree-loading">Loading vault…</div>';
  try {
    S.vault = await api('/api/vault');
    renderVaultTree();
  } catch (e) {
    tree.innerHTML = `<div class="tree-empty">⚠ ${e.message}<br><small>Check vault path in Settings.</small></div>`;
  }
}

function renderVaultTree() {
  const tree = document.getElementById('vault-tree');
  if (!S.vault.length) {
    tree.innerHTML = '<div class="tree-empty">No topics found in vault.</div>';
    return;
  }
  tree.innerHTML = '';
  for (const item of S.vault) {
    tree.appendChild(buildNode(item));
  }
}

function buildNode(node) {
  return node.type === 'folder' ? buildFolderNode(node) : buildFileNode(node);
}

function collectSections(nodes) {
  const secs = [];
  for (const n of nodes) {
    if (n.type === 'folder') secs.push(...collectSections(n.children));
    else for (const s of n.sections) if (s.has_cards) secs.push({ chapterPath: n.path, heading: s.heading, sectionSlug: s.slug });
  }
  return secs;
}

function buildFolderNode(folder) {
  const node = document.createElement('div');
  node.className = 'topic-node';

  const label = document.createElement('div');
  label.className = 'topic-label';
  if (S.expandedTopics.has(folder.path)) label.classList.add('open');

  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▶';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'label-name';
  nameSpan.textContent = folder.name;

  const studyBtn = document.createElement('button');
  studyBtn.className = 'study-quick-btn';
  studyBtn.title = `Study all of ${folder.name}`;
  studyBtn.textContent = '▶ Study';
  studyBtn.addEventListener('click', e => {
    e.stopPropagation();
    const secs = collectSections(folder.children);
    if (!secs.length) { toast('No cards generated in this folder yet', 'info'); return; }
    openStudyConfig(secs);
  });

  label.appendChild(caret);
  label.appendChild(nameSpan);
  label.appendChild(studyBtn);

  const childList = document.createElement('div');
  childList.className = 'chapter-list';
  if (S.expandedTopics.has(folder.path)) childList.classList.add('open');

  for (const child of folder.children) {
    childList.appendChild(buildNode(child));
  }

  label.addEventListener('click', () => {
    const open = label.classList.toggle('open');
    childList.classList.toggle('open', open);
    S.expandedTopics[open ? 'add' : 'delete'](folder.path);
  });

  node.appendChild(label);
  node.appendChild(childList);
  return node;
}

function buildFileNode(file) {
  const node = document.createElement('div');
  node.className = 'chapter-node';

  const key = file.path;
  const label = document.createElement('div');
  label.className = 'chapter-label';
  if (S.expandedChapters.has(key)) label.classList.add('open');

  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = '▶';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'label-name';
  nameSpan.textContent = file.name;

  const studyBtn = document.createElement('button');
  studyBtn.className = 'study-quick-btn';
  studyBtn.title = `Study all of ${file.name}`;
  studyBtn.textContent = '▶ Study';
  studyBtn.addEventListener('click', e => {
    e.stopPropagation();
    const secs = file.sections
      .filter(s => s.has_cards)
      .map(s => ({ chapterPath: file.path, heading: s.heading, sectionSlug: s.slug }));
    if (!secs.length) { toast('No cards generated in this file yet', 'info'); return; }
    openStudyConfig(secs);
  });

  label.appendChild(caret);
  label.appendChild(nameSpan);
  label.appendChild(studyBtn);

  const sectionList = document.createElement('div');
  sectionList.className = 'section-list';
  if (S.expandedChapters.has(key)) sectionList.classList.add('open');

  for (const sec of file.sections) {
    sectionList.appendChild(buildSectionItem(file, sec));
  }

  label.addEventListener('click', () => {
    const open = label.classList.toggle('open');
    sectionList.classList.toggle('open', open);
    S.expandedChapters[open ? 'add' : 'delete'](key);
  });

  node.appendChild(label);
  node.appendChild(sectionList);
  return node;
}

function buildSectionItem(chapter, sec) {
  const item = document.createElement('div');
  item.className = `section-item${sec.level === 3 ? ' h3' : ''}`;
  item.dataset.path = chapter.path;
  item.dataset.heading = sec.heading;
  item.dataset.slug = sec.slug;

  const name = document.createElement('span');
  name.textContent = sec.heading;
  item.appendChild(name);

  if (sec.has_cards) {
    const badge = document.createElement('span');
    badge.className = 'badge-cards';
    badge.textContent = 'cards';
    item.appendChild(badge);
  } else {
    const badge = document.createElement('span');
    badge.className = 'badge-needs';
    badge.textContent = '—';
    item.appendChild(badge);
  }

  // Highlight active
  if (
    S.activeSection &&
    S.activeSection.chapterPath === chapter.path &&
    S.activeSection.heading === sec.heading
  ) {
    item.classList.add('active');
  }

  item.addEventListener('click', () => selectSection(chapter, sec, item));
  return item;
}

async function selectSection(chapter, sec, itemEl) {
  // Update active state in sidebar
  document.querySelectorAll('.section-item.active').forEach(el => el.classList.remove('active'));
  itemEl.classList.add('active');

  S.activeSection = {
    chapterPath: chapter.path,
    chapterName: chapter.name,
    heading: sec.heading,
    sectionSlug: sec.slug,
  };

  // Close mobile sidebar so overlay doesn't block main content
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('show');

  showSectionView();
}

// ── Section view ──────────────────────────────────────────────────────
async function showSectionView() {
  const { chapterPath, chapterName, heading, sectionSlug } = S.activeSection;
  const main = document.getElementById('main');

  main.innerHTML = `
    <div class="content-pad" id="section-view">
      <div class="section-header">
        <div>
          <h2>${esc(heading)}</h2>
          <div class="section-meta">${esc(chapterName)}</div>
        </div>
        <div class="header-actions">
          <button class="btn btn-secondary" id="view-source-btn">View Source</button>
          <button class="btn btn-primary" id="generate-btn">Generate Cards</button>
          <button class="btn btn-success" id="study-btn">Study</button>
        </div>
        <div class="section-games">
          <button class="btn-shuffle" id="section-shuffle-btn">🎲 Shuffle</button>
          <button class="btn-match" id="section-match-btn">🃏 Match</button>
          <button class="btn-sprint" id="section-sprint-btn">🏃 Sprint</button>
          <button class="btn-blitz" id="section-blitz-btn">⚡ Blitz</button>
          <button class="btn-gravity" id="section-gravity-btn">⬇ Gravity</button>
          <button class="btn-typeit" id="section-typeit-btn">⌨ Type It</button>
          <button class="btn-sudden" id="section-sudden-btn">💀 Sudden</button>
          <button class="btn-monty" id="section-monty-btn">🎯 Monty</button>
          <button class="btn-learn" id="section-learn-btn">📖 Learn</button>
        </div>
      </div>
      <div id="cards-area">
        <div class="generating"><div class="spinner"></div> Loading cards…</div>
      </div>
    </div>`;

  document.getElementById('generate-btn').addEventListener('click', generateCards);
  document.getElementById('study-btn').addEventListener('click', () => openStudyConfig([S.activeSection]));
  document.getElementById('view-source-btn').addEventListener('click', () => openSourceModal());
  document.getElementById('section-shuffle-btn').addEventListener('click', startShuffleSection);
  document.getElementById('section-blitz-btn').addEventListener('click', startBlitzSection);
  document.getElementById('section-match-btn').addEventListener('click', startMatchSection);
  document.getElementById('section-sprint-btn').addEventListener('click', startSprintSection);
  document.getElementById('section-gravity-btn').addEventListener('click', startGravitySection);
  document.getElementById('section-typeit-btn').addEventListener('click', startTypeItSection);
  document.getElementById('section-sudden-btn').addEventListener('click', startSuddenDeathSection);
  document.getElementById('section-monty-btn').addEventListener('click', startMontySection);
  document.getElementById('section-learn-btn').addEventListener('click', startLearnSection);

  try {
    S.currentCards = await api(`/api/cards?path=${encodeURIComponent(chapterPath)}&section_slug=${encodeURIComponent(sectionSlug)}`);
    renderCards();
  } catch (e) {
    document.getElementById('cards-area').innerHTML = `<p style="color:var(--error)">${esc(e.message)}</p>`;
  }
}

function renderCards() {
  const area = document.getElementById('cards-area');
  if (!area || !S.currentCards) return;

  const gen = S.currentCards.generated || [];
  const usr = S.currentCards.user_created || [];

  if (!gen.length && !usr.length) {
    area.innerHTML = `
      <div style="color:var(--text2);text-align:center;padding:3rem 1rem">
        <div style="font-size:2.5rem;margin-bottom:.75rem">🃏</div>
        <p>No cards yet. Click <strong>Generate Cards</strong> to create them with AI.</p>
      </div>`;
    return;
  }

  area.innerHTML = '';

  if (gen.length) {
    const sec = document.createElement('div');
    sec.className = 'cards-section';
    sec.innerHTML = `<div class="cards-section-title">Generated cards <span style="font-weight:400;color:var(--text3)">(${gen.length})</span></div>`;
    gen.forEach(card => sec.appendChild(buildCardItem(card, false)));
    area.appendChild(sec);
  }

  if (usr.length) {
    const sec = document.createElement('div');
    sec.className = 'cards-section';
    sec.innerHTML = `<div class="cards-section-title">Your cards <span style="font-weight:400;color:var(--text3)">(${usr.length})</span></div>`;
    usr.forEach(card => sec.appendChild(buildCardItem(card, true)));
    area.appendChild(sec);
  }

  // Add card button
  const addWrap = document.createElement('div');
  addWrap.innerHTML = `<button class="btn btn-ghost" id="add-card-btn" style="margin-top:.5rem">+ Add card</button>`;
  area.appendChild(addWrap);
  document.getElementById('add-card-btn').addEventListener('click', () => showAddCardForm(area));
}

function buildCardItem(card, isUser) {
  const div = document.createElement('div');
  div.className = 'card-item';
  div.dataset.id = card.id;

  const tagClass = `tag-${card.tag || 'definition'}`;
  const stats = card.stats || { seen: 0, missed: 0 };

  let frontHtml = '';
  if (card.type === 'cloze') {
    frontHtml = esc(card.front).replace(/\{blank\}/g, '<span class="card-blank">[blank]</span>');
  } else {
    frontHtml = esc(card.front);
  }

  let detailHtml = '';
  if (card.type === 'cloze') {
    detailHtml = `<div class="card-back">Answer: ${esc(card.back)}</div>`;
  } else {
    const opts = (card.options || [])
      .map((o, i) => `<div class="card-option${i === card.correct_index ? ' correct' : ''}">${String.fromCharCode(65 + i)}. ${esc(o)}</div>`)
      .join('');
    detailHtml = `<div class="card-options">${opts}</div>`;
  }
  if (card.extra) detailHtml += `<div class="card-extra">${esc(card.extra)}</div>`;

  div.innerHTML = `
    <div class="card-meta">
      <span class="tag-badge ${tagClass}">${esc(card.tag || 'definition')}</span>
      <span class="type-badge">${card.type === 'cloze' ? 'cloze' : 'multiple choice'}</span>
      ${isUser ? '<span class="type-badge" style="background:var(--warning-dim);color:var(--warning)">yours</span>' : ''}
    </div>
    <div class="card-front">${frontHtml}</div>
    ${detailHtml}
    <div class="card-actions">
      <button class="btn btn-ghost btn-sm edit-btn">Edit</button>
      <button class="btn btn-danger btn-sm delete-btn">Delete</button>
      <div class="card-stats">${stats.seen} seen · ${stats.missed} missed</div>
    </div>`;

  div.querySelector('.edit-btn').addEventListener('click', () => toggleCardEditor(div, card));
  div.querySelector('.delete-btn').addEventListener('click', () => deleteCard(card.id));

  return div;
}

function toggleCardEditor(div, card) {
  let editor = div.querySelector('.card-editor');
  if (editor) { editor.remove(); return; }

  const isCloze = card.type === 'cloze';
  editor = document.createElement('div');
  editor.className = 'card-editor';

  editor.innerHTML = `
    <div class="editor-row">
      <label>Front${isCloze ? ' (use {blank} for the answer gap)' : ''}</label>
      <textarea class="edit-front">${esc(card.front)}</textarea>
    </div>
    <div class="editor-row">
      <label>${isCloze ? 'Answer (back)' : 'Question'}</label>
      <textarea class="edit-back">${esc(card.back || '')}</textarea>
    </div>
    <div class="editor-row">
      <label>Extra context</label>
      <textarea class="edit-extra">${esc(card.extra || '')}</textarea>
    </div>
    <div class="editor-row">
      <label>Tag</label>
      <select class="edit-tag">
        ${['definition','process','scenario'].map(t => `<option${t===card.tag?' selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="editor-actions">
      <button class="btn btn-secondary btn-sm cancel-edit">Cancel</button>
      <button class="btn btn-primary btn-sm save-edit">Save</button>
    </div>`;

  editor.querySelector('.cancel-edit').addEventListener('click', () => editor.remove());
  editor.querySelector('.save-edit').addEventListener('click', async () => {
    const updates = {
      front: editor.querySelector('.edit-front').value,
      back: editor.querySelector('.edit-back').value,
      extra: editor.querySelector('.edit-extra').value,
      tag: editor.querySelector('.edit-tag').value,
    };
    try {
      await api('/api/cards', {
        method: 'POST',
        body: {
          action: 'edit',
          path: S.activeSection.chapterPath,
          section_slug: S.activeSection.sectionSlug,
          card_id: card.id,
          updates,
        },
      });
      S.currentCards = await api(`/api/cards?path=${encodeURIComponent(S.activeSection.chapterPath)}&section_slug=${encodeURIComponent(S.activeSection.sectionSlug)}`);
      renderCards();
      toast('Card saved', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  });

  div.appendChild(editor);
}

async function deleteCard(cardId) {
  if (!confirm('Delete this card?')) return;
  try {
    await api('/api/cards', {
      method: 'POST',
      body: {
        action: 'delete',
        path: S.activeSection.chapterPath,
        section_slug: S.activeSection.sectionSlug,
        card_id: cardId,
      },
    });
    S.currentCards = await api(`/api/cards?path=${encodeURIComponent(S.activeSection.chapterPath)}&section_slug=${encodeURIComponent(S.activeSection.sectionSlug)}`);
    renderCards();
    toast('Card deleted', 'info');
    await refreshSectionBadge();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function showAddCardForm(area) {
  const existing = area.querySelector('.add-card-form');
  if (existing) { existing.remove(); return; }

  const form = document.createElement('div');
  form.className = 'add-card-form';
  form.innerHTML = `
    <h4>Add your own card</h4>
    <div class="form-row">
      <label>Type</label>
      <select id="new-type">
        <option value="cloze">Cloze (fill-in-the-blank)</option>
        <option value="multiple_choice">Multiple choice</option>
      </select>
    </div>
    <div class="form-row">
      <label>Tag</label>
      <select id="new-tag">
        <option>definition</option><option>process</option><option>scenario</option>
      </select>
    </div>
    <div class="form-row">
      <label>Front <small>(use {blank} for cloze)</small></label>
      <textarea id="new-front" placeholder="The {blank} is..."></textarea>
    </div>
    <div class="form-row">
      <label>Back / Answer</label>
      <textarea id="new-back" placeholder="The answer"></textarea>
    </div>
    <div class="form-row">
      <label>Extra context <small>(optional)</small></label>
      <textarea id="new-extra" placeholder="Additional explanation shown after reveal…"></textarea>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary btn-sm" id="cancel-add">Cancel</button>
      <button class="btn btn-primary btn-sm" id="save-add">Save Card</button>
    </div>`;

  area.appendChild(form);
  form.querySelector('#cancel-add').addEventListener('click', () => form.remove());
  form.querySelector('#save-add').addEventListener('click', async () => {
    const card = {
      type: form.querySelector('#new-type').value,
      tag: form.querySelector('#new-tag').value,
      front: form.querySelector('#new-front').value.trim(),
      back: form.querySelector('#new-back').value.trim(),
      extra: form.querySelector('#new-extra').value.trim(),
    };
    if (!card.front) { toast('Front is required', 'error'); return; }
    try {
      await api('/api/cards', {
        method: 'POST',
        body: {
          action: 'add_user',
          path: S.activeSection.chapterPath,
          section_slug: S.activeSection.sectionSlug,
          card,
        },
      });
      S.currentCards = await api(`/api/cards?path=${encodeURIComponent(S.activeSection.chapterPath)}&section_slug=${encodeURIComponent(S.activeSection.sectionSlug)}`);
      renderCards();
      toast('Card added', 'success');
      await refreshSectionBadge();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

async function generateCards() {
  const btn = document.getElementById('generate-btn');
  if (!btn) return;
  btn.disabled = true;

  const area = document.getElementById('cards-area');
  const existing = area ? area.innerHTML : '';
  const providerLabel = S.config?.active_provider === 'openai' ? 'OpenAI' : 'Claude';
  if (area) area.innerHTML = `<div class="generating"><div class="spinner"></div> Generating cards with ${providerLabel}…</div>`;

  try {
    const sec = await api(`/api/section?path=${encodeURIComponent(S.activeSection.chapterPath)}&heading=${encodeURIComponent(S.activeSection.heading)}`);
    const result = await api('/api/generate-cards', {
      method: 'POST',
      body: {
        path: S.activeSection.chapterPath,
        section_slug: S.activeSection.sectionSlug,
        heading: S.activeSection.heading,
        content: sec.content,
      },
    });
    S.currentCards = await api(`/api/cards?path=${encodeURIComponent(S.activeSection.chapterPath)}&section_slug=${encodeURIComponent(S.activeSection.sectionSlug)}`);
    renderCards();
    toast(`Generated ${result.count} cards`, 'success');
    await refreshSectionBadge();
  } catch (e) {
    if (area) area.innerHTML = existing;
    toast(e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function refreshSectionBadge() {
  // Re-scan just to refresh has_cards indicators
  try {
    S.vault = await api('/api/vault');
    renderVaultTree();
  } catch (_) {}
}

// ── Source modal ──────────────────────────────────────────────────────
async function openSourceModal() {
  const modal = document.getElementById('source-modal');
  const content = document.getElementById('source-content');
  content.textContent = 'Loading…';
  modal.classList.remove('hidden');

  try {
    const sec = await api(`/api/section?path=${encodeURIComponent(S.activeSection.chapterPath)}&heading=${encodeURIComponent(S.activeSection.heading)}`);
    content.textContent = `## ${sec.heading}\n\n${sec.content}`;
  } catch (e) {
    content.textContent = `Error: ${e.message}`;
  }
}

// ── Study config ──────────────────────────────────────────────────────
function openStudyConfig(preselectedSections) {
  const modal = document.getElementById('study-config-modal');
  const checklist = document.getElementById('section-checklist');
  checklist.innerHTML = '';

  const preSet = new Set(
    preselectedSections.map(ps => `${ps.chapterPath}::${ps.heading}`)
  );

  for (const item of S.vault) {
    const result = buildCLNode(item, preSet, () => {});
    if (result) checklist.appendChild(result.block);
  }

  modal.classList.remove('hidden');
}

function buildCLNode(node, preSet, onParentUpdate) {
  return node.type === 'folder' ? buildCLFolder(node, preSet, onParentUpdate) : buildCLFile(node, preSet, onParentUpdate);
}

function buildCLFolder(folder, preSet, onParentUpdate) {
  let allSectionInputs = [];

  const childList = document.createElement('div');
  childList.className = 'cl-children';

  for (const child of folder.children) {
    const result = buildCLNode(child, preSet, () => updateCLParent(folderCb, allSectionInputs, count));
    if (result) {
      childList.appendChild(result.block);
      allSectionInputs.push(...result.sectionInputs);
    }
  }

  if (!allSectionInputs.length) return null;

  const block = document.createElement('div');
  block.className = 'cl-topic';

  const header = document.createElement('div');
  header.className = 'cl-header cl-topic-header';

  const folderCb = document.createElement('input');
  folderCb.type = 'checkbox';
  folderCb.className = 'cl-cb';

  const caret = document.createElement('span');
  caret.className = 'cl-caret';
  caret.textContent = '▶';

  const name = document.createElement('span');
  name.className = 'cl-name';
  name.textContent = folder.name;

  const count = document.createElement('span');
  count.className = 'cl-count';

  header.appendChild(folderCb);
  header.appendChild(caret);
  header.appendChild(name);
  header.appendChild(count);

  folderCb.addEventListener('change', () => {
    allSectionInputs.forEach(inp => { inp.checked = folderCb.checked; });
    updateCLParent(folderCb, allSectionInputs, count);
    onParentUpdate();
  });

  header.addEventListener('click', e => {
    if (e.target === folderCb) return;
    const open = childList.classList.toggle('open');
    caret.style.transform = open ? 'rotate(90deg)' : '';
  });

  const hasPreselected = allSectionInputs.some(i => i.checked);
  if (hasPreselected) {
    childList.classList.add('open');
    caret.style.transform = 'rotate(90deg)';
  }

  updateCLParent(folderCb, allSectionInputs, count);

  block.appendChild(header);
  block.appendChild(childList);
  return { block, sectionInputs: allSectionInputs };
}

function buildCLFile(file, preSet, onParentUpdate) {
  const sectionInputs = [];

  const sectionList = document.createElement('div');
  sectionList.className = 'cl-children';

  for (const sec of file.sections.filter(s => s.has_cards)) {
    const { row, input } = buildCLSection(file, sec, preSet, () => {
      updateCLParent(fileCb, sectionInputs, count);
      onParentUpdate();
    });
    sectionList.appendChild(row);
    sectionInputs.push(input);
  }

  if (!sectionInputs.length) return null;

  const block = document.createElement('div');
  block.className = 'cl-chapter';

  const header = document.createElement('div');
  header.className = 'cl-header cl-chapter-header';

  const fileCb = document.createElement('input');
  fileCb.type = 'checkbox';
  fileCb.className = 'cl-cb';

  const caret = document.createElement('span');
  caret.className = 'cl-caret';
  caret.textContent = '▶';

  const name = document.createElement('span');
  name.className = 'cl-name';
  name.textContent = file.name;

  const count = document.createElement('span');
  count.className = 'cl-count';

  header.appendChild(fileCb);
  header.appendChild(caret);
  header.appendChild(name);
  header.appendChild(count);

  fileCb.addEventListener('change', () => {
    sectionInputs.forEach(inp => { inp.checked = fileCb.checked; });
    updateCLParent(fileCb, sectionInputs, count);
    onParentUpdate();
  });

  header.addEventListener('click', e => {
    if (e.target === fileCb) return;
    const open = sectionList.classList.toggle('open');
    caret.style.transform = open ? 'rotate(90deg)' : '';
  });

  const hasPreselected = sectionInputs.some(i => i.checked);
  if (hasPreselected) {
    sectionList.classList.add('open');
    caret.style.transform = 'rotate(90deg)';
  }

  updateCLParent(fileCb, sectionInputs, count);

  block.appendChild(header);
  block.appendChild(sectionList);
  return { block, sectionInputs };
}

function buildCLSection(chapter, sec, preSet, onChange) {
  const key = `${chapter.path}::${sec.heading}`;
  const preselected = preSet.has(key);

  const row = document.createElement('label');
  row.className = 'cl-section';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'cl-cb';
  input.checked = preselected;
  input.dataset.path = chapter.path;
  input.dataset.slug = sec.slug;
  input.dataset.heading = sec.heading;
  input.addEventListener('change', onChange);

  const label = document.createElement('span');
  label.className = 'cl-name';
  label.textContent = sec.heading;

  row.appendChild(input);
  row.appendChild(label);
  return { row, input };
}

function updateCLParent(parentCb, childInputs, countEl) {
  const total = childInputs.length;
  const checkedCount = childInputs.filter(i => i.checked).length;

  parentCb.checked = checkedCount === total && total > 0;
  parentCb.indeterminate = checkedCount > 0 && checkedCount < total;

  if (countEl) countEl.textContent = `${checkedCount}/${total}`;
}

function getStudySelections() {
  const inputs = document.querySelectorAll('#section-checklist input.cl-cb[data-path]:checked');
  return Array.from(inputs).map(inp => ({
    chapterPath: inp.dataset.path,
    sectionSlug: inp.dataset.slug,
    heading: inp.dataset.heading,
  }));
}

async function startStudySession() {
  const selections = getStudySelections();
  if (!selections.length) { toast('Select at least one section', 'error'); return; }

  const tagFilter = document.getElementById('filter-tag').value;
  const weakOnly = document.getElementById('filter-weak').checked;
  const struggleOnly = document.getElementById('filter-struggle').checked;
  const durationMinutes = parseInt(document.getElementById('duration-val').value) || 15;

  document.getElementById('study-config-modal').classList.add('hidden');

  const allCards = [];
  for (const sel of selections) {
    try {
      const data = await api(`/api/cards?path=${encodeURIComponent(sel.chapterPath)}&section_slug=${encodeURIComponent(sel.sectionSlug)}`);
      allCards.push(...(data.generated || []), ...(data.user_created || []));
    } catch (_) {}
  }

  if (!allCards.length) { toast('No cards found in selected sections', 'error'); return; }

  S.session = new StudySession(allCards, { tagFilter, weakOnly, struggleOnly }, durationMinutes);

  if (!S.session.allCards.length) {
    toast('No struggling cards in selection — try without Struggle Mode', 'info');
    S.session = null;
    return;
  }

  renderStudySession();
}

// ── Study session class ───────────────────────────────────────────────
class StudySession {
  constructor(cards, filters, durationMinutes) {
    this.allCards = this.applyFilters(cards, filters);
    this.queue = this.shuffle([...this.allCards]);
    this.endTime = Date.now() + durationMinutes * 60 * 1000;
    this.statsUpdates = {};  // cardId -> new SRS state to save
    this.lastRating = {};    // cardId -> last rating this session
    this.currentCard = null;
    this.totalSeen = 0;
    this.finished = false;
  }

  applyFilters(cards, { tagFilter, weakOnly, struggleOnly }) {
    let result = cards;
    if (tagFilter && tagFilter !== 'all') {
      result = result.filter(c => c.tag === tagFilter);
    }
    if (struggleOnly) {
      result = result.filter(c => {
        const s = c.stats || {};
        const seen = s.seen || 0;
        if (seen === 0) return false;
        return s.state === 'learning' || (s.lapses || 0) > 0 || (seen >= 2 && (s.missed || 0) / seen >= 0.4);
      });
    }
    if (weakOnly) {
      result = [...result].sort((a, b) => {
        const dueA = a.stats?.due || 0;
        const dueB = b.stats?.due || 0;
        const overdueA = Math.max(0, Date.now() / 1000 - dueA);
        const overdueB = Math.max(0, Date.now() / 1000 - dueB);
        return overdueB - overdueA;
      });
    }
    return result;
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  next() {
    if (this.isTimeUp() || this.queue.length === 0) {
      this.finished = true;
      return null;
    }
    this.currentCard = this.queue.shift();
    this.totalSeen++;
    return this.currentCard;
  }

  rate(rating) {
    const card = this.currentCard;
    if (!card) return;

    const newStats = srsApplyRating(card.stats, rating);
    this.statsUpdates[card.id] = newStats;
    this.lastRating[card.id] = rating;

    if (rating === 'again') {
      const pos = Math.min(3, this.queue.length);
      this.queue.splice(pos, 0, { ...card, stats: newStats });
    } else if (rating === 'hard') {
      const pos = Math.min(5, this.queue.length);
      this.queue.splice(pos, 0, { ...card, stats: newStats });
    }
    // good / easy: card is done for this session
  }

  isTimeUp() { return Date.now() >= this.endTime; }

  timeRemaining() { return Math.max(0, this.endTime - Date.now()); }

  summary() {
    const again = [], hard = [], good = [], easy = [];
    for (const [id, rating] of Object.entries(this.lastRating)) {
      const card = this.allCards.find(c => c.id === id);
      if (!card) continue;
      if (rating === 'again') again.push({ card, newStats: this.statsUpdates[id] });
      else if (rating === 'hard') hard.push({ card, newStats: this.statsUpdates[id] });
      else if (rating === 'good') good.push({ card, newStats: this.statsUpdates[id] });
      else easy.push({ card, newStats: this.statsUpdates[id] });
    }
    return { again, hard, good, easy, total: Object.keys(this.lastRating).length, statsUpdates: this.statsUpdates };
  }
}

// ── Study session UI ──────────────────────────────────────────────────
let timerInterval = null;

function renderStudySession() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="study-view" id="study-view">
      <div class="study-topbar">
        <button class="btn btn-ghost btn-sm" id="quit-session">← Quit</button>
        <div class="progress-bar-wrap"><div class="progress-bar" id="session-progress" style="width:0%"></div></div>
        <div class="study-progress-text" id="session-progress-text">0 seen</div>
        <div class="timer" id="session-timer">--:--</div>
      </div>
      <div class="study-card-area" id="study-card-area">
      </div>
    </div>`;

  document.getElementById('quit-session').addEventListener('click', () => {
    if (confirm('End this study session?')) endSession();
  });

  clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, 1000);
  tickTimer();
  showNextCard();
}

function tickTimer() {
  const el = document.getElementById('session-timer');
  if (!el || !S.session) return;
  const ms = S.session.timeRemaining();
  if (ms <= 0 && !S.session.finished) {
    S.session.finished = true;
    endSession();
    return;
  }
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  el.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  el.className = 'timer' + (ms < 60000 ? ' urgent' : ms < 120000 ? ' warning' : '');
}

function showNextCard() {
  const session = S.session;
  const area = document.getElementById('study-card-area');
  if (!area || !session) return;

  const card = session.next();
  if (!card) { endSession(); return; }

  // Update progress
  const total = session.allCards.length;
  const seen = session.totalSeen;
  const prog = document.getElementById('session-progress');
  const progText = document.getElementById('session-progress-text');
  if (prog) prog.style.width = `${Math.min((seen / total) * 100, 100)}%`;
  if (progText) progText.textContent = `${seen} seen`;

  if (card.type === 'multiple_choice') {
    renderMCCard(area, card);
  } else {
    renderClozeCard(area, card);
  }
}

function renderClozeCard(area, card) {
  const intervals = srsNextIntervals(card.stats);
  const frontHtml = esc(card.front).replace(
    /\{blank\}/g,
    '<span class="study-blank" id="blank-reveal">______</span>'
  );

  area.innerHTML = `
    <div class="study-card">
      <div class="study-card-meta">
        <span class="tag-badge tag-${card.tag || 'definition'}">${esc(card.tag || 'definition')}</span>
        <span class="type-badge">cloze</span>
        <span class="study-source" id="src-link">📄 source</span>
      </div>
      <div class="study-front">${frontHtml}</div>
      <div class="cloze-input-wrap">
        <input class="cloze-input" id="cloze-answer" placeholder="Type your answer…" autocomplete="off" autocorrect="off" spellcheck="false">
        <button class="btn-hint" id="hint-btn">Hint</button>
        <button class="btn btn-secondary" id="reveal-btn">Reveal</button>
      </div>
      <div id="hint-display" class="hint-text" style="display:none"></div>
      <div class="reveal-area" id="reveal-area">
        <div class="reveal-back">Answer: ${esc(card.back)}</div>
        ${card.extra ? `<div class="reveal-extra">${esc(card.extra)}</div>` : ''}
        <div class="explain-wrap">
          <button class="btn-explain" id="explain-btn">Explain with AI</button>
          <div id="explain-area" class="explain-area" style="display:none"></div>
        </div>
      </div>
      <div class="rating-buttons hidden" id="rating-btns">
        <button class="rating-btn rating-again" data-rating="again">
          Again<br><small>${formatInterval(intervals.again)}</small>
        </button>
        <button class="rating-btn rating-hard" data-rating="hard">
          Hard<br><small>${formatInterval(intervals.hard)}</small>
        </button>
        <button class="rating-btn rating-good" data-rating="good">
          Good<br><small>${formatInterval(intervals.good)}</small>
        </button>
        <button class="rating-btn rating-easy" data-rating="easy">
          Easy<br><small>${formatInterval(intervals.easy)}</small>
        </button>
      </div>
    </div>`;

  const input = document.getElementById('cloze-answer');
  input.focus();

  const reveal = () => {
    document.getElementById('reveal-area').classList.add('shown');
    document.getElementById('rating-btns').classList.remove('hidden');
    document.getElementById('blank-reveal').classList.add('revealed');
    document.getElementById('blank-reveal').textContent = card.back;
    input.disabled = true;
    document.getElementById('reveal-btn').disabled = true;
    document.getElementById('hint-btn').disabled = true;

    const typed = input.value.trim().toLowerCase();
    const answer = card.back.trim().toLowerCase();
    if (typed === answer) input.classList.add('correct');
    else if (typed) input.classList.add('incorrect');
  };

  document.getElementById('reveal-btn').addEventListener('click', reveal);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') reveal(); });

  document.getElementById('hint-btn').addEventListener('click', () => {
    const hint = document.getElementById('hint-display');
    const answer = card.back.trim();
    const pattern = answer.split('').map((c, i) => i === 0 ? c.toUpperCase() : (c === ' ' ? ' ' : '_')).join('');
    hint.textContent = `Hint: ${pattern}`;
    hint.style.display = 'block';
    document.getElementById('hint-btn').disabled = true;
  });

  document.getElementById('explain-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('explain-btn');
    const explainArea = document.getElementById('explain-area');
    btn.disabled = true;
    btn.textContent = 'Loading…';
    explainArea.style.display = 'block';
    explainArea.innerHTML = '<em class="explain-loading">Generating explanation…</em>';
    try {
      const result = await api('/api/explain', {
        method: 'POST',
        body: { type: card.type, front: card.front, back: card.back, extra: card.extra || '' },
      });
      explainArea.textContent = result.explanation;
      btn.style.display = 'none';
    } catch (e) {
      explainArea.textContent = `Error: ${e.message}`;
      btn.disabled = false;
      btn.textContent = 'Explain with AI';
    }
  });

  document.getElementById('rating-btns').querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', () => { S.session.rate(btn.dataset.rating); showNextCard(); });
  });

  document.getElementById('src-link')?.addEventListener('click', () => {
    if (card.source) showSourceForCard(card.source);
  });
}

function renderMCCard(area, card) {
  const intervals = srsNextIntervals(card.stats);
  const letters = ['A', 'B', 'C', 'D'];
  const optionsHtml = (card.options || []).map((opt, i) => `
    <button class="mc-option" data-index="${i}"${i === card.correct_index ? ' data-correct="true"' : ''}>
      <span class="mc-letter">${letters[i]}</span>
      <span>${esc(opt)}</span>
    </button>`).join('');

  area.innerHTML = `
    <div class="study-card">
      <div class="study-card-meta">
        <span class="tag-badge tag-${card.tag || 'definition'}">${esc(card.tag || 'definition')}</span>
        <span class="type-badge">multiple choice</span>
        <span class="study-source" id="src-link">📄 source</span>
      </div>
      <div class="study-front">${esc(card.front)}</div>
      <div class="mc-hint-bar">
        <button class="btn-hint" id="hint-btn">Remove a wrong answer</button>
      </div>
      <div class="mc-options" id="mc-options">${optionsHtml}</div>
      <div class="reveal-area" id="reveal-area">
        ${card.extra ? `<div class="reveal-extra">${esc(card.extra)}</div>` : ''}
        <div class="explain-wrap">
          <button class="btn-explain" id="explain-btn">Explain with AI</button>
          <div id="explain-area" class="explain-area" style="display:none"></div>
        </div>
      </div>
      <div class="rating-buttons hidden" id="rating-btns">
        <button class="rating-btn rating-again" data-rating="again">
          Again<br><small>${formatInterval(intervals.again)}</small>
        </button>
        <button class="rating-btn rating-hard" data-rating="hard">
          Hard<br><small>${formatInterval(intervals.hard)}</small>
        </button>
        <button class="rating-btn rating-good" data-rating="good">
          Good<br><small>${formatInterval(intervals.good)}</small>
        </button>
        <button class="rating-btn rating-easy" data-rating="easy">
          Easy<br><small>${formatInterval(intervals.easy)}</small>
        </button>
      </div>
    </div>`;

  document.getElementById('hint-btn').addEventListener('click', () => {
    const wrongOptions = Array.from(document.querySelectorAll('.mc-option:not([data-correct])')).filter(b => !b.disabled && !b.classList.contains('eliminated'));
    if (wrongOptions.length) {
      const target = wrongOptions[Math.floor(Math.random() * wrongOptions.length)];
      target.disabled = true;
      target.classList.add('eliminated');
    }
    document.getElementById('hint-btn').disabled = true;
  });

  let answered = false;
  document.querySelectorAll('.mc-option').forEach(btn => {
    btn.addEventListener('click', () => {
      if (answered || btn.disabled) return;
      answered = true;
      const chosen = parseInt(btn.dataset.index);
      const correct = chosen === card.correct_index;

      document.querySelectorAll('.mc-option').forEach((b, i) => {
        b.disabled = true;
        if (i === card.correct_index) b.classList.add('correct');
        else if (i === chosen && !correct) b.classList.add('incorrect');
      });

      document.getElementById('reveal-area').classList.add('shown');
      document.getElementById('rating-btns').classList.remove('hidden');
      document.getElementById('hint-btn').disabled = true;
    });
  });

  document.getElementById('explain-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('explain-btn');
    const explainArea = document.getElementById('explain-area');
    btn.disabled = true;
    btn.textContent = 'Loading…';
    explainArea.style.display = 'block';
    explainArea.innerHTML = '<em class="explain-loading">Generating explanation…</em>';
    try {
      const result = await api('/api/explain', {
        method: 'POST',
        body: {
          type: card.type,
          front: card.front,
          back: card.back || '',
          extra: card.extra || '',
          options: card.options || [],
          correct_index: card.correct_index ?? 0,
        },
      });
      explainArea.textContent = result.explanation;
      btn.style.display = 'none';
    } catch (e) {
      explainArea.textContent = `Error: ${e.message}`;
      btn.disabled = false;
      btn.textContent = 'Explain with AI';
    }
  });

  document.getElementById('rating-btns').querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', () => { S.session.rate(btn.dataset.rating); showNextCard(); });
  });

  document.getElementById('src-link')?.addEventListener('click', () => {
    if (card.source) showSourceForCard(card.source);
  });
}

async function showSourceForCard(source) {
  const [filePath, heading] = source.split('::');
  const modal = document.getElementById('source-modal');
  const content = document.getElementById('source-content');
  content.textContent = 'Loading…';
  modal.classList.remove('hidden');
  try {
    const sec = await api(`/api/section?path=${encodeURIComponent(filePath)}&heading=${encodeURIComponent(heading)}`);
    content.textContent = `## ${sec.heading}\n\n${sec.content}`;
  } catch (e) {
    content.textContent = `Error: ${e.message}`;
  }
}

async function endSession() {
  clearInterval(timerInterval);
  if (!S.session) return;

  const summary = S.session.summary();
  S.session = null;

  try {
    await api('/api/stats', { method: 'POST', body: summary.statsUpdates });
  } catch (_) {}

  const xpEarned =
    summary.easy.length * 15 +
    summary.good.length * 10 +
    summary.hard.length * 5 +
    summary.again.length * 2;

  const gsResult = gsEarnXP(xpEarned);
  renderGamBar();
  if (gsResult.leveledUp) setTimeout(() => showLevelUpToast(gsResult.newLevel), 600);

  renderSummary(summary, xpEarned, gsResult);
}

function renderSummary(summary, xpEarned = 0, gsResult = {}) {
  const main = document.getElementById('main');

  const againHtml = summary.again.map(r => `
    <div class="missed-card-item">
      <span class="missed-front">${esc(r.card.front.replace(/\{blank\}/g, '___'))}</span>
      <span class="rating-pill rating-pill-again">Again · ${formatInterval(r.newStats.interval)}</span>
    </div>`).join('');

  const hardHtml = summary.hard.map(r => `
    <div class="missed-card-item" style="opacity:.85">
      <span class="missed-front">${esc(r.card.front.replace(/\{blank\}/g, '___'))}</span>
      <span class="rating-pill rating-pill-hard">Hard · ${formatInterval(r.newStats.interval)}</span>
    </div>`).join('');

  const goodHtml = summary.good.map(r => `
    <div class="missed-card-item" style="opacity:.75">
      <span class="missed-front">${esc(r.card.front.replace(/\{blank\}/g, '___'))}</span>
      <span class="rating-pill rating-pill-good">Good · ${formatInterval(r.newStats.interval)}</span>
    </div>`).join('');

  const allEasy = !summary.again.length && !summary.hard.length && !summary.good.length;

  const { level, pct } = gsLevelProgress();
  const xpPanelHtml = xpEarned > 0 ? `
    <div class="summary-xp-panel">
      <div class="summary-xp-earned">+${xpEarned} XP</div>
      <div class="summary-xp-sub">Level ${level}</div>
      <div class="summary-xp-bar-wrap">
        <div class="summary-xp-bar" id="summary-xp-bar" style="width:0%"></div>
      </div>
      ${gsResult.leveledUp ? `<div class="summary-levelup-msg">⬆ Level Up! Now Level ${gsResult.newLevel}</div>` : ''}
      ${GS.streakDays > 1 ? `<div class="summary-streak-msg">🔥 ${GS.streakDays} day streak — keep it up!</div>` : ''}
    </div>` : '';

  main.innerHTML = `
    <div class="summary-view">
      ${xpPanelHtml}
      <div class="summary-header">
        <h2>Session Complete</h2>
        <p>${summary.total} cards reviewed</p>
      </div>
      <div class="summary-stats">
        <div class="stat-box bad">
          <div class="stat-number">${summary.again.length}</div>
          <div class="stat-label">Again</div>
        </div>
        <div class="stat-box hard">
          <div class="stat-number">${summary.hard.length}</div>
          <div class="stat-label">Hard</div>
        </div>
        <div class="stat-box" style="border-color:var(--warning)">
          <div class="stat-number" style="color:var(--warning)">${summary.good.length}</div>
          <div class="stat-label">Good</div>
        </div>
        <div class="stat-box good">
          <div class="stat-number">${summary.easy.length}</div>
          <div class="stat-label">Easy</div>
        </div>
      </div>
      ${summary.again.length ? `<div class="missed-cards-title">Review again soon:</div>${againHtml}` : ''}
      ${summary.hard.length ? `<div class="missed-cards-title" style="margin-top:1rem">Marked hard — review coming:</div>${hardHtml}` : ''}
      ${summary.good.length ? `<div class="missed-cards-title" style="margin-top:1rem">Scheduled for review:</div>${goodHtml}` : ''}
      ${allEasy
        ? '<p style="color:var(--success);text-align:center;font-weight:600;padding:1rem">🎉 Everything rated Easy — great session!</p>'
        : ''}
      <div class="summary-actions">
        <button class="btn btn-secondary" id="go-home-btn">← Back to Vault</button>
        <button class="btn btn-primary" id="study-again-btn">Study Again</button>
      </div>
    </div>`;

  if (xpEarned > 0) {
    setTimeout(() => {
      const bar = document.getElementById('summary-xp-bar');
      if (bar) bar.style.width = pct + '%';
    }, 250);
  }

  document.getElementById('go-home-btn').addEventListener('click', showWelcome);
  document.getElementById('study-again-btn').addEventListener('click', () => {
    if (S.activeSection) openStudyConfig([S.activeSection]);
    else showWelcome();
  });
}

// ── Weak spot dashboard ───────────────────────────────────────────────
async function showWeakSpots() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="content-pad">
      <div class="weak-spots-header">
        <h2>Weak Spots</h2>
        <p>Cards you've struggled with most, ranked by miss rate.</p>
      </div>
      <div id="weak-spots-area">
        <div class="generating"><div class="spinner"></div> Loading…</div>
      </div>
    </div>`;

  try {
    const cards = await api('/api/weak-cards');
    renderWeakSpots(cards);
  } catch (e) {
    document.getElementById('weak-spots-area').innerHTML = `<p style="color:var(--error)">${esc(e.message)}</p>`;
  }
}

function renderWeakSpots(cards) {
  const area = document.getElementById('weak-spots-area');
  if (!area) return;

  if (!cards.length) {
    area.innerHTML = `<div class="no-weak-cards">
      <div style="font-size:2.5rem;margin-bottom:.5rem">🎉</div>
      <p>No struggling cards yet — keep studying!</p>
    </div>`;
    return;
  }

  const listHtml = cards.map(card => {
    const front = card.type === 'cloze'
      ? card.front.replace(/\{blank\}/g, '___')
      : card.front;
    const missedPct = Math.round((card.missed_rate || 0) * 100);
    const seen = card.stats?.seen || 0;
    const lapses = card.stats?.lapses || 0;
    return `
      <div class="weak-card-item">
        <div class="weak-card-front">${esc(front)}</div>
        <div class="weak-card-stats">
          <span class="weak-pct">${missedPct}% missed</span>
          <span>${seen} seen · ${lapses} lapse${lapses !== 1 ? 's' : ''}</span>
        </div>
      </div>`;
  }).join('');

  area.innerHTML = `
    <div style="margin-bottom:1rem;display:flex;align-items:center;gap:.75rem">
      <button class="btn btn-primary" id="study-weak-btn">Study These ${cards.length} Cards</button>
      <span style="font-size:.82rem;color:var(--text3)">${cards.length} card${cards.length !== 1 ? 's' : ''} need attention</span>
    </div>
    ${listHtml}`;

  document.getElementById('study-weak-btn').addEventListener('click', () => {
    S.session = new StudySession(cards, { tagFilter: 'all', weakOnly: false, struggleOnly: false }, 30);
    renderStudySession();
  });
}

// ── Welcome view ──────────────────────────────────────────────────────
function showWelcome() {
  document.getElementById('main').innerHTML = `
    <div class="welcome">
      <div class="big-icon">🃏</div>
      <h2>Flashcards</h2>
      <p>Select a section from your vault to view or generate cards, then start a study session.</p>
      <button class="btn btn-primary" id="welcome-study-all" style="margin-top:.5rem">Study All Sections with Cards</button>
    </div>`;
  document.getElementById('welcome-study-all').addEventListener('click', () => {
    // Pre-select all sections that have cards
    const all = [];
    for (const topic of S.vault) {
      for (const ch of topic.chapters) {
        for (const sec of ch.sections) {
          if (sec.has_cards) {
            all.push({ chapterPath: ch.path, heading: sec.heading, sectionSlug: sec.slug });
          }
        }
      }
    }
    if (!all.length) { toast('No cards generated yet. Pick a section and generate first.', 'info'); return; }
    openStudyConfig(all);
  });
}

// ── Settings modal ────────────────────────────────────────────────────
async function openSettings() {
  const modal = document.getElementById('settings-modal');
  modal.classList.remove('hidden');
  const statusEl = document.getElementById('vault-path-status');
  statusEl.style.color = '';
  statusEl.textContent = 'Absolute path to your Obsidian vault folder.';
  try {
    S.config = await api('/api/config');
    document.getElementById('vault-path-input').value = S.config.vault_path || '';
    document.getElementById('provider-select').value = S.config.active_provider || 'anthropic';

    const keysSet = S.config.keys_set || {};
    document.getElementById('api-key-status-anthropic').textContent =
      keysSet.anthropic ? '✓ Key is set' : 'Not set';
    document.getElementById('api-key-status-openai').textContent =
      keysSet.openai ? '✓ Key is set' : 'Not set';
    document.getElementById('api-key-anthropic').value = '';
    document.getElementById('api-key-openai').value = '';
    document.getElementById('theme-toggle').checked =
      document.documentElement.getAttribute('data-theme') === 'dark';
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function saveSettings() {
  const vaultPath = document.getElementById('vault-path-input').value.trim();
  const provider = document.getElementById('provider-select').value;
  const anthropicKey = document.getElementById('api-key-anthropic').value.trim();
  const openaiKey = document.getElementById('api-key-openai').value.trim();

  const apiKeys = {};
  if (anthropicKey) apiKeys.anthropic = anthropicKey;
  if (openaiKey) apiKeys.openai = openaiKey;

  try {
    const result = await api('/api/config', {
      method: 'POST',
      body: { vault_path: vaultPath, active_provider: provider, api_keys: apiKeys },
    });

    const keysSet = result.keys_set || {};
    document.getElementById('api-key-status-anthropic').textContent =
      keysSet.anthropic ? '✓ Key is set' : 'Not set';
    document.getElementById('api-key-status-openai').textContent =
      keysSet.openai ? '✓ Key is set' : 'Not set';
    document.getElementById('api-key-anthropic').value = '';
    document.getElementById('api-key-openai').value = '';

    S.config = await api('/api/config');
    document.getElementById('settings-modal').classList.add('hidden');
    toast('Settings saved', 'success');
    await loadVault();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ── Folder browser ────────────────────────────────────────────────────
let folderBrowserCurrent = null;

async function openFolderBrowser() {
  document.getElementById('folder-browser-modal').classList.remove('hidden');
  const startPath = document.getElementById('vault-path-input').value.trim();
  await loadFolderBrowserDir(startPath || '');
}

async function loadFolderBrowserDir(path) {
  const list = document.getElementById('folder-browser-list');
  const pathEl = document.getElementById('folder-browser-path');
  list.innerHTML = '<div style="padding:1rem;color:var(--text2);text-align:center">Loading…</div>';

  try {
    const data = await api(`/api/browse?path=${encodeURIComponent(path)}`);
    folderBrowserCurrent = data.current;
    pathEl.textContent = data.current;

    const upBtn = document.getElementById('folder-up-btn');
    upBtn.disabled = !data.parent;
    upBtn.onclick = data.parent ? () => loadFolderBrowserDir(data.parent) : null;

    list.innerHTML = '';
    if (!data.dirs.length) {
      list.innerHTML = '<div style="padding:1rem;color:var(--text3);text-align:center;font-size:.85rem">No subdirectories here</div>';
      return;
    }
    for (const dir of data.dirs) {
      const item = document.createElement('div');
      item.className = 'folder-browser-item';
      item.innerHTML = `<span class="folder-browser-icon">📁</span><span>${esc(dir.name)}</span>`;
      item.addEventListener('click', () => loadFolderBrowserDir(dir.path));
      list.appendChild(item);
    }
  } catch (e) {
    list.innerHTML = `<div style="padding:1rem;color:var(--error);text-align:center">${esc(e.message)}</div>`;
  }
}

// ── Utility ───────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── SRS (SM-2 style) ──────────────────────────────────────────────────
function formatInterval(days) {
  if (days < 1 / 1440) return '<1m';
  const mins = Math.round(days * 1440);
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}hr`;
  const d = Math.round(days);
  if (d < 7) return `${d}d`;
  if (d < 30) return `${Math.round(d / 7)}wk`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${Math.round(d / 365)}y`;
}

// Stage-based SRS: green/yellow advances stage, red/orange drops it
const SRS_STAGES = [
  [1, 5, 10, 15],                 // stage 0: 1m 5m 10m 15m
  [5, 10, 15, 30],                // stage 1: 5m 10m 15m 30m
  [15, 30, 60, 1440],             // stage 2: 15m 30m 1hr 1day
  [60, 1440, 4320, 10080],        // stage 3: 1hr 1day 3days 1wk
  [2880, 10080, 20160, 30240],    // stage 4: 2days 1wk 2wks 3wks
  [10080, 20160, 30240, 40320],   // stage 5: 1wk 2wks 3wks 4wks
]; // all values in minutes

function srsNextIntervals(stats) {
  const stage = Math.max(0, Math.min(stats?.stage ?? 0, SRS_STAGES.length - 1));
  const [a, h, g, e] = SRS_STAGES[stage].map(m => m / 1440); // convert to days
  return { again: a, hard: h, good: g, easy: e };
}

function srsApplyRating(stats, rating) {
  const stage = Math.max(0, Math.min(stats?.stage ?? 0, SRS_STAGES.length - 1));
  const maxStage = SRS_STAGES.length - 1;
  const [a, h, g, e] = SRS_STAGES[stage].map(m => m / 1440);

  const advance = rating === 'good' || rating === 'easy';
  const newStage = advance ? Math.min(maxStage, stage + 1) : Math.max(0, stage - 1);
  const newInterval = { again: a, hard: h, good: g, easy: e }[rating];

  return {
    stage: newStage,
    interval: newInterval,
    state: stage === 0 && !advance ? 'learning' : 'review',
    lapses: rating === 'again' ? (stats?.lapses || 0) + 1 : (stats?.lapses || 0),
    due: Date.now() / 1000 + newInterval * 86400,
    seen: (stats?.seen || 0) + 1,
    missed: rating === 'again' ? (stats?.missed || 0) + 1 : (stats?.missed || 0),
  };
}

// ── Duration pill logic ───────────────────────────────────────────────
function initDurationPills() {
  let selectedDuration = 15;
  const pills = document.querySelectorAll('.duration-pill');
  const customInput = document.getElementById('duration-custom');
  const hiddenVal = document.getElementById('duration-val');

  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      pills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedDuration = parseInt(pill.dataset.mins);
      hiddenVal.value = selectedDuration;
      if (customInput) customInput.value = '';
    });
  });

  if (customInput) {
    customInput.addEventListener('input', () => {
      const v = parseInt(customInput.value);
      if (v > 0) {
        pills.forEach(p => p.classList.remove('active'));
        hiddenVal.value = v;
      }
    });
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────
async function init() {
  loadTheme();
  gsLoad();
  renderGamBar();

  // Settings modal
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('close-settings').addEventListener('click', () =>
    document.getElementById('settings-modal').classList.add('hidden')
  );
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('theme-toggle').addEventListener('change', e => setTheme(e.target.checked));

  // Vault path test & browse
  document.getElementById('test-path-btn').addEventListener('click', async () => {
    const path = document.getElementById('vault-path-input').value.trim();
    if (!path) { toast('Enter a path first', 'error'); return; }
    const statusEl = document.getElementById('vault-path-status');
    statusEl.textContent = 'Testing…';
    statusEl.style.color = '';
    try {
      const result = await api(`/api/test-vault-path?path=${encodeURIComponent(path)}`);
      if (result.ok) {
        statusEl.textContent = `✓ Valid — ${result.md_count} markdown file${result.md_count !== 1 ? 's' : ''} found`;
        statusEl.style.color = 'var(--success)';
      } else {
        statusEl.textContent = `✗ ${result.error}`;
        statusEl.style.color = 'var(--error)';
      }
    } catch (e) {
      statusEl.textContent = `✗ ${e.message}`;
      statusEl.style.color = 'var(--error)';
    }
  });
  document.getElementById('browse-vault-btn').addEventListener('click', openFolderBrowser);

  // Folder browser modal
  document.getElementById('close-folder-browser').addEventListener('click', () =>
    document.getElementById('folder-browser-modal').classList.add('hidden')
  );
  document.getElementById('cancel-folder-browser').addEventListener('click', () =>
    document.getElementById('folder-browser-modal').classList.add('hidden')
  );
  document.getElementById('select-folder-btn').addEventListener('click', () => {
    if (folderBrowserCurrent) {
      document.getElementById('vault-path-input').value = folderBrowserCurrent;
      document.getElementById('vault-path-status').textContent = 'Path selected — click Save Settings to apply.';
      document.getElementById('vault-path-status').style.color = 'var(--accent)';
    }
    document.getElementById('folder-browser-modal').classList.add('hidden');
  });

  // Study config modal
  document.getElementById('close-study-config').addEventListener('click', () =>
    document.getElementById('study-config-modal').classList.add('hidden')
  );
  document.getElementById('start-session-btn').addEventListener('click', startStudySession);
  document.getElementById('start-shuffle-btn').addEventListener('click', startShuffleFromConfig);
  document.getElementById('start-blitz-btn').addEventListener('click', startBlitzFromConfig);
  document.getElementById('start-match-btn').addEventListener('click', startMatchFromConfig);
  document.getElementById('start-sprint-btn').addEventListener('click', startSprintFromConfig);
  document.getElementById('start-gravity-btn').addEventListener('click', startGravityFromConfig);
  document.getElementById('start-typeit-btn').addEventListener('click', startTypeItFromConfig);
  document.getElementById('start-sudden-btn').addEventListener('click', startSuddenDeathFromConfig);
  document.getElementById('start-monty-btn').addEventListener('click', startMontyFromConfig);
  document.getElementById('start-learn-btn').addEventListener('click', startLearnFromConfig);

  // Source modal
  document.getElementById('close-source').addEventListener('click', () =>
    document.getElementById('source-modal').classList.add('hidden')
  );

  // Click outside modals to close
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  initDurationPills();
  showWelcome();

  // Sidebar buttons
  document.getElementById('sidebar-weak-spots')?.addEventListener('click', showWeakSpots);
  document.getElementById('sidebar-study-all')?.addEventListener('click', () => {
    const all = [];
    for (const topic of S.vault)
      for (const ch of topic.chapters)
        for (const sec of ch.sections)
          if (sec.has_cards) all.push({ chapterPath: ch.path, heading: sec.heading, sectionSlug: sec.slug });
    if (!all.length) { toast('No cards generated yet', 'info'); return; }
    openStudyConfig(all);
  });

  // Mobile sidebar toggle
  const menuBtn = document.getElementById('menu-btn');
  const overlay = document.getElementById('sidebar-overlay');
  menuBtn?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
    overlay?.classList.toggle('show');
  });
  overlay?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    overlay.classList.remove('show');
  });

  await loadVault();

  // PWA service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/service-worker.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
