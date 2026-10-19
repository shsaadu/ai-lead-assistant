// Animated background for the Assist Street website.
//
// One full-screen canvas behind the page draws three scenes:
//   road  — a neon road running to the horizon (hero and final section)
//   city  — a night skyline: windows lighting up and going dark, red
//           aircraft-warning lights on the towers, a plane crossing now and then
//   stars — a constellation of points that connect around the cursor
// Each section declares its scene with data-bg="road|city|stars". As you
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
  // Phones and tablets: draw at 30fps and at 1x resolution to stay smooth.
  var lowPower = window.matchMedia('(pointer: coarse)').matches;
  var scrollY = window.scrollY;
  var pointer = { x: -9999, y: -9999, active: false };

  // ---------- Scenes ----------
  var scenes = {
    road: { weight: 0, target: 0, init: initRoad, draw: drawRoad },
    city: { weight: 0, target: 0, init: initCity, draw: drawCity },
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

  // City skyline at night
  var city = { layers: [], windows: [], beacons: [], planes: [], t: 0, haze: null };
  function initCity() {
    city.layers = [];
    city.windows = [];
    city.beacons = [];
    city.planes = [];
    // Two rows of buildings: a faint far row and a darker, taller near row.
    var specs = [
      { fill: 'rgba(255,255,255,0.028)', min: 0.12, max: 0.34, wMin: 26, wMax: 70, lit: 0.1 },
      { fill: 'rgba(14,15,20,0.96)', min: 0.08, max: 0.46, wMin: 34, wMax: 96, lit: 0.16 }
    ];
    var scale = small ? 0.7 : 1;
    specs.forEach(function (spec, depth) {
      var layer = document.createElement('canvas');
      layer.width = W;
      layer.height = H;
      var lctx = layer.getContext('2d');
      var x = -Math.random() * 40;
      var tallest = [];
      while (x < W) {
        var bw = (spec.wMin + Math.random() * (spec.wMax - spec.wMin)) * scale;
        var bh = H * (spec.min + Math.pow(Math.random(), 1.6) * (spec.max - spec.min));
        // Now and then a tower, so the skyline isn't flat.
        if (Math.random() < 0.08) bh = H * (spec.max + 0.04 + Math.random() * 0.06);
        var top = H - bh;
        lctx.fillStyle = spec.fill;
        lctx.fillRect(Math.round(x), Math.round(top), Math.ceil(bw), Math.ceil(bh));
        // A thin edge of light along each roof.
        lctx.fillStyle = 'rgba(255,255,255,' + (depth ? 0.07 : 0.035) + ')';
        lctx.fillRect(Math.round(x), Math.round(top), Math.ceil(bw), 1);
        if (Math.random() < 0.3) {
          // Rooftop mast.
          lctx.fillRect(Math.round(x + bw / 2), Math.round(top - 14 * scale), 1, Math.round(14 * scale));
        }
        tallest.push({ x: x + bw / 2, top: top, h: bh });
        // Windows: a grid on each building; a share of them lit.
        var cols = Math.max(1, Math.floor((bw - 8) / 9));
        var rows = Math.floor((bh - 10) / 12);
        for (var r = 0; r < rows; r++) {
          for (var c = 0; c < cols; c++) {
            if (Math.random() > spec.lit) continue;
            city.windows.push({
              x: Math.round(x + 5 + c * 9),
              y: Math.round(top + 8 + r * 12),
              w: depth ? 4 : 3,
              h: depth ? 5 : 4,
              on: Math.random() < 0.75 ? 1 : 0,
              level: 0,
              color: Math.random() < 0.7 ? AMBER : WHITE,
              a: (depth ? 0.28 : 0.14) + Math.random() * 0.2
            });
          }
        }
        x += bw + (Math.random() < 0.25 ? 4 + Math.random() * 18 : 0);
      }
      city.layers.push(layer);
      // Red aircraft-warning lights on the tallest near buildings.
      if (depth === 1) {
        tallest.sort(function (a, b) { return b.h - a.h; });
        tallest.slice(0, small ? 2 : 4).forEach(function (b, i) {
          city.beacons.push({ x: b.x, y: b.top - 15 * scale, phase: i * 0.7 });
        });
      }
    });
    city.windows.forEach(function (w) { w.level = w.on; });
    // A plane's lights crossing high up now and then.
    city.planes.push(newPlane(true));
  }
  function newPlane(anywhere) {
    var dir = Math.random() < 0.5 ? 1 : -1;
    return {
      x: anywhere ? Math.random() * W : dir > 0 ? -40 : W + 40,
      y: H * (0.08 + Math.random() * 0.22),
      dir: dir,
      speed: 14 + Math.random() * 10,
      wait: anywhere ? 0 : 4 + Math.random() * 10
    };
  }
  function drawCity(alpha, dt) {
    city.t += dt;

    // Warm haze rising from the streets.
    var haze = ctx.createLinearGradient(0, H * 0.35, 0, H);
    haze.addColorStop(0, 'rgba(' + RED + ',0)');
    haze.addColorStop(0.7, 'rgba(' + RED + ',' + 0.07 * alpha + ')');
    haze.addColorStop(1, 'rgba(' + AMBER + ',' + 0.12 * alpha + ')');
    ctx.fillStyle = haze;
    ctx.fillRect(0, H * 0.35, W, H * 0.65);

    // Plane.
    city.planes.forEach(function (p, i) {
      if (p.wait > 0) { p.wait -= dt; return; }
      p.x += p.dir * p.speed * dt;
      var blink = (city.t * 1.2 + i) % 1 < 0.12 ? 1 : 0.35;
      ctx.fillStyle = 'rgba(' + WHITE + ',' + 0.5 * blink * alpha + ')';
      ctx.fillRect(p.x, p.y, 2, 2);
      ctx.fillStyle = 'rgba(' + RED + ',' + 0.6 * alpha + ')';
      ctx.fillRect(p.x - p.dir * 6, p.y + 1, 2, 2);
      if (p.x < -60 || p.x > W + 60) city.planes[i] = newPlane(false);
    });

    ctx.globalAlpha = alpha;
    ctx.drawImage(city.layers[0], 0, 0, W, H);
    ctx.globalAlpha = 1;

    // Windows switching on and off, a few at a time, fading gently.
    var flips = dt * (small ? 3 : 6);
    while (flips > 0) {
      if (Math.random() < flips) {
        var w = city.windows[Math.floor(Math.random() * city.windows.length)];
        if (w) w.on = w.on ? 0 : 1;
      }
      flips -= 1;
    }
    var nearStart = -1;
    for (var i = 0; i < city.windows.length; i++) {
      var win = city.windows[i];
      if (win.w === 4 && nearStart < 0) {
        // Far windows are done: lay the near row of buildings over them.
        nearStart = i;
        ctx.globalAlpha = alpha;
        ctx.drawImage(city.layers[1], 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      win.level += (win.on - win.level) * Math.min(1, dt * 1.5);
      if (win.level < 0.02) continue;
      ctx.fillStyle = 'rgba(' + win.color + ',' + win.a * win.level * alpha + ')';
      ctx.fillRect(win.x, win.y, win.w, win.h);
    }
    if (nearStart < 0) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(city.layers[1], 0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // Aircraft-warning lights: a slow red pulse with a soft glow.
    city.beacons.forEach(function (b) {
      var pulse = Math.pow(Math.max(0, Math.sin((city.t * 0.9 + b.phase) * Math.PI)), 6);
      var a = (0.25 + pulse * 0.75) * alpha;
      var g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 16);
      g.addColorStop(0, 'rgba(' + RED + ',' + 0.5 * a + ')');
      g.addColorStop(1, 'rgba(' + RED + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(b.x - 16, b.y - 16, 32, 32);
      ctx.fillStyle = 'rgba(' + RED + ',' + a + ')';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Constellation
  var stars = { points: [], t: 0 };
  function initStars() {
    var count = Math.min(small ? 32 : lowPower ? 55 : 95, Math.round((W * H) / 16000));
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
    var current = zones.length ? zones[0].getAttribute('data-bg') : 'city';
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
    DPR = lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);
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
  var FRAME_GAP = lowPower ? 1 / 30 : 0;
  function frame(now) {
    // On phones, skip every other frame (30fps): half the work, still smooth.
    if (FRAME_GAP && (now - last) / 1000 < FRAME_GAP - 0.004) {
      requestAnimationFrame(frame);
      return;
    }
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
