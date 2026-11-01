const grid = document.querySelector('#memory-grid');
const yearSelect = document.querySelector('#year-select');
const searchInput = document.querySelector('#search-input');
const count = document.querySelector('#result-count');
const empty = document.querySelector('#empty-state');
const modal = document.querySelector('#moment-dialog');
const form = document.querySelector('#memory-form');
const status = document.querySelector('#form-status');
const memberStatus = document.querySelector('#member-status');
const anonymousRadio = document.querySelector('#post-anonymous');
const memberRadio = document.querySelector('#post-as-member');
let selectedCategory = 'All';
let moments = [];
let activeMember = null;
const icons = { Internet: '⌘', Games: '✳', Music: '♫', Sport: '◎', 'TV & music': '♫', 'Everyday life': '✿' };
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

function updateMemberUI(member, { showCredentials = false, selectMember = false } = {}) {
  activeMember = member;
  memberRadio.disabled = !member;
  if (member) {
    const name = member.displayName || member.memberId;
    document.querySelector('#member-post-label').textContent = `Post as ${name}`;
    if (selectMember) memberRadio.checked = true;
  } else {
    document.querySelector('#member-post-label').textContent = 'Post as a member';
    anonymousRadio.checked = true;
  }
  if (showCredentials && member) {
    document.querySelector('#member-id-output').value = member.memberId;
    document.querySelector('#member-token-output').value = member.memberToken;
    document.querySelector('#member-credential-card').hidden = false;
  }
}

try {
  const saved = JSON.parse(localStorage.getItem('backscroll-member') || 'null');
  if (saved?.memberId && saved?.memberToken) updateMemberUI(saved, { showCredentials: true, selectMember: true });
} catch { /* Membership can still be used for this visit if browser storage is disabled. */ }

function populateYears(items) {
  const first = Math.min(...items.map((item) => item.year));
  const last = Math.max(...items.map((item) => item.endYear || item.year));
  const years = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  yearSelect.innerHTML = '<option value="all">Any year</option>' + years.map((year) => `<option value="${year}">${year}</option>`).join('');
}

function cardTemplate(item) {
  const range = item.endYear && item.endYear !== item.year ? `${item.year} — ${item.endYear}` : item.year;
  return `<article class="memory-card" tabindex="0" role="button" data-id="${escapeHtml(item.id)}" aria-label="Read about ${escapeHtml(item.title)}"><div class="card-top"><span class="card-category">${escapeHtml(item.category)}</span><span class="card-year">${range}</span></div><span class="card-icon" aria-hidden="true">${icons[item.category] || '✳'}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><div class="card-footer"><span>${(item.tags || []).slice(0,2).map(escapeHtml).join(' · ')}</span><b>↗</b></div></article>`;
}

async function loadMoments() {
  const params = new URLSearchParams();
  if (yearSelect.value !== 'all') params.set('year', yearSelect.value);
  if (selectedCategory !== 'All') params.set('category', selectedCategory);
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
  try {
    const response = await fetch(`/api/moments?${params}`);
    if (!response.ok) throw new Error('Unable to load the archive');
    const data = await response.json();
    const list = data.moments;
    count.textContent = `${String(data.total).padStart(2,'0')} MOMENTS, AND COUNTING`;
    grid.innerHTML = list.map(cardTemplate).join('');
    empty.hidden = list.length > 0;
    grid.hidden = list.length === 0;
  } catch {
    count.textContent = 'THE ARCHIVE IS HAVING A MOMENT';
    grid.innerHTML = '<p class="empty-state">Could not connect to the archive. Please refresh in a moment.</p>';
  }
}

async function openMoment(id, updateUrl = true) {
  const item = moments.find((moment) => moment.id === id);
  if (!item) return;
  if (updateUrl) history.replaceState(null, '', `#moment=${encodeURIComponent(id)}`);
  document.querySelector('#memory-moment-id').value = id;
  document.querySelector('#dialog-category').innerHTML = `<span class="eyebrow-line"></span> ${escapeHtml(item.category)} · ${item.year}`;
  document.querySelector('#dialog-title').textContent = item.title;
  document.querySelector('#dialog-description').textContent = item.description;
  const source = document.querySelector('#dialog-source');
  source.href = item.sourceUrl;
  source.textContent = `Read: ${item.sourceTitle} ↗`;
  const community = document.querySelector('#dialog-community');
  community.hidden = true;
  try {
    const response = await fetch(`/api/memories?momentId=${encodeURIComponent(id)}`);
    const data = await response.json();
    if (data.memories?.length) {
      const memory = data.memories[0];
      const author = memory.memberId ? ` — ${memory.memberDisplayName ? `${memory.memberDisplayName} · ` : ''}${memory.memberId}` : '';
      community.textContent = `“${memory.text}”${author}`;
      community.hidden = false;
    }
  } catch { /* community memories are optional */ }
  modal.showModal();
}

