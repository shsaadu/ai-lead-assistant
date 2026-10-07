// Animated background for the Assist Street website.
//
// One full-screen canvas behind the page draws three scenes:
//   road  — a neon road running to the horizon (hero and final section)
//   map   — a faint street grid with glowing messages travelling along it,
//           plus soft out-of-focus city lights deep in the background
//   stars — a constellation of points that connect around the cursor
// Each section declares its scene with data-bg="road|map|stars". As you
// scroll, the scene for the section in the middle of the screen fades in and
// the previous one fades out, so changes are always gradual.
//
// Pauses while the tab is hidden; draws nothing for visitors who ask for
// reduced motion (the page's own glows remain).
(function () {
  'use strict';

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var canvas = document.createElement('canvas');
  canvas.className = 'bg-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  var ctx = canvas.getContext('2d');

  var RED = '255,45,85';
  var AMBER = '255,181,71';
  var WHITE = '255,255,255';
  var FADE_SECONDS = 0.35; // smoothing time constant: ~0.9s for a full crossfade

  var W = 0, H = 0, DPR = 1, small = false;
  var scrollY = window.scrollY;
  var pointer = { x: -9999, y: -9999, active: false };

  // ---------- Scenes ----------
  var scenes = {
    road: { weight: 0, target: 0, init: initRoad, draw: drawRoad },
    map: { weight: 0, target: 0, init: initMap, draw: drawMap },
    stars: { weight: 0, target: 0, init: initStars, draw: drawStars }
  };

  // Neon road
  var road = { t: 0 };
  function initRoad() {}
  function drawRoad(alpha, dt) {
    road.t += dt * 0.35;
    var horizon = H * 0.58;
    var cx = W * 0.5;

    // Glow along the horizon and at the vanishing point.
    var band = ctx.createLinearGradient(0, horizon - H * 0.18, 0, horizon + 2);
    band.addColorStop(0, 'rgba(' + RED + ',0)');
    band.addColorStop(1, 'rgba(' + RED + ',' + 0.16 * alpha + ')');
    ctx.fillStyle = band;
    ctx.fillRect(0, horizon - H * 0.18, W, H * 0.18 + 2);
    var sun = ctx.createRadialGradient(cx, horizon, 0, cx, horizon, Math.min(W, H) * 0.35);
    sun.addColorStop(0, 'rgba(' + AMBER + ',' + 0.22 * alpha + ')');
    sun.addColorStop(1, 'rgba(' + AMBER + ',0)');
    ctx.fillStyle = sun;
    ctx.fillRect(cx - W, horizon - H, W * 2, H * 2);

    // Fan of lines from the vanishing point.
    ctx.lineWidth = 1;
    var spokes = small ? 10 : 16;
    for (var i = -spokes; i <= spokes; i++) {
      var edge = Math.abs(i) / spokes;
      ctx.strokeStyle = 'rgba(' + RED + ',' + (0.1 + 0.18 * (1 - edge)) * alpha + ')';
      ctx.beginPath();
      ctx.moveTo(cx + i * 4, horizon);
      ctx.lineTo(cx + i * (W / spokes) * 1.6, H);
      ctx.stroke();
    }
    // Cross lines rushing towards the viewer.
    var rows = 12;
    for (var k = 0; k < rows; k++) {
      var p = (k + (road.t % 1)) / rows;
      var y = horizon + (H - horizon) * p * p;
      ctx.strokeStyle = 'rgba(' + RED + ',' + (0.05 + p * 0.3) * alpha + ')';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // Amber centre-line dashes.
    for (var d = 0; d < 7; d++) {
      var q = (d / 7 + road.t * 0.5) % 1;
      var yy = horizon + (H - horizon) * q * q;
      var w = 1 + q * 6;
      ctx.fillStyle = 'rgba(' + AMBER + ',' + (0.25 + q * 0.6) * alpha + ')';
      ctx.fillRect(cx - w / 2, yy, w, 2 + q * 18);
    }
  }

  // Street map + bokeh
  var map = { pulses: [], bokeh: [], spacing: 64 };
  function newPulse() {
    var horizontal = Math.random() < 0.5;
    var cols = Math.ceil(W / map.spacing) + 2;
    var rows = Math.ceil((H * 2) / map.spacing) + 2;
    return {
      horizontal: horizontal,
      lane: Math.floor(Math.random() * (horizontal ? rows : cols)),
      pos: -60,
      speed: 60 + Math.random() * 110,
      color: Math.random() < 0.62 ? RED : AMBER
    };
  }
  function initMap() {
    map.spacing = small ? 52 : 64;
    map.pulses = [];
    var count = small ? 7 : 13;
    for (var i = 0; i < count; i++) {
      var p = newPulse();
      p.pos = Math.random() * (p.horizontal ? W : H * 2);
      map.pulses.push(p);
    }
    map.bokeh = [];
    var lights = small ? 9 : 16;
    for (var j = 0; j < lights; j++) {
      map.bokeh.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: (small ? 30 : 40) + Math.random() * (small ? 50 : 90),
        color: [RED, AMBER, WHITE, AMBER][j % 4],
        drift: 4 + Math.random() * 10,
        depth: 0.05 + Math.random() * 0.12,
        a: 0.05 + Math.random() * 0.07
      });
    }
  }
  function drawMap(alpha, dt) {
    // Bokeh: deepest layer, barely moves with scroll.
    map.bokeh.forEach(function (b) {
      b.y -= b.drift * dt;
      var y = ((b.y - scrollY * b.depth) % (H + 2 * b.r) + H + 2 * b.r) % (H + 2 * b.r) - b.r;
      var g = ctx.createRadialGradient(b.x, y, b.r * 0.25, b.x, y, b.r);
      g.addColorStop(0, 'rgba(' + b.color + ',' + b.a * alpha + ')');
      g.addColorStop(0.75, 'rgba(' + b.color + ',' + b.a * 0.55 * alpha + ')');
      g.addColorStop(1, 'rgba(' + b.color + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, y, b.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // Street grid: scrolls at 30% of page speed for depth.
    var s = map.spacing;
    var offset = -((scrollY * 0.3) % s);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,' + 0.055 * alpha + ')';
    ctx.beginPath();
    for (var x = 0; x <= W; x += s) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, H);
    }
    for (var y = offset; y <= H; y += s) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(W, Math.round(y) + 0.5);
    }
    ctx.stroke();

    // Messages travelling along the streets.
    var gridTop = -(scrollY * 0.3) % s;
    map.pulses.forEach(function (p, i) {
      p.pos += p.speed * dt;
      var len = 70;
      var x1, y1, x2, y2;
      if (p.horizontal) {
        y1 = y2 = gridTop + (p.lane % Math.ceil(H / s + 2)) * s;
        x1 = p.pos;
        x2 = p.pos - len;
      } else {
        x1 = x2 = p.lane * s;
        y1 = p.pos - H * 0.5;
        y2 = y1 - len;
      }
      var g = ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, 'rgba(' + p.color + ',' + 0.85 * alpha + ')');
      g.addColorStop(1, 'rgba(' + p.color + ',0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(' + p.color + ',' + alpha + ')';
      ctx.beginPath();
      ctx.arc(x1, y1, 2.4, 0, Math.PI * 2);
      ctx.fill();
      var limit = p.horizontal ? W + len : H * 1.5 + len;
      if (p.pos > limit) map.pulses[i] = newPulse();
    });
  }

  // Constellation
  var stars = { points: [], t: 0 };
  function initStars() {
    var count = Math.min(small ? 45 : 95, Math.round((W * H) / 16000));
    stars.points = [];
    for (var i = 0; i < count; i++) {
      stars.points.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 12,
        vy: (Math.random() - 0.5) * 12
      });
    }
  }
  function drawStars(alpha, dt) {
    stars.t += dt;
    var pts = stars.points;
    var link = small ? 90 : 130;
    var reach = small ? 160 : 240;
    // Without a mouse (phones), a slow invisible point wanders instead.
    var mx = pointer.active ? pointer.x : W * (0.5 + 0.32 * Math.cos(stars.t * 0.25));
    var my = pointer.active ? pointer.y : H * (0.5 + 0.3 * Math.sin(stars.t * 0.33));

    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
    }
    ctx.lineWidth = 1;
    for (var a = 0; a < pts.length; a++) {
      var A = pts[a];
      var dm = Math.hypot(A.x - mx, A.y - my);
      var near = Math.max(0, 1 - dm / reach);
      for (var b = a + 1; b < pts.length; b++) {
        var B = pts[b];
        var dx = A.x - B.x, dy = A.y - B.y;
        if (Math.abs(dx) > link || Math.abs(dy) > link) continue;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > link) continue;
        var strength = (1 - dist / link) * (0.08 + near * 0.6);
        ctx.strokeStyle = 'rgba(' + (near > 0.15 ? RED : WHITE) + ',' + strength * alpha + ')';
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
      }
      ctx.fillStyle = near > 0.15 ? 'rgba(' + RED + ',' + (0.4 + near * 0.6) * alpha + ')' : 'rgba(255,255,255,' + 0.3 * alpha + ')';
      ctx.beginPath();
      ctx.arc(A.x, A.y, 1.1 + near * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- Which scene where ----------
  var zones = Array.prototype.slice.call(document.querySelectorAll('[data-bg]'));
  function pickScene() {
    var middle = window.innerHeight * 0.5;
    var current = zones.length ? zones[0].getAttribute('data-bg') : 'map';
    for (var i = 0; i < zones.length; i++) {
      if (zones[i].getBoundingClientRect().top <= middle) current = zones[i].getAttribute('data-bg');
    }
    Object.keys(scenes).forEach(function (name) {
      scenes[name].target = name === current ? 1 : 0;
    });
    canvas.setAttribute('data-scene', current);
  }

  // ---------- Sizing, input, loop ----------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    small = W < 700;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    Object.keys(scenes).forEach(function (name) {
      scenes[name].init();
    });
  }

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  window.addEventListener('scroll', function () {
    scrollY = window.scrollY;
    pickScene();
  }, { passive: true });
  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    }
  }, { passive: true });
  document.addEventListener('mouseleave', function () {
    pointer.active = false;
  });

  resize();
  pickScene();
  // Start the first scene already visible, instead of fading in from nothing.
  Object.keys(scenes).forEach(function (name) {
    scenes[name].weight = scenes[name].target;
  });

  var last = performance.now();
  var sinceCheck = 0;
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    var k = 1 - Math.exp(-dt / FADE_SECONDS);

    // Read the scroll position every frame (cheap) and re-pick the scene a
    // few times a second, so the background never depends on scroll events
    // alone (anchor jumps, restored scroll positions, throttled tabs).
    scrollY = window.scrollY;
    sinceCheck += dt;
    if (sinceCheck > 0.2) {
      sinceCheck = 0;
      pickScene();
    }

    ctx.clearRect(0, 0, W, H);
    Object.keys(scenes).forEach(function (name) {
      var s = scenes[name];
      s.weight += (s.target - s.weight) * k;
      if (s.weight > 0.01) s.draw(s.weight, dt);
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // requestAnimationFrame already pauses in hidden tabs; reset the clock on
  // return so animations don't jump.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) last = performance.now();
  });
})();
