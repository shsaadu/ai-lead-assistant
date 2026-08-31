const panel = document.querySelector('.chat-panel');
const modal = document.querySelector('.lead-modal');
const messages = document.querySelector('.chat-messages');
const chatForm = document.querySelector('.chat-form');
const chatInput = document.querySelector('#chat-input');

document.querySelectorAll('[data-open-chat]').forEach((button) => button.addEventListener('click', () => {
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  chatInput.focus();
}));
document.querySelector('[data-close-chat]').addEventListener('click', () => {
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
});

function addMessage(text, role) {
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.textContent = text;
  messages.appendChild(message);
  messages.scrollTop = messages.scrollHeight;
}

function showLeadForm(context = '') {
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  const need = modal.querySelector('[name="need"]');
  need.value = context;
  modal.querySelector('[name="name"]').focus();
}

function needsLeadCapture(message) {
  return /book|quote|repair|leak|call|visit|plumber|emergency/i.test(message);
}

async function respond(message) {
  const typing = document.createElement('div');
  typing.className = 'message assistant';
  typing.textContent = 'Thinking…';
  messages.appendChild(typing);
  messages.scrollTop = messages.scrollHeight;
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
    if (!response.ok) throw new Error('Assistant unavailable');
    const data = await response.json();
    typing.remove();
    addMessage(data.answer, 'assistant');
  } catch {
    typing.remove();
    const fallback = needsLeadCapture(message)
      ? 'I can help with that. Share a few details and the team can let you know the next available appointment.'
      : 'We handle emergency repairs, installations, and general plumbing maintenance across South East England. Would you like to request a visit or a quote?';
    addMessage(fallback, 'assistant');
  }
  if (needsLeadCapture(message)) setTimeout(() => showLeadForm(message), 450);
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  addMessage(message, 'user');
  chatInput.value = '';
  respond(message);
});
document.querySelectorAll('.quick-replies button').forEach((button) => button.addEventListener('click', () => {
  const message = button.textContent;
  addMessage(message, 'user');
  respond(message);
}));
document.querySelector('[data-close-lead]').addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('click', (event) => { if (event.target === modal) modal.classList.remove('open'); });

document.querySelector('.lead-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const lead = { id: crypto.randomUUID(), name: form.get('name'), email: form.get('email'), need: form.get('need'), createdAt: new Date().toISOString() };
  const leads = JSON.parse(localStorage.getItem('northstar-leads') || '[]');
  leads.unshift(lead);
  localStorage.setItem('northstar-leads', JSON.stringify(leads));
  event.currentTarget.reset();
  modal.classList.remove('open');
  addMessage('Thanks — your request has been saved. A team member will be in touch shortly.', 'assistant');
});
