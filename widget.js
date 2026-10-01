/*
 * AI Lead Assistant — embeddable chat widget.
 *
 * Add to any website, just before </body>:
 *
 *   <script src="https://YOUR-DEPLOYMENT/widget.js" data-business="your-business-slug" async></script>
 *
 * Optional attributes:
 *   data-position="left"        put the button bottom-left instead of bottom-right
 *   data-greeting="Hi there!"   replace the first message shown in the chat
 *   data-label="Ask us"         replace the text on the chat button
 *
 * Everything renders inside a Shadow DOM, so the host page's CSS can't break
 * the widget and the widget's CSS can't leak into the page. Branding (name,
 * colour, services) comes from /api/config for that business.
 */
(function () {
  'use strict';

  if (window.__aiLeadAssistantLoaded) return;
  window.__aiLeadAssistantLoaded = true;

  var script =
    document.currentScript ||
    Array.prototype.slice.call(document.querySelectorAll('script[src*="widget.js"][data-business]')).pop();
  if (!script) return;

  var business = script.getAttribute('data-business');
  if (!business) {
    console.warn('[AI assistant widget] Add data-business="your-business-slug" to the script tag.');
    return;
  }

  var API_BASE = new URL(script.src, window.location.href).origin;
  var POSITION = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var STORAGE_KEY = 'ai-lead-assistant:' + business + ':conversation';
  var MESSAGES_BEFORE_REOFFER = 3;
  var DEFAULT_COLOR = '#1d4ed8';

  var state = {
    conversationId: readStorage(),
    leadSubmitted: false,
    messagesSinceDismiss: Infinity,
    sending: false,
    config: { name: 'our team', brand_color: DEFAULT_COLOR, services: [] }
  };

  // ---- Storage (per tab; can be unavailable in private mode) ----
  function readStorage() {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }
  function writeStorage(value) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      /* ignore */
    }
  }

  // ---- Colours ----
  function safeColor(value) {
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value || '') ? value : DEFAULT_COLOR;
  }
  // White or near-black text, whichever reads better on the brand colour.
  function textOn(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var rgb = [0, 2, 4].map(function (i) {
      var c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    var luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return luminance > 0.45 ? '#111827' : '#ffffff';
  }

  // ---- Markup ----
  var STYLES = [
    ':host { all: initial; }',
    '*, *::before, *::after { box-sizing: border-box; }',
    '.root { position: fixed; bottom: 20px; ' + POSITION + ': 20px; z-index: 2147483000;',
    '  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 15px; line-height: 1.45; color: #111827; }',
    '.launcher { display: flex; align-items: center; gap: 8px; border: 0; border-radius: 999px; padding: 12px 18px;',
    '  background: var(--brand); color: var(--on-brand); font-family: inherit; font-size: 15px; font-weight: 600; line-height: 1; cursor: pointer;',
    '  box-shadow: 0 6px 24px rgba(0,0,0,.18); }',
    '.launcher:hover { filter: brightness(1.05); }',
    '.launcher:focus-visible, button:focus-visible, textarea:focus-visible, input:focus-visible, select:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }',
    '.launcher svg { width: 20px; height: 20px; }',
    '.panel { position: absolute; bottom: 64px; ' + POSITION + ': 0; width: 370px; height: min(560px, calc(100vh - 110px));',
    '  display: flex; flex-direction: column; background: #fff; border-radius: 16px; overflow: hidden;',
    '  box-shadow: 0 12px 48px rgba(0,0,0,.22); }',
    '.panel[hidden] { display: none; }',
    'header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px;',
    '  background: var(--brand); color: var(--on-brand); }',
    'header strong { display: block; font-size: 16px; }',
    'header small { display: block; font-size: 12.5px; opacity: .85; }',
    '.icon-btn { border: 0; background: transparent; color: inherit; font-size: 24px; line-height: 1; padding: 4px 8px; cursor: pointer; border-radius: 8px; }',
    '.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #f7f7f8; }',
    '.msg { max-width: 85%; padding: 10px 13px; border-radius: 14px; white-space: pre-wrap; word-wrap: break-word; }',
    '.msg.assistant { align-self: flex-start; background: #fff; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; }',
    '.msg.user { align-self: flex-end; background: var(--brand); color: var(--on-brand); border-bottom-right-radius: 4px; }',
    '.msg.notice { align-self: center; background: transparent; color: #6b7280; font-size: 13px; text-align: center; }',
    '.typing { display: inline-flex; gap: 4px; padding: 14px 13px; }',
    '.typing span { width: 6px; height: 6px; border-radius: 50%; background: #9ca3af; animation: blink 1.2s infinite; }',
    '.typing span:nth-child(2) { animation-delay: .2s; } .typing span:nth-child(3) { animation-delay: .4s; }',
    '@keyframes blink { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }',
    'form.composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e7eb; background: #fff; }',
    'textarea, input, select { font: inherit; font-size: 15px; color: #111827; border: 1px solid #d1d5db; border-radius: 10px; padding: 9px 11px; background: #fff; }',
    'form.composer textarea { flex: 1; resize: none; max-height: 110px; }',
    '.send { border: 0; border-radius: 10px; width: 44px; background: var(--brand); color: var(--on-brand); font-size: 18px; cursor: pointer; }',
    '.send:disabled { opacity: .5; cursor: default; }',
    '.note { margin: 0; padding: 0 12px 10px; font-size: 11.5px; color: #6b7280; background: #fff; }',
    '.lead { position: absolute; inset: 0; background: rgba(17,24,39,.45); display: flex; align-items: flex-end; }',
    '.lead[hidden] { display: none; }',
    '.lead-card { width: 100%; background: #fff; border-radius: 16px 16px 0 0; padding: 18px 16px; max-height: 100%; overflow-y: auto; }',
    '.lead-card h2 { margin: 0 0 4px; font-size: 17px; }',
    '.lead-card p { margin: 0 0 12px; font-size: 13.5px; color: #4b5563; }',
    '.lead-card form { display: flex; flex-direction: column; gap: 10px; }',
    '.lead-card label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; color: #374151; }',
    '.lead-actions { display: flex; gap: 8px; margin-top: 4px; }',
    '.primary { flex: 1; border: 0; border-radius: 10px; padding: 11px; background: var(--brand); color: var(--on-brand); font: inherit; font-weight: 600; cursor: pointer; }',
    '.secondary { border: 1px solid #d1d5db; border-radius: 10px; padding: 11px 14px; background: #fff; color: #374151; font: inherit; cursor: pointer; }',
    '.error { color: #b91c1c; font-size: 13px; min-height: 1em; margin: 0; }',
    '@media (max-width: 480px) {',
    '  .root { bottom: 12px; ' + POSITION + ': 12px; }',
    '  .panel { position: fixed; inset: 0; width: auto; height: auto; border-radius: 0; }',
    '  .root.open .launcher { display: none; }',
    '}'
  ].join('\n');

  var CHAT_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  // Static markup only — every piece of business or visitor text is set with
  // textContent below, never as HTML.
  var MARKUP =
    '<div class="root">' +
    '  <section class="panel" role="dialog" aria-label="Chat" hidden>' +
    '    <header><div><strong class="title"></strong><small>Usually replies in seconds</small></div>' +
    '      <button class="icon-btn close" type="button" aria-label="Close chat">&times;</button></header>' +
    '    <div class="messages" aria-live="polite"></div>' +
    '    <form class="composer">' +
    '      <textarea rows="1" maxlength="2000" placeholder="Type your message…" aria-label="Your message"></textarea>' +
    '      <button class="send" type="submit" aria-label="Send message">&uarr;</button>' +
    '    </form>' +
    '    <p class="note">AI assistant. The team may review this chat to follow up on your enquiry.</p>' +
    '    <div class="lead" hidden>' +
    '      <div class="lead-card" role="dialog" aria-label="Leave your details">' +
    '        <h2>Where should the team reply?</h2>' +
    '        <p>Leave your details and someone will get back to you shortly.</p>' +
    '        <form class="lead-form">' +
    '          <label>Name<input name="name" autocomplete="name" required maxlength="120"></label>' +
    '          <label>Email<input name="email" type="email" autocomplete="email" required maxlength="200"></label>' +
    '          <label class="service-field" hidden>What do you need?<select name="service"><option value="">Not sure yet</option></select></label>' +
    '          <label>Message<textarea name="need" rows="3" required maxlength="2000"></textarea></label>' +
    '          <p class="error lead-error" role="alert"></p>' +
    '          <div class="lead-actions"><button class="secondary not-now" type="button">Not now</button>' +
    '            <button class="primary" type="submit">Send</button></div>' +
    '        </form>' +
    '      </div>' +
    '    </div>' +
    '  </section>' +
    '  <button class="launcher" type="button" aria-label="Open chat">' + CHAT_ICON + '<span class="launcher-label"></span></button>' +
    '</div>';

  var host = document.createElement('div');
  host.setAttribute('data-ai-lead-assistant', business);
  var shadow = host.attachShadow({ mode: 'open' });
  var style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);
  var wrapper = document.createElement('div');
  wrapper.innerHTML = MARKUP;
  shadow.appendChild(wrapper.firstChild);

  function $(selector) {
    return shadow.querySelector(selector);
  }
  var root = $('.root');
  var panel = $('.panel');
  var launcher = $('.launcher');
  var messages = $('.messages');
  var composer = $('form.composer');
  var input = $('form.composer textarea');
  var sendButton = $('.send');
  var lead = $('.lead');
  var leadForm = $('.lead-form');
  var leadError = $('.lead-error');

  $('.launcher-label').textContent = script.getAttribute('data-label') || 'Chat with us';

  function applyBranding() {
    var color = safeColor(state.config.brand_color);
    root.style.setProperty('--brand', color);
    root.style.setProperty('--on-brand', textOn(color));
    $('.title').textContent = state.config.name ? state.config.name + ' Assistant' : 'Assistant';

    var services = Array.isArray(state.config.services) ? state.config.services : [];
    var select = leadForm.querySelector('select[name="service"]');
    while (select.options.length > 1) select.remove(1);
    services.forEach(function (service) {
      var option = document.createElement('option');
      option.value = service;
      option.textContent = service;
      select.appendChild(option);
    });
    leadForm.querySelector('.service-field').hidden = services.length === 0;
  }

  function addMessage(text, role) {
    var el = document.createElement('div');
    el.className = 'msg ' + role;
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  function showTyping() {
    var el = document.createElement('div');
    el.className = 'msg assistant typing';
    el.setAttribute('aria-label', 'Assistant is typing');
    el.innerHTML = '<span></span><span></span><span></span>';
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  var greeted = false;
  function openPanel() {
    panel.hidden = false;
    root.classList.add('open');
    launcher.setAttribute('aria-expanded', 'true');
    if (!greeted) {
      greeted = true;
      addMessage(
        script.getAttribute('data-greeting') ||
          'Hi! I can answer questions about ' + (state.config.name || 'us') + '. What can I help you with?',
        'assistant'
      );
    }
    input.focus();
  }
  function closePanel() {
    panel.hidden = true;
    root.classList.remove('open');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  // ---- Lead form ----
  function maybeOfferLeadForm(context) {
    if (state.leadSubmitted || state.messagesSinceDismiss < MESSAGES_BEFORE_REOFFER) return;
    setTimeout(function () {
      leadForm.querySelector('[name="need"]').value = context || '';
      leadError.textContent = '';
      lead.hidden = false;
      leadForm.querySelector('[name="name"]').focus();
    }, 450);
  }
  function closeLeadForm() {
    lead.hidden = true;
    state.messagesSinceDismiss = 0;
    input.focus();
  }

  // ---- API ----
  function api(path, options) {
    return fetch(API_BASE + path, options).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
    });
  }

  function send(text) {
    if (state.sending) return;
    state.sending = true;
    sendButton.disabled = true;
    state.messagesSinceDismiss += 1;
    addMessage(text, 'user');
    var typing = showTyping();

    api('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, conversationId: state.conversationId, business: business })
    })
      .then(function (result) {
        typing.remove();
        var data = result.data || {};
        if (data.conversationId) {
          state.conversationId = data.conversationId;
          writeStorage(data.conversationId);
        }
        addMessage(data.answer || data.error || "Sorry, I couldn't process that. Please try again.", 'assistant');
        if (data.suggestLeadCapture) {
          // The summary is English; use it only for English-speaking visitors.
          var english = !data.language || data.language === 'en';
          maybeOfferLeadForm(english && data.summary ? data.summary : text);
        }
      })
      .catch(function () {
        typing.remove();
        addMessage("Sorry, I couldn't reach the server. Please leave your details and the team will follow up.", 'assistant');
        maybeOfferLeadForm(text);
      })
      .then(function () {
        state.sending = false;
        sendButton.disabled = false;
      });
  }

  // ---- Events ----
  launcher.addEventListener('click', function () {
    if (panel.hidden) openPanel();
    else closePanel();
  });
  $('.close').addEventListener('click', closePanel);
  root.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (!lead.hidden) closeLeadForm();
    else if (!panel.hidden) closePanel();
  });

  composer.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = '';
    send(text);
  });
  input.addEventListener('keydown', function (event) {
    // Enter sends; Shift+Enter adds a new line.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      composer.requestSubmit ? composer.requestSubmit() : composer.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 110) + 'px';
  });

  $('.not-now').addEventListener('click', closeLeadForm);
  leadForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var form = new FormData(leadForm);
    var submit = leadForm.querySelector('.primary');
    submit.disabled = true;
    leadError.textContent = '';

    api('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        email: form.get('email'),
        serviceNeeded: form.get('service') || null,
        message: form.get('need'),
        conversationId: state.conversationId,
        business: business
      })
    })
      .then(function (result) {
        if (!result.ok) {
          leadError.textContent = (result.data && result.data.error) || 'Could not send your details. Please try again.';
          return;
        }
        state.leadSubmitted = true;
        leadForm.reset();
        lead.hidden = true;
        addMessage('Thanks! Your details have been sent, and the team will be in touch shortly.', 'assistant');
      })
      .catch(function () {
        leadError.textContent = 'Could not reach the server. Please try again in a moment.';
      })
      .then(function () {
        submit.disabled = false;
      });
  });

  // ---- Start ----
  function mount() {
    document.body.appendChild(host);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  applyBranding();
  api('/api/config?business=' + encodeURIComponent(business))
    .then(function (result) {
      if (result.status === 403) {
        console.warn('[AI assistant widget] This website is not in the allowed list for "' + business + '".');
        host.remove();
        return;
      }
      if (!result.ok) {
        console.warn('[AI assistant widget] Unknown business "' + business + '".');
        return;
      }
      state.config = result.data;
      applyBranding();
    })
    .catch(function () {
      /* keep defaults; the chat itself will report connection problems */
    });
})();
