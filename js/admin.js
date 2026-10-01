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

// Superadmins can switch between businesses; the chosen slug is sent with
// every admin API call. For owners the server ignores it and always uses
// their own business.
let selectedBusiness = null;

function adminUrl(path, params = {}) {
  const url = new URL(path, window.location.origin);
  if (selectedBusiness) url.searchParams.set('business', selectedBusiness);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.pathname + url.search;
}

// ---- Auth ----
async function checkSession() {
  const res = await fetch(adminUrl('/api/admin/session'));
  const data = await res.json();
  if (data.authenticated) {
    loginScreen.classList.add('hidden');
    adminShell.classList.remove('hidden');
    renderSessionInfo(data);
    loadAll();
  } else {
    loginScreen.classList.remove('hidden');
    adminShell.classList.add('hidden');
  }
}

function renderSessionInfo({ user, business, businesses }) {
  const displayName = user.name || user.email;
  document.getElementById('signedInAs').textContent = `Signed in as ${displayName}`;
  document.getElementById('dashboardGreeting').textContent = `${greeting()}, ${user.name || 'there'}.`;
  if (business) {
    selectedBusiness = user.role === 'superadmin' ? business.slug : null;
    document.getElementById('sidebarBusinessName').textContent = business.name;
    document.title = `${business.name} | Admin dashboard`;
  }

  const switcher = document.getElementById('businessSwitcher');
  const select = document.getElementById('businessSelect');
  if (user.role === 'superadmin' && Array.isArray(businesses) && businesses.length > 1) {
    select.innerHTML = businesses
      .map((b) => `<option value="${escapeHtml(b.slug)}">${escapeHtml(b.name)}</option>`)
      .join('');
    select.value = business ? business.slug : '';
    switcher.classList.remove('hidden');
  } else {
    switcher.classList.add('hidden');
  }
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

document.getElementById('businessSelect').addEventListener('change', (e) => {
  selectedBusiness = e.target.value;
  document.getElementById('conversationDetail').innerHTML =
    '<p class="empty-hint">Select a conversation to view its messages.</p>';
  checkSession();
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      loginError.textContent = data.error || 'Incorrect email or password';
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
  selectedBusiness = null;
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
  const res = await fetch(adminUrl('/api/admin/leads'));
  if (!res.ok) return;
  const { leads } = await res.json();
  renderLeads(leads || []);
}

function renderLeads(leads) {
  const rows = document.getElementById('lead-rows');
  const emptyHint = document.getElementById('empty-hint');
  document.getElementById('lead-count').textContent = leads.length;
  document.getElementById('metric-new').textContent = leads.length;
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
      await fetch(adminUrl('/api/admin/leads'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: select.dataset.leadId, status: select.value })
      });
    });
  });
}

// ---- Conversations ----
async function loadConversations() {
  const res = await fetch(adminUrl('/api/admin/conversations'));
  if (!res.ok) return;
  const { conversations } = await res.json();
  renderConversationList(conversations || []);
  document.getElementById('metric-handoff').textContent = (conversations || []).filter((c) => c.handoffRequested).length;
  document.getElementById('metric-priority').textContent = (conversations || []).filter((c) => c.intent === 'ready').length;
}

// "ar" → "Arabic", using the browser's built-in language names.
function languageName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
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
        <span class="pill-row">
          ${c.intent === 'ready' ? '<span class="pill">Ready to act</span>' : ''}
          ${c.handoffRequested ? '<span class="pill pill-warn">Needs follow-up</span>' : ''}
        </span>
      </span>
      ${c.summary ? `<span class="conversation-summary">${escapeHtml(c.summary)}</span>` : ''}
      <small>${c.messageCount} message${c.messageCount === 1 ? '' : 's'}${
        c.language ? ` · ${escapeHtml(languageName(c.language))}` : ''
      }</small>
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

  const res = await fetch(adminUrl('/api/admin/conversations', { id }));
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
  const res = await fetch(adminUrl('/api/admin/documents'));
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
      await fetch(adminUrl('/api/admin/documents', { id: btn.dataset.docId }), { method: 'DELETE' });
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
    const res = await fetch(adminUrl('/api/admin/documents'), {
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
  const res = await fetch(adminUrl('/api/admin/config'));
  if (!res.ok) return;
  const { business } = await res.json();
  if (!business) return;
  document.getElementById('cfgName').value = business.name || '';
  document.getElementById('cfgTagline').value = business.tagline || '';
  document.getElementById('cfgColor').value = business.brand_color || '#1d4ed8';
  document.getElementById('cfgNotifyEmail').value = business.notify_email || '';
  document.getElementById('cfgSystemPrompt').value = business.system_prompt || '';

  // Website embed: the one-line snippet for this business, and its allow-list.
  const slug = business.slug;
  document.getElementById('embedSnippet').value =
    `<script src="${window.location.origin}/widget.js" data-business="${slug}" async></script>`;
  document.getElementById('embedTestLink').href = `/embed-test.html?business=${encodeURIComponent(slug)}`;
  const origins = Array.isArray(business.allowed_origins) ? business.allowed_origins : [];
  document.getElementById('cfgAllowedOrigins').value = origins.join('\n');
  document.getElementById('embedHint').textContent = 'allowed_origins' in business
    ? (origins.length ? `Only these ${origins.length} website(s) can use the widget.` : 'Any website can use the widget right now.')
    : 'Run supabase/migrations/004_widget_allowed_origins.sql to restrict which websites can use the widget.';
}

document.getElementById('copySnippet').addEventListener('click', async () => {
  const snippet = document.getElementById('embedSnippet');
  try {
    await navigator.clipboard.writeText(snippet.value);
  } catch {
    snippet.select();
    document.execCommand('copy');
  }
  document.getElementById('embedHint').textContent = 'Copied.';
});

document.getElementById('embedForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const hint = document.getElementById('embedHint');
  const allowedOrigins = document
    .getElementById('cfgAllowedOrigins')
    .value.split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  hint.textContent = 'Saving…';
  try {
    const res = await fetch(adminUrl('/api/admin/config'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed_origins: allowedOrigins })
    });
    const data = await res.json();
    if (!res.ok) {
      hint.textContent = data.error || 'Could not save.';
      return;
    }
    loadSettings();
  } catch {
    hint.textContent = 'Could not reach the server.';
  }
});

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const hint = document.getElementById('settingsHint');
  hint.textContent = 'Saving…';
  try {
    const res = await fetch(adminUrl('/api/admin/config'), {
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
