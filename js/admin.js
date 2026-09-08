const loginScreen = document.getElementById('loginScreen');
const adminShell = document.getElementById('adminShell');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

function escapeHtml(value) {
  const el = document.createElement('div');
  el.textContent = value == null ? '' : String(value);
  return el.innerHTML;
}
function formatDate(iso) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

// ---- Auth ----
async function checkSession() {
  const res = await fetch('/api/admin/session');
  const data = await res.json();
  if (data.authenticated) {
    loginScreen.classList.add('hidden');
    adminShell.classList.remove('hidden');
    loadAll();
  } else {
    loginScreen.classList.remove('hidden');
    adminShell.classList.add('hidden');
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const password = document.getElementById('loginPassword').value;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) {
      loginError.textContent = data.error || 'Incorrect password';
      return;
    }
    loginForm.reset();
    checkSession();
  } catch {
    loginError.textContent = 'Could not reach the server. Please try again.';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  checkSession();
});

// ---- Tabs ----
document.querySelectorAll('.tab-link[data-tab]').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.tab-link[data-tab]').forEach((l) => l.classList.remove('active'));
    link.classList.add('active');
    const target = link.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.panel !== target);
    });
  });
});

function loadAll() {
  loadLeads();
  loadConversations();
  loadDocuments();
  loadSettings();
}

// ---- Leads ----
async function loadLeads() {
  const res = await fetch('/api/admin/leads');
  if (!res.ok) return;
  const { leads } = await res.json();
  renderLeads(leads || []);
}

function renderLeads(leads) {
  const rows = document.getElementById('lead-rows');
  const emptyHint = document.getElementById('empty-hint');
  document.getElementById('lead-count').textContent = leads.length;
  document.getElementById('metric-new').textContent = leads.length;
  document.getElementById('metric-priority').textContent = leads.filter((l) =>
    /leak|repair|emergency|burst|block/i.test(`${l.service_needed || ''} ${l.message || ''}`)
  ).length;
  emptyHint.hidden = leads.length > 0;

  if (!leads.length) {
    rows.innerHTML = '<tr><td colspan="6">No leads have been captured yet.</td></tr>';
    return;
  }

  rows.innerHTML = leads
    .map(
      (lead) => `
    <tr>
      <td><strong>${escapeHtml(lead.name)}</strong><small>${escapeHtml(lead.email)}</small></td>
      <td>${escapeHtml(lead.service_needed || '—')}</td>
      <td>${escapeHtml(lead.budget || '—')}</td>
      <td class="request-cell">${escapeHtml(lead.message || '—')}</td>
      <td>${formatDate(lead.created_at)}</td>
      <td>
        <select class="status-select" data-lead-id="${lead.id}">
          ${['new', 'contacted', 'won', 'lost']
            .map((s) => `<option value="${s}" ${s === lead.status ? 'selected' : ''}>${s}</option>`)
            .join('')}
        </select>
      </td>
    </tr>`
    )
    .join('');

  rows.querySelectorAll('.status-select').forEach((select) => {
    select.addEventListener('change', async () => {
      await fetch('/api/admin/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: select.dataset.leadId, status: select.value })
      });
    });
  });
}

// ---- Conversations ----
async function loadConversations() {
  const res = await fetch('/api/admin/conversations');
  if (!res.ok) return;
  const { conversations } = await res.json();
  renderConversationList(conversations || []);
  document.getElementById('metric-handoff').textContent = (conversations || []).filter((c) => c.handoffRequested).length;
}

function renderConversationList(conversations) {
  const list = document.getElementById('conversationList');
  if (!conversations.length) {
    list.innerHTML = '<p class="empty-hint">No conversations yet.</p>';
    return;
  }
  list.innerHTML = conversations
    .map(
      (c) => `
    <button class="conversation-item" data-id="${c.id}" type="button">
      <span class="conversation-item-top">
        <strong>${formatDate(c.lastMessageAt)}</strong>
        ${c.handoffRequested ? '<span class="pill pill-warn">Needs follow-up</span>' : ''}
      </span>
      <small>${c.messageCount} message${c.messageCount === 1 ? '' : 's'}</small>
    </button>`
    )
    .join('');

  list.querySelectorAll('.conversation-item').forEach((item) => {
    item.addEventListener('click', () => loadConversationDetail(item.dataset.id, item));
  });
}

