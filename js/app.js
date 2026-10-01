const panel = document.querySelector('.chat-panel');
const modal = document.querySelector('.lead-modal');
const messages = document.querySelector('.chat-messages');
const chatForm = document.querySelector('.chat-form');
const chatInput = document.querySelector('#chat-input');
const serviceSelect = document.querySelector('#leadServiceSelect');

let conversationId = null;

// Lead-form pacing: never re-open it after the visitor has sent their
// details, and after they close it, wait a few messages before offering again.
const MESSAGES_BEFORE_REOFFER = 3;
let leadSubmitted = false;
let messagesSinceDismiss = Infinity;

// ---- Load business config (branding, services) so this widget is reusable per client ----
async function loadBusinessConfig() {
  try {
    const res = await fetch('/api/config');
    const business = await res.json();
    if (business.brand_color) {
      document.documentElement.style.setProperty('--moss', business.brand_color);
    }
    if (business.name) {
      const headerName = document.querySelector('.chat-panel__header strong');
      if (headerName) headerName.textContent = `${business.name} Assistant`;
      document.title = document.title.replace('Northstar Plumbing', business.name);
    }
    if (Array.isArray(business.services) && serviceSelect) {
      business.services.forEach((service) => {
        const opt = document.createElement('option');
        opt.value = service;
        opt.textContent = service;
        serviceSelect.appendChild(opt);
      });
    }
  } catch {
    // Config endpoint unreachable — the page still works with its built-in defaults.
  }
}
loadBusinessConfig();

document.querySelectorAll('[data-open-chat]').forEach((button) =>
  button.addEventListener('click', () => {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    chatInput.focus();
  })
);
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
  return message;
}

function maybeOfferLeadForm(context) {
  if (leadSubmitted || messagesSinceDismiss < MESSAGES_BEFORE_REOFFER) return;
  setTimeout(() => showLeadForm(context), 450);
}

function closeLeadForm() {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  messagesSinceDismiss = 0;
}

function showLeadForm(context = '') {
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  const need = modal.querySelector('[name="need"]');
  need.value = context;
  modal.querySelector('[name="name"]').focus();
}

async function respond(message) {
  messagesSinceDismiss += 1;
  const typing = addMessage('Thinking…', 'assistant');
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, conversationId })
    });
    const data = await response.json();
    typing.remove();
    if (data.conversationId) conversationId = data.conversationId;
    addMessage(data.answer || "Sorry, I couldn't process that. Please try again.", 'assistant');

    // The server decides (from the AI's own judgement of the visitor's
    // intent). Its summary is in English, so it only pre-fills the "what do
    // you need" box for English-speaking visitors; others see their own words.
    if (data.suggestLeadCapture) {
      const english = !data.language || data.language === 'en';
      maybeOfferLeadForm(english && data.summary ? data.summary : message);
    }
  } catch {
    typing.remove();
    addMessage('Sorry, something went wrong. Please leave your details and the team will follow up.', 'assistant');
    maybeOfferLeadForm(message);
  }
}

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  addMessage(message, 'user');
  chatInput.value = '';
  respond(message);
});

document.querySelectorAll('.quick-replies button').forEach((button) =>
  button.addEventListener('click', () => {
    const message = button.textContent;
    addMessage(message, 'user');
    respond(message);
  })
);

document.querySelector('[data-close-lead]').addEventListener('click', closeLeadForm);
modal.addEventListener('click', (event) => {
  if (event.target === modal) closeLeadForm();
});

document.querySelector('.lead-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.get('name'),
        email: data.get('email'),
        serviceNeeded: data.get('service') || null,
        budget: data.get('budget') || null,
        message: data.get('need'),
        conversationId
      })
    });
    const result = await res.json();
    if (!res.ok) {
      addMessage(result.error || 'Could not save your details — please try again.', 'assistant');
      return;
    }
    form.reset();
    leadSubmitted = true;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    panel.classList.add('open');
    addMessage('Thanks — your request has been saved. A team member will be in touch shortly.', 'assistant');
  } catch {
    addMessage('Could not reach the server — please try again in a moment.', 'assistant');
  } finally {
    submitBtn.disabled = false;
  }
});
