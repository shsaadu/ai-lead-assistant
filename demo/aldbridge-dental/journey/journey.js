/**
 * Aldbridge Dental: the whole journey (glue).
 * Creates one automation engine for the practice and mounts the clinic's back office and the
 * patient's phone on it, plus the demo controls (time, state of the patient system) and a
 * pretend-patient form. In the finished demo the real website and chat replace the pretend form.
 * Everything here is simulated, with made-up people.
 */
(function () {
  'use strict';

  var E = AssistEngine.create({
    owner: 'reception@aldbridgedental.example',
    manager: 'practice.manager@aldbridgedental.example',
    operator: 'support@assiststreet.example'
  });
  var $ = function (id) { return document.getElementById(id); };
  var phone = PhoneView.mount($('phone'), E);
  var hub = HubView.mount($('hub'), E);

  var PRESETS = {
    maria: { name: 'Maria Lopez', email: 'maria.lopez@example.com', message: 'Hola, necesito una cita de urgencia: me duele una muela.', intent: 'ready', lang: 'es' },
    chen: { name: 'Chen Wei', email: 'chen.wei@example.com', message: 'Hi, I would like a check-up. Are you taking new patients?', intent: 'looking', lang: 'en' },
    omar: { name: 'Omar Aziz', email: 'omar.aziz@example.com', message: 'هل تقبلون مرضى NHS؟ لدي أسئلة عن العلاج.', intent: 'person', lang: 'ar' }
  };
  function fill(p) {
    var f = $('patientForm');
    Object.keys(p).forEach(function (k) { if (f.elements[k]) f.elements[k].value = p[k]; });
  }
  function send() {
    var f = $('patientForm'), d = { name: f.elements.name.value, email: f.elements.email.value, message: f.elements.message.value, intent: f.elements.intent.value, lang: f.elements.lang.value };
    if (!d.name.trim() || !d.email.trim()) return;
    E.submitLead(d); phone.select(d.email);
  }

  $('patientForm').addEventListener('submit', function (e) { e.preventDefault(); send(); });
  document.querySelectorAll('[data-preset]').forEach(function (b) { b.addEventListener('click', function () { fill(PRESETS[b.dataset.preset]); send(); }); });
  document.querySelectorAll('[data-skip]').forEach(function (b) { b.addEventListener('click', function () { E.skip(Number(b.dataset.skip)); }); });
  document.querySelectorAll('.mode').forEach(function (b) { b.addEventListener('click', function () { E.setMode(b.dataset.mode); }); });
  $('nextMon').addEventListener('click', function () { E.skipToNextReport(); });
  $('simWeek').addEventListener('click', function () { E.simulateWeek(); });
  $('resetAll').addEventListener('click', function () { E.reset(); });
  $('year') && ($('year').textContent = new Date().getFullYear());

  function syncControls() {
    document.querySelectorAll('.mode').forEach(function (b) { var on = b.dataset.mode === E.state.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  }
  E.onChange(syncControls); syncControls();
  setInterval(function () { if (!document.hidden) E.advance(0.25); }, 250);

  window.Journey = { engine: E, phone: phone, hub: hub, presets: PRESETS };
})();