async function loadConversationDetail(id, itemEl) {
  document.querySelectorAll('.conversation-item').forEach((el) => el.classList.remove('active'));
  if (itemEl) itemEl.classList.add('active');

  const detail = document.getElementById('conversationDetail');
  detail.innerHTML = '<p class="empty-hint">Loading…</p>';

  const res = await fetch(`/api/admin/conversations?id=${encodeURIComponent(id)}`);
  if (!res.ok) {
    detail.innerHTML = '<p class="empty-hint">Could not load this conversation.</p>';
    return;
  }
  const { messages } = await res.json();
  if (!messages || !messages.length) {
    detail.innerHTML = '<p class="empty-hint">No messages in this conversation.</p>';
    return;
  }
  detail.innerHTML = messages
    .map((m) => `<div class="admin-message ${m.role}"><span>${escapeHtml(m.content)}</span></div>`)
    .join('');
}

// ---- Knowledge base ----
async function loadDocuments() {
  const res = await fetch('/api/admin/documents');
  if (!res.ok) return;
  const { documents } = await res.json();
  renderDocuments(documents || []);
}

function renderDocuments(documents) {
  const list = document.getElementById('documentList');
  if (!documents.length) {
    list.innerHTML = '<p class="empty-hint">No documents added yet — the assistant is running on its base instructions only.</p>';
    return;
  }
  list.innerHTML = documents
    .map(
      (d) => `
    <div class="document-item">
      <div>
        <strong>${escapeHtml(d.name)}</strong>
        <small>${d.chunkCount} chunk${d.chunkCount === 1 ? '' : 's'} · added ${formatDate(d.createdAt)}</small>
      </div>
      <button class="icon-button" data-doc-id="${d.id}" type="button" aria-label="Delete document">×</button>
    </div>`
    )
    .join('');

  list.querySelectorAll('[data-doc-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this document from the knowledge base?')) return;
      await fetch(`/api/admin/documents?id=${encodeURIComponent(btn.dataset.docId)}`, { method: 'DELETE' });
      loadDocuments();
    });
  });
}

document.getElementById('documentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const hint = document.getElementById('docHint');
  const name = document.getElementById('docName').value.trim();
  const content = document.getElementById('docContent').value.trim();
  if (!name || !content) return;

  hint.textContent = 'Indexing document…';
  try {
    const res = await fetch('/api/admin/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content })
    });
    const data = await res.json();
    if (!res.ok) {
      hint.textContent = data.error || 'Could not add document.';
      return;
    }
    hint.textContent = `Added — indexed into ${data.chunkCount} chunks.`;
    document.getElementById('documentForm').reset();
    loadDocuments();
  } catch {
    hint.textContent = 'Could not reach the server.';
  }
});

// ---- Settings ----
async function loadSettings() {
  const res = await fetch('/api/admin/config');
  if (!res.ok) return;
  const { business } = await res.json();
  if (!business) return;
  document.getElementById('dashboardGreeting').textContent = `Good morning, Saad.`;
  document.getElementById('cfgName').value = business.name || '';
  document.getElementById('cfgTagline').value = business.tagline || '';
  document.getElementById('cfgColor').value = business.brand_color || '#1d4ed8';
  document.getElementById('cfgNotifyEmail').value = business.notify_email || '';
  document.getElementById('cfgSystemPrompt').value = business.system_prompt || '';
}

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const hint = document.getElementById('settingsHint');
  hint.textContent = 'Saving…';
  try {
    const res = await fetch('/api/admin/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('cfgName').value.trim(),
        tagline: document.getElementById('cfgTagline').value.trim(),
        brand_color: document.getElementById('cfgColor').value,
        notify_email: document.getElementById('cfgNotifyEmail').value.trim(),
        system_prompt: document.getElementById('cfgSystemPrompt').value.trim()
      })
    });
    const data = await res.json();
    hint.textContent = res.ok ? 'Saved.' : data.error || 'Could not save settings.';
  } catch {
    hint.textContent = 'Could not reach the server.';
  }
});

checkSession();
