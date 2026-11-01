const tokenField = document.querySelector('#admin-token');
const connectButton = document.querySelector('#connect-button');
const refreshButton = document.querySelector('#refresh-button');
const list = document.querySelector('#admin-list');
const queueCount = document.querySelector('#queue-count');
const adminStatus = document.querySelector('#admin-status');
let token = sessionStorage.getItem('backscroll-admin-token') || '';
tokenField.value = token;

function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
function formatDate(value) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }

async function loadQueue() {
  token = tokenField.value.trim();
  if (!token) { adminStatus.textContent = 'Enter the editor token to continue.'; return; }
  adminStatus.textContent = 'Loading the review queue…';
  try {
    const response = await fetch('/api/admin/memories', { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load the review queue.');
    sessionStorage.setItem('backscroll-admin-token', token);
    refreshButton.hidden = false;
    queueCount.textContent = `${data.memories.length} PENDING ${data.memories.length === 1 ? 'MEMORY' : 'MEMORIES'}`;
    list.innerHTML = data.memories.length ? data.memories.map((memory) => `<article class="review-card" data-id="${escapeHtml(memory.id)}"><p class="review-text">“${escapeHtml(memory.text)}”</p><div class="review-meta"><span>ERA: ${escapeHtml(memory.era || 'NOT GIVEN')}</span><span>PLACE: ${escapeHtml(memory.region || 'NOT GIVEN')}</span><span>LANGUAGE: ${escapeHtml(memory.language || 'NOT GIVEN')}</span><span>MEMBER: ${escapeHtml(memory.memberId ? `${memory.memberDisplayName ? `${memory.memberDisplayName} · ` : ''}${memory.memberId}` : 'ANONYMOUS')}</span><span>SUBMITTED: ${escapeHtml(formatDate(memory.createdAt))}</span></div><div class="review-actions"><button data-status="rejected">Reject</button><button class="approve-button" data-status="approved">Approve</button></div></article>`).join('') : '<div class="admin-empty">The queue is clear. Thank you for keeping the archive thoughtful.</div>';
    adminStatus.textContent = '';
  } catch (error) {
    sessionStorage.removeItem('backscroll-admin-token');
    adminStatus.textContent = error.message;
    queueCount.textContent = 'REVIEW QUEUE UNAVAILABLE';
    list.innerHTML = '';
  }
}

async function reviewMemory(button) {
  const card = button.closest('.review-card');
  const buttons = card.querySelectorAll('button');
  buttons.forEach((item) => { item.disabled = true; });
  try {
    const response = await fetch(`/api/admin/memories/${encodeURIComponent(card.dataset.id)}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ status: button.dataset.status }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not update this memory.');
    adminStatus.textContent = button.dataset.status === 'approved' ? 'Memory approved and published.' : 'Memory rejected.';
    await loadQueue();
  } catch (error) {
    adminStatus.textContent = error.message;
    buttons.forEach((item) => { item.disabled = false; });
  }
}

connectButton.addEventListener('click', loadQueue);
refreshButton.addEventListener('click', loadQueue);
tokenField.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadQueue(); });
list.addEventListener('click', (event) => { const button = event.target.closest('button[data-status]'); if (button) reviewMemory(button); });
if (token) loadQueue();
