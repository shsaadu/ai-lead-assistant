const leadRows = document.querySelector('#lead-rows');
const leadCount = document.querySelector('#lead-count');
const metricNew = document.querySelector('#metric-new');
const metricPriority = document.querySelector('#metric-priority');
const emptyHint = document.querySelector('#empty-hint');

function readLeads() { return JSON.parse(localStorage.getItem('northstar-leads') || '[]'); }
function escapeHtml(value) { const el = document.createElement('div'); el.textContent = value; return el.innerHTML; }
function formatDate(iso) { return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); }
function render() {
  const leads = readLeads();
  leadRows.innerHTML = leads.map((lead) => `<tr><td><strong>${escapeHtml(lead.name)}</strong><small>${escapeHtml(lead.email)}</small></td><td class="request-cell">${escapeHtml(lead.need)}</td><td>${formatDate(lead.createdAt)}</td><td><span class="pill">New lead</span></td></tr>`).join('');
  leadCount.textContent = leads.length;
  metricNew.textContent = leads.length;
  metricPriority.textContent = leads.filter((lead) => /leak|repair|emergency|burst|block/i.test(lead.need)).length;
  emptyHint.hidden = leads.length > 0;
  if (!leads.length) leadRows.innerHTML = '<tr><td colspan="4">No leads have been captured yet.</td></tr>';
}
document.querySelector('#clear-leads').addEventListener('click', () => { localStorage.removeItem('northstar-leads'); render(); });
render();
