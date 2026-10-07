// Assist Street website: scroll reveals, counters, the road, glow cards,
// pricing tilt, header state, and the self-playing chat demo in the hero.
// No libraries. Everything degrades to a static page without JavaScript, and
// visitors who ask for reduced motion get the content without the movement.
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(pointer: fine)').matches;

  // ---- Scroll reveals ----
  var revealables = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );
    revealables.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    revealables.forEach(function (el) {
      el.classList.add('in');
    });
  }

  // ---- Counters ----
  function countUp(el) {
    var target = parseInt(el.getAttribute('data-count'), 10);
    if (reduceMotion || !target) return;
    var start = null;
    var duration = 1400;
    function frame(time) {
      if (!start) start = time;
      var t = Math.min((time - start) / duration, 1);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased);
      if (t < 1) requestAnimationFrame(frame);
    }
    el.textContent = '0';
    requestAnimationFrame(frame);
  }
  if ('IntersectionObserver' in window) {
    var countObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            countUp(entry.target);
            countObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.6 }
    );
    document.querySelectorAll('[data-count]').forEach(function (el) {
      countObserver.observe(el);
    });
  }

  // ---- Scroll-driven: progress bar, header, the road ----
  var header = document.querySelector('.site-header');
  var progress = document.querySelector('.progress');
  var road = document.getElementById('road');
  var stops = road ? road.querySelectorAll('.stop') : [];
  var ticking = false;

  function onScroll() {
    var y = window.scrollY;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.setProperty('--p', max > 0 ? (y / max).toFixed(4) : 0);
    if (header) header.classList.toggle('scrolled', y > 20);

    if (road) {
      // The centre line fills as the middle of the screen moves down the road.
      var rect = road.getBoundingClientRect();
      var mid = window.innerHeight * 0.55;
      var filled = Math.min(Math.max((mid - rect.top) / rect.height, 0), 1);
      road.style.setProperty('--road', reduceMotion ? 1 : filled.toFixed(4));
      stops.forEach(function (stop) {
        var r = stop.getBoundingClientRect();
        stop.classList.toggle('lit', reduceMotion || r.top < mid);
      });
    }
    ticking = false;
  }
  window.addEventListener(
    'scroll',
    function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(onScroll);
      }
    },
    { passive: true }
  );
  window.addEventListener('resize', onScroll);
  onScroll();

  // ---- Cursor light in the hero, glow on cards, tilt on pricing ----
  if (finePointer && !reduceMotion) {
    var hero = document.querySelector('.hero');
    if (hero) {
      hero.addEventListener('pointermove', function (e) {
        var r = hero.getBoundingClientRect();
        hero.style.setProperty('--mx', e.clientX - r.left + 'px');
        hero.style.setProperty('--my', e.clientY - r.top + 'px');
      });
    }

    document.querySelectorAll('.glow-card').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var x = e.clientX - r.left + 'px';
        var y = e.clientY - r.top + 'px';
        card.style.setProperty('--x', x);
        card.style.setProperty('--y', y);
        var inner = card.querySelector('.glow-inner');
        if (inner) {
          inner.style.setProperty('--x', x);
          inner.style.setProperty('--y', y);
        }
      });
    });

    document.querySelectorAll('[data-tilt]').forEach(function (plan) {
      plan.addEventListener('pointermove', function (e) {
        var r = plan.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        plan.style.transform = 'rotateY(' + px * 6 + 'deg) rotateX(' + -py * 6 + 'deg) translateY(-4px)';
      });
      plan.addEventListener('pointerleave', function () {
        plan.style.transform = '';
      });
    });
  }

  // ---- "Chat with us" buttons open the real assistant ----
  document.querySelectorAll('[data-open-chat]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (window.AILeadAssistant && typeof window.AILeadAssistant.open === 'function') {
        window.AILeadAssistant.open();
      } else {
        window.location.href = 'mailto:hello@assiststreet.co.uk';
      }
    });
  });

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  // ---- Hero: self-playing conversations ----
  // Illustrative conversations (not real clients), labelled as examples on the page.
  var SCRIPTS = [
    {
      business: 'Example: dental clinic',
      lines: [
        { who: 'user', text: 'Hi, do you do teeth whitening? How much is it?' },
        { who: 'bot', text: 'Yes! In-clinic whitening is £350 and home whitening kits are £250, including a check-up first. Would you like to book a consultation?' },
        { who: 'user', text: 'Yes please, ideally Saturday morning.' }
      ],
      lead: { summary: 'Wants whitening consultation, Saturday morning', lang: 'English' }
    },
    {
      business: 'Example: letting agent',
      lines: [
        { who: 'user', dir: 'rtl', lang: 'ar', text: 'هل الشقة في شارع النهر ما زالت متاحة؟' },
        { who: 'bot', dir: 'rtl', lang: 'ar', text: 'نعم، الشقة متاحة من ١ نوفمبر. الإيجار ١٨٥٠ جنيهًا شهريًا. هل تود حجز موعد للمعاينة؟' },
        { who: 'user', dir: 'rtl', lang: 'ar', text: 'نعم، يوم الخميس من فضلك.' }
      ],
      lead: { summary: 'Wants to view the River Street flat on Thursday', lang: 'Arabic' }
    },
    {
      business: 'Example: language school',
      lines: [
        { who: 'user', lang: 'es', text: '¿Cuándo empieza el próximo curso para principiantes?' },
        { who: 'bot', lang: 'es', text: 'El próximo curso para principiantes empieza el lunes 2 de noviembre. ¿Te gustaría reservar una plaza?' },
        { who: 'user', lang: 'es', text: 'Sí, ¿me pueden escribir por WhatsApp?' }
      ],
      lead: { summary: 'Beginner course from 2 November; prefers WhatsApp', lang: 'Spanish' }
    },
    {
      business: 'Example: plumber',
      lines: [
        { who: 'user', lang: 'zh', text: '我家厨房水管漏水了，今天能来修吗？' },
        { who: 'bot', lang: 'zh', text: '很抱歉听到这个情况。我们在M25以内提供紧急上门服务，上门费为89英镑。请留下您的联系方式，团队会尽快联系您。' }
      ],
      lead: { summary: 'Kitchen pipe leaking, wants a visit today', lang: 'Chinese' }
    }
  ];

  var body = document.getElementById('demo-body');
  var businessLabel = document.getElementById('demo-business');
  if (!body) return;

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }
  // Pause the loop while the tab is hidden, so it doesn't race ahead.
  function whenVisible() {
    if (!document.hidden) return Promise.resolve();
    return new Promise(function (resolve) {
      document.addEventListener('visibilitychange', function handler() {
        if (!document.hidden) {
          document.removeEventListener('visibilitychange', handler);
          resolve();
        }
      });
    });
  }

  function bubble(line) {
    var el = document.createElement('div');
    el.className = 'bubble ' + line.who;
    if (line.dir) el.setAttribute('dir', line.dir);
    if (line.lang) el.setAttribute('lang', line.lang);
    el.textContent = line.text;
    body.appendChild(el);
    return el;
  }

  function leadCard(lead) {
    var el = document.createElement('div');
    el.className = 'lead-pop';
    var tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'New lead · ready to act';
    var summary = document.createElement('strong');
    summary.textContent = lead.summary;
    el.appendChild(tag);
    el.appendChild(summary);
    el.appendChild(document.createTextNode(' · ' + lead.lang));
    body.appendChild(el);
  }

  function renderStatic(script) {
    body.textContent = '';
    if (businessLabel) businessLabel.textContent = script.business;
    script.lines.forEach(bubble);
    leadCard(script.lead);
  }

  if (reduceMotion) {
    renderStatic(SCRIPTS[0]);
    return;
  }

  (async function loop() {
    var i = 0;
    await wait(1400);
    for (;;) {
      var script = SCRIPTS[i % SCRIPTS.length];
      body.textContent = '';
      if (businessLabel) businessLabel.textContent = script.business;
      for (var j = 0; j < script.lines.length; j++) {
        await whenVisible();
        var line = script.lines[j];
        if (line.who === 'bot') {
          var typing = document.createElement('div');
          typing.className = 'bubble bot typing';
          typing.innerHTML = '<i></i><i></i><i></i>';
          body.appendChild(typing);
          await wait(1300);
          typing.remove();
        } else {
          await wait(700);
        }
        bubble(line);
        await wait(line.who === 'bot' ? 1600 : 900);
      }
      await wait(500);
      leadCard(script.lead);
      await wait(3600);
      i++;
    }
  })();
})();
