/**
 * Aldbridge Dental demo site: "See what the practice sees".
 *
 * Adds a button to the real demo website. It opens a drawer showing the patient's phone and the
 * practice's back office, driven by what the visitor really does with Ava, the real chat:
 *   - Ava's own answers tell us how ready the visitor is to book and which language they use.
 *   - When the visitor leaves their details, the demo keeps them in the browser (nothing is sent
 *     to Assist Street's database or to anyone's inbox) and starts the practice's automations.
 *   - The "Book online" buttons open a booking step instead of just opening the chat.
 * The practice's system, bookings, reminders and invoices are simulated, with made-up people.
 * Assist Street never handles payments. If anything here fails to load, the site works as before.
 */
(function () {
  'use strict';

  var BASE = '/demo/aldbridge-dental/';
  var OPTIONAL = ['/assets/doc-reader.js', '/assets/doc-samples.js'];   // the paperwork tab; the demo works without them
  var SCRIPTS = ['/assets/automation-engine.js', '/assets/docs-view.js', BASE + 'journey/phone.js', BASE + 'journey/hub.js'];
  var CLINIC = { owner: 'reception@aldbridgedental.example', manager: 'practice.manager@aldbridgedental.example', operator: 'support@assiststreet.example' };
  var TREATMENTS = ['Check-up', 'Hygiene / scale and polish', 'Emergency / toothache', 'Invisalign consultation', 'Implant consultation', 'Whitening or cosmetic'];
  var SUPPORTED = { en: 1, es: 1, ar: 1 };

  var insights = { intent: 'other', language: 'en', suggest: false };
  var backend = window.fetch.bind(window);
  var engine = null, phoneView = null, loading = null, current = '', drawer = null, toastTimer = 0;

  function $(id) { return document.getElementById(id); }
  function make(tag, attrs, html) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(v) { var d = document.createElement('div'); d.textContent = v == null ? '' : String(v); return d.innerHTML; }

  /* ---------- watching the real chat ---------- */
  function pathOf(input) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    try { return new URL(url, location.href).pathname; } catch (e) { return ''; }
  }
  window.fetch = function (input, init) {
    var path = pathOf(input);
    if (path === '/api/leads' && init && String(init.method || '').toUpperCase() === 'POST') return interceptLead(init);
    var p = backend(input, init);
    if (path === '/api/chat') {
      p.then(function (res) { return res.clone().json(); })
        .then(function (data) { insights = { intent: data.intent || 'other', language: String(data.language || insights.language || 'en').slice(0, 2).toLowerCase(), suggest: !!data.suggestLeadCapture }; })
        .catch(function () {});
    }
    return p;
  };

  /** Which language to write the patient's messages in, and a note if their own language is not covered by this demo. */
  function languageFor() {
    var code = insights.language;
    if (SUPPORTED[code]) return { code: code, note: '' };
    var name = code;
    try { name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch (e) {}
    return { code: 'en', note: 'Ava understood this visitor in ' + name + '. This demo writes patient messages in English, Spanish or Arabic, so these are in English.' };
  }

  function interceptLead(init) {
    var body = {};
    try { body = JSON.parse(init.body); } catch (e) {}
    var lang = languageFor();
    var email = String(body.email || body.phone || 'no-contact@example.com').trim();
    var data = {
      name: String(body.name || 'Patient').trim(),
      email: email,
      message: [body.serviceNeeded, body.message].filter(Boolean).join(': ') || 'Enquiry',
      intent: insights.intent === 'ready' ? 'ready' : insights.suggest ? 'person' : 'looking',
      lang: lang.code
    };
    load().then(function () { return engine.submitLead(data); }).then(function () {
      current = email; if (phoneView) phoneView.select(email);
      pulse();
      toast('The practice has ' + data.name.split(' ')[0] + "'s details. Want to pick a time now? Or open “See what the practice sees” to follow what happens next." + (lang.note ? ' ' + lang.note : ''), { label: 'Choose a time', run: openBooking });
    }).catch(function () {});
    // The visitor sees the normal "thank you". Their details stay in this browser.
    return Promise.resolve(new Response(JSON.stringify({ success: true, leadId: 'demo-' + Date.now(), emailSent: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }

  /* ---------- loading the engine and the two screens (only when needed) ---------- */
  function addScript(src) { return new Promise(function (ok, bad) { var s = make('script', { src: src }); s.onload = ok; s.onerror = function () { bad(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }
  function load() {
    if (loading) return loading;
    var optional = OPTIONAL.reduce(function (p, src) { return p.then(function () { return addScript(src); }); }, Promise.resolve()).catch(function () {});
    loading = optional.then(function () { return SCRIPTS.reduce(function (p, src) { return p.then(function () { return addScript(src); }); }, Promise.resolve()); }).then(function () {
      ['journey/views.css', null].forEach(function (f) { document.head.appendChild(make('link', { rel: 'stylesheet', href: f ? BASE + f : '/assets/docs-view.css' })); });
      buildDrawer();
      engine = AssistEngine.create(CLINIC);
      phoneView = PhoneView.mount($('bts-phone'), engine);
      HubView.mount($('bts-hub'), engine);
      setInterval(function () { if (!document.hidden) engine.advance(0.25); }, 250);
      api.engine = engine;
      return engine;
    }).catch(function (e) { loading = null; toast('The behind-the-scenes view could not load. The website itself still works.'); throw e; });
    return loading;
  }

  /* ---------- the button, the toast and the drawer ---------- */
  function buildButton() {
    var b = make('button', { id: 'bts-open', type: 'button', class: 'bts-open', 'aria-expanded': 'false' }, '<span class="bts-dot" aria-hidden="true"></span>See what the practice sees');
    b.addEventListener('click', function () { openDrawer(); });
    document.body.appendChild(b);
    document.body.appendChild(make('div', { id: 'bts-toast', class: 'bts-toast', role: 'status', 'aria-live': 'polite', hidden: '' }));
  }
  function toast(text, action) {
    var t = $('bts-toast'); if (!t) return;
    t.textContent = text;
    if (action) {
      var b = make('button', { type: 'button', class: 'bts-toast-go' }, action.label);
      b.addEventListener('click', function () { t.hidden = true; action.run(); });
      t.appendChild(b);
    }
    t.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, action ? 20000 : 9000);
  }
  function pulse() { var b = $('bts-open'); if (b) { b.classList.add('bts-pulse'); } }
  function buildDrawer() {
    if (drawer) return;
    drawer = make('aside', { id: 'bts-drawer', class: 'bts-drawer', role: 'dialog', 'aria-label': 'What the practice sees', 'data-view': 'phone', hidden: '' },
      '<header class="bts-head"><div><b>What the practice sees</b><small>Simulated, with made-up people. Assist Street never handles payments.</small></div><button id="bts-close" class="bts-x" type="button" aria-label="Close">×</button></header>' +
      '<div class="bts-controls" role="group" aria-label="Demo controls"><span class="bts-tag">Demo controls</span>' +
      '<button type="button" data-skip="60">+1 hour</button><button type="button" data-skip="1440">+1 day</button><button type="button" data-skip="10080">+1 week</button>' +
      '<label>Patient system <select id="bts-mode"><option value="up">Working</option><option value="error">Erroring</option><option value="down">Down</option><option value="slow">Too slow</option></select></label>' +
      '<button type="button" id="bts-reset">Reset</button></div>' +
      '<div class="bts-tabs" role="tablist"><button type="button" data-view="phone" class="on" role="tab">The patient\'s phone</button><button type="button" data-view="hub" role="tab">The practice\'s back office</button></div>' +
      '<div class="bts-body"><div class="bts-col bts-phonecol"><div id="bts-phone"></div></div><div class="bts-col bts-hubcol"><div id="bts-hub"></div></div></div>');
    document.body.appendChild(drawer);
    $('bts-close').addEventListener('click', closeDrawer);
    drawer.querySelectorAll('[data-skip]').forEach(function (b) { b.addEventListener('click', function () { engine.skip(Number(b.dataset.skip)); }); });
    $('bts-mode').addEventListener('change', function (e) { engine.setMode(e.target.value); });
    $('bts-reset').addEventListener('click', function () { engine.reset(); $('bts-mode').value = 'up'; });
    drawer.querySelectorAll('.bts-tabs button').forEach(function (b) {
      b.addEventListener('click', function () { drawer.dataset.view = b.dataset.view; drawer.querySelectorAll('.bts-tabs button').forEach(function (x) { x.classList.toggle('on', x === b); }); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if ($('bts-book')) closeBooking(); else closeDrawer(); } });
  }
  function openDrawer(view) {
    return load().then(function () {
      try { if (window.AILeadAssistant && AILeadAssistant.close) AILeadAssistant.close(); } catch (e) {}
      drawer.hidden = false; document.documentElement.classList.add('bts-on');
      $('bts-open').setAttribute('aria-expanded', 'true'); $('bts-open').classList.remove('bts-pulse');
      if (view) { drawer.dataset.view = view; drawer.querySelectorAll('.bts-tabs button').forEach(function (x) { x.classList.toggle('on', x.dataset.view === view); }); }
      $('bts-close').focus();
    }).catch(function () {});
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.hidden = true; document.documentElement.classList.remove('bts-on');
    $('bts-open').setAttribute('aria-expanded', 'false'); $('bts-open').focus();
  }

  /* ---------- the booking step ---------- */
  function openBooking() {
    load().then(function () {
      if ($('bts-book')) return;
      var known = engine.state.saved.filter(function (l) { return l.email.toLowerCase() === current.toLowerCase(); })[0] || engine.state.saved[0] || { name: '', email: '' };
      var hasBooking = engine.state.bookings.some(function (b) { return b.leadId === known.id && b.status === 'booked'; });
      var slots = Object.keys(engine.SLOTS).map(function (k, i) { return '<label class="bts-slot"><input type="radio" name="slot" value="' + k + '"' + (k === 'd1' ? ' checked' : '') + '><span>' + esc(engine.SLOTS[k].label) + '</span></label>'; }).join('');
      var treat = TREATMENTS.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('');
      var m = make('div', { id: 'bts-book', class: 'bts-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Book an appointment' },
        '<div class="bts-card"><button type="button" class="bts-x" id="bts-book-x" aria-label="Close">×</button><h2>Book an appointment</h2><p class="bts-sub">' + (hasBooking ? 'You already have an appointment. Pick a new time to move it.' : 'Pick a time that suits you. You will get a confirmation and reminders.') + '</p>' +
        '<form id="bts-book-form"><label>Name<input name="name" type="text" required maxlength="60" value="' + esc(known.name) + '"></label><label>Email<input name="email" type="email" required maxlength="80" value="' + esc(known.email) + '"></label>' +
        '<label>What is it for?<select name="treat">' + treat + '</select></label><fieldset><legend>Choose a time</legend><div class="bts-slots">' + slots + '</div></fieldset>' +
        '<button type="submit" class="bts-go">Book this time</button></form><p class="bts-fine">Demo: your details stay in your browser and go nowhere. No payment is taken here or anywhere in this demo.</p></div>');
      document.body.appendChild(m);
      m.addEventListener('click', function (e) { if (e.target === m) closeBooking(); });
      $('bts-book-x').addEventListener('click', closeBooking);
      $('bts-book-form').addEventListener('submit', submitBooking);
      m.querySelector('input[name="name"]').focus();
    }).catch(function () {});
  }
  function closeBooking() { var m = $('bts-book'); if (m) m.remove(); }
  function submitBooking(e) {
    e.preventDefault();
    var f = e.target, name = f.name.value.trim(), email = f.email.value.trim(), slot = f.slot.value, treat = f.treat.value;
    if (!name || !email) return;
    var find = function () { return engine.state.saved.filter(function (l) { return l.email.toLowerCase() === email.toLowerCase(); })[0]; };
    var known = find();
    var ready = known ? Promise.resolve(known) : engine.submitLead({ name: name, email: email, message: 'Booking request: ' + treat, intent: 'ready', lang: languageFor().code }).then(function () { return engine.idle(); }).then(find);
    // Someone who already has an appointment is moving it: the engine ignores a second booking.
    ready.then(function (lead) {
      var mine = engine.state.bookings.filter(function (b) { return b.leadId === lead.id && b.status === 'booked'; })[0];
      return mine ? engine.rescheduleBooking(mine.id, slot) : engine.createBooking(lead.id, slot);
    }).then(function () {
      current = email; phoneView.select(email); closeBooking(); openDrawer('phone');
    }).catch(function () {});
  }

  // "Book online" and "Book an appointment" open the booking step; the other chat buttons are unchanged.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-chat]');
    if (b && /^\s*book\b/i.test(b.textContent)) { e.preventDefault(); e.stopImmediatePropagation(); openBooking(); }
  }, true);

  var api = { open: openDrawer, close: closeDrawer, book: openBooking, load: load, insights: function () { return insights; }, setBackend: function (fn) { backend = fn; }, engine: null };
  window.AldbridgeDemo = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildButton); else buildButton();
})();