async function loadSeed() {
  try {
    const response = await fetch('/api/moments');
    moments = (await response.json()).moments;
    populateYears(moments);
    await loadMoments();
    const sharedMoment = new URLSearchParams(location.hash.slice(1)).get('moment');
    if (sharedMoment) openMoment(sharedMoment, false);
  } catch {
    count.textContent = 'THE ARCHIVE IS HAVING A MOMENT';
  }
}

grid.addEventListener('click', (event) => {
  const card = event.target.closest('.memory-card');
  if (card) openMoment(card.dataset.id);
});
grid.addEventListener('keydown', (event) => {
  const card = event.target.closest('.memory-card');
  if (card && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openMoment(card.dataset.id); }
});
yearSelect.addEventListener('change', loadMoments);
let searchTimer;
searchInput.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadMoments, 180); });
document.querySelectorAll('.filter-chip').forEach((button) => button.addEventListener('click', () => {
  document.querySelector('.filter-chip.active')?.classList.remove('active');
  button.classList.add('active');
  selectedCategory = button.dataset.category;
  loadMoments();
}));
document.querySelector('.dialog-close').addEventListener('click', () => modal.close());
modal.addEventListener('click', (event) => { if (event.target === modal) modal.close(); });
modal.addEventListener('close', () => { if (location.hash.startsWith('#moment=')) history.replaceState(null, '', `${location.pathname}${location.search}`); });
document.querySelector('.dialog-add').addEventListener('click', () => modal.close());
document.querySelector('#dialog-share').addEventListener('click', async (event) => {
  const id = new URLSearchParams(location.hash.slice(1)).get('moment');
  if (!id) return;
  const button = event.currentTarget;
  const shareUrl = `${location.origin}${location.pathname}#moment=${encodeURIComponent(id)}`;
  try {
    await navigator.clipboard.writeText(shareUrl);
    button.innerHTML = 'Link copied — send it to a friend <span>✓</span>';
  } catch {
    button.textContent = shareUrl;
  }
});

document.querySelector('#join-member-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  memberStatus.textContent = 'Creating your member ID…';
  try {
    const displayName = document.querySelector('#member-display-name').value.trim();
    const response = await fetch('/api/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not create your membership.');
    const member = { memberId: data.memberId, memberToken: data.memberToken, displayName: data.displayName };
    try { localStorage.setItem('backscroll-member', JSON.stringify(member)); } catch { /* The recovery key is still shown below for manual saving. */ }
    updateMemberUI(member, { showCredentials: true, selectMember: true });
    memberStatus.textContent = data.message;
  } catch (error) {
    memberStatus.textContent = error.message || 'Could not create your membership.';
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#copy-member-details').addEventListener('click', async () => {
  if (!activeMember) return;
  const details = `Backscroll member ID: ${activeMember.memberId}\nPrivate recovery key: ${activeMember.memberToken}\nKeep the recovery key private.`;
  try {
    await navigator.clipboard.writeText(details);
    memberStatus.textContent = 'Member ID and private recovery key copied. Keep the key somewhere safe.';
  } catch {
    memberStatus.textContent = 'Copy unavailable here. The ID and recovery key remain visible above so you can save them manually.';
  }
});

document.querySelector('#toggle-member-key').addEventListener('click', (event) => {
  const field = document.querySelector('#member-token-output');
  const visible = field.type === 'password';
  field.type = visible ? 'text' : 'password';
  event.currentTarget.textContent = visible ? 'Hide recovery key' : 'Show recovery key';
});

document.querySelector('#restore-member').addEventListener('click', async () => {
  memberStatus.textContent = 'Checking your membership…';
  const memberId = document.querySelector('#recover-member-id').value.trim().toUpperCase();
  const memberToken = document.querySelector('#recover-member-token').value.trim();
  try {
    const response = await fetch('/api/members/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId, memberToken }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not restore this membership.');
    const member = { memberId: data.memberId, memberToken, displayName: data.displayName };
    try { localStorage.setItem('backscroll-member', JSON.stringify(member)); } catch { /* The credentials remain in the form for this visit. */ }
    updateMemberUI(member, { showCredentials: true, selectMember: true });
    document.querySelector('#member-recover').open = false;
    memberStatus.textContent = `Welcome back, ${member.displayName || member.memberId}. Your membership is ready on this device.`;
  } catch (error) {
    memberStatus.textContent = error.message || 'Could not restore this membership.';
  }
});
window.addEventListener('hashchange', () => {
  const id = new URLSearchParams(location.hash.slice(1)).get('moment');
  if (id) openMoment(id, false);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = 'Saving your memory…';
  const payload = Object.fromEntries(new FormData(form));
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (memberRadio.checked && activeMember) {
      headers['X-Member-ID'] = activeMember.memberId;
      headers['X-Member-Token'] = activeMember.memberToken;
    }
    const response = await fetch('/api/memories', { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save your memory.');
    const keepMemberMode = memberRadio.checked && Boolean(activeMember);
    form.reset();
    if (keepMemberMode) memberRadio.checked = true;
    status.textContent = data.message;
  } catch (error) {
    status.textContent = error.message || 'Could not save your memory. Please try again.';
  }
});

loadSeed();
