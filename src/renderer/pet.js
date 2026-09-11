/*
 * Desktop tabby — behaviour, physics and rendering.
 *
 * The cat lives at a floor anchor (x, y) in CSS pixels inside the overlay
 * window. A small state machine decides what she's doing; CatArt draws the
 * matching pose as vector paths, scaled from its 180x152 design space to
 * whatever height the user picked.
 */
(function () {
  'use strict';

  var art = window.CatArt;
  var D = art.DESIGN;
  var bridge = window.petBridge;
  var canvas = document.getElementById('stage');
  var ctx = canvas.getContext('2d');

  var HEIGHTS = { 2: 96, 3: 126, 4: 162 };     // on-screen height in CSS px
  var sizeKey = Number(localStorage.getItem('tabby.scale')) || 3;
  var scale = HEIGHTS[sizeKey] / D.h;

  var GRAVITY = 2400;          // px/s^2
  var WANDER_SPEED = 44;       // px/s
  var CHASE_SPEED = 96;
  var STRIDE = 26;             // design units of travel per full walk cycle
  var FRAME_MS = 1000 / 40;    // easy on the battery; the art is stylised

  var geom = {
    floor: window.innerHeight - 80,
    left: 0,
    right: window.innerWidth,
    ceiling: 0
  };

  var cat = {
    x: 240,
    y: geom.floor,
    vx: 0,
    vy: 0,
    facing: 1,
    state: 'stand',
    stateT: 0,
    stateDur: 2,
    phase: 0,
    targetX: null,
    airborne: false,
    grabbed: false,
    energy: clamp(Number(localStorage.getItem('tabby.energy')) || 0.85, 0, 1),
    blinkIn: 3,
    blinkFor: 0,
    startleCool: 0,
    curiousIn: 3,
    wander: true,
    look: { x: 0, y: 0 }
  };

  var cursor = { x: -9999, y: -9999, speed: 0, vx: 0, vy: 0 };
  var pointer = { down: false, downAt: 0, moved: 0, offX: 0, offY: 0 };
  var particles = [];

  // ------------------------------------------------------------- speech
  var TALK_GAP = 20;           // seconds she must stay quiet between remarks
  var speech = null;           // { lines, t, life, w, h }
  var talkCool = 8;            // let her settle before the first insult
  var pendingSay = false;
  var idleFor = 0;             // seconds since the cursor last moved
  var randomSayIn = rand(30, 70);

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function now() { return performance.now() / 1000; }

  // ------------------------------------------------------------- states

  var STATES = {
    stand:   { pose: 'stand',   min: 1.5, max: 4.0,  cycle: 3.2 },
    walk:    { pose: 'walk',    min: 2.5, max: 7.0 },
    sit:     { pose: 'sit',     min: 3.0, max: 9.0,  cycle: 3.4 },
    groom:   { pose: 'groom',   min: 2.5, max: 6.0,  cycle: 1.1 },
    loaf:    { pose: 'loaf',    min: 8.0, max: 20.0, cycle: 4.0 },
    sleep:   { pose: 'curl',    min: 25,  max: 70,   cycle: 5.0 },
    stretch: { pose: 'stretch', min: 1.5, max: 1.5,  oneShot: true },
    alert:   { pose: 'stand',   min: 0.7, max: 1.3,  cycle: 1.0 },
    chase:   { pose: 'walk',    min: 1.5, max: 5.0 },
    watch:   { pose: 'sit',     min: 1.5, max: 4.0,  cycle: 2.0 },
    purr:    { pose: 'sit',     min: 2.6, max: 2.6,  cycle: 0.9 },
    dangle:  { pose: 'fall',    min: 999, max: 999,  cycle: 0.5 },
    fall:    { pose: 'fall',    min: 999, max: 999,  cycle: 0.5 }
  };

  function setState(name, dur) {
    var s = STATES[name];
    cat.state = name;
    cat.stateT = 0;
    cat.stateDur = dur !== undefined ? dur : rand(s.min, s.max);
    if (s.oneShot || name === 'walk' || name === 'chase') cat.phase = 0;
  }

  /* Weighted pick of the next behaviour, biased by energy. */
  function pickNext() {
    if (!cat.wander) {
      return setState(pick([
        ['sit', 3], ['loaf', 3], ['groom', 2], ['stand', 1],
        ['sleep', cat.energy < 0.3 ? 4 : 0.5]
      ]));
    }
    var tired = 1 - cat.energy;
    var choice = pick([
      ['walk',  1.6 * cat.energy + 0.15],
      ['stand', 0.5],
      ['sit',   0.9],
      ['groom', 0.7],
      ['loaf',  0.5 + tired],
      ['sleep', tired * tired * 3]
    ]);
    if (choice === 'walk') newWanderTarget();
    setState(choice);
  }

  function pick(pairs) {
    var total = 0, i;
    for (i = 0; i < pairs.length; i++) total += pairs[i][1];
    var r = Math.random() * total;
    for (i = 0; i < pairs.length; i++) {
      r -= pairs[i][1];
      if (r <= 0) return pairs[i][0];
    }
    return pairs[0][0];
  }

  function newWanderTarget() {
    var span = geom.right - geom.left - 80;
    for (var tries = 0; tries < 8; tries++) {
      var t = geom.left + 40 + Math.random() * span;
      if (Math.abs(t - cat.x) > 120) { cat.targetX = t; return; }
    }
    cat.targetX = cat.x + (Math.random() < 0.5 ? -180 : 180);
  }

  function wake() {
    if (cat.state === 'sleep' || cat.state === 'loaf') setState('stretch');
    else if (cat.state !== 'stretch') setState('alert');
  }

  // ------------------------------------------------------------ physics

  function stepPhysics(dt) {
    if (cat.grabbed) return;
    if (!cat.airborne && cat.y >= geom.floor - 0.5) return;

    cat.airborne = true;
    cat.vy += GRAVITY * dt;
    cat.x += cat.vx * dt;
    cat.y += cat.vy * dt;

    if (cat.x < geom.left + 20) { cat.x = geom.left + 20; cat.vx = -cat.vx * 0.45; }
    if (cat.x > geom.right - 20) { cat.x = geom.right - 20; cat.vx = -cat.vx * 0.45; }

    if (cat.y >= geom.floor) {
      cat.y = geom.floor;
      if (cat.vy > 430) {
        cat.vy = -cat.vy * 0.3;        // bounce
        cat.vx *= 0.65;
      } else {
        cat.vy = 0;
        cat.vx = 0;
        cat.airborne = false;
        setState('alert', 0.8);        // land, shake it off
        return;
      }
    }
    if (cat.state !== 'fall') setState('fall');
  }

  // ----------------------------------------------------------- reactions

  function reactToCursor(dt) {
    cat.startleCool -= dt;
    cat.curiousIn -= dt;

    var dx = cursor.x - cat.x;
    var dy = cursor.y - cat.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 900) return;

    var asleep = cat.state === 'sleep';

    // A fast swipe nearby is startling.
    if (cursor.speed > 950 && dist < 170 && cat.startleCool <= 0 && !cat.grabbed && !cat.airborne) {
      cat.startleCool = 6;
      if (asleep) { wake(); return; }
      cat.facing = dx > 0 ? 1 : -1;
      cat.vx = dx > 0 ? -150 : 150;
      cat.vy = -300;
      cat.airborne = true;
      setState('alert', 1.1);
      maybeSay('startle', 0.7);
      return;
    }

    if (asleep || cat.grabbed || cat.airborne || cat.state === 'stretch') return;

    // Otherwise she gets curious about it now and then.
    if (cat.curiousIn <= 0 && dist > 70 && dist < 460) {
      cat.curiousIn = rand(4, 11);
      if (Math.random() < 0.55 * (0.4 + cat.energy)) setState('chase');
    }

    if (cat.state === 'chase') {
      if (Math.abs(dx) < 46) setState('watch');
      else cat.targetX = cursor.x;
    } else if (cat.state === 'watch') {
      cat.facing = dx > 0 ? 1 : -1;
      if (Math.abs(dx) > 150) setState('chase');
    }
  }

  /* Gaze: pupils drift toward the cursor, in the cat's own (unflipped) space. */
  function updateGaze(head, rect) {
    var hx = cat.facing < 0 ? rect.x + (D.w - head.x) * scale : rect.x + head.x * scale;
    var hy = rect.y + head.y * scale;
    var tx = clamp((cursor.x - hx) / 260, -1, 1) * cat.facing;
    var ty = clamp((cursor.y - hy) / 220, -1, 1);
    cat.look.x += (tx - cat.look.x) * 0.16;
    cat.look.y += (ty - cat.look.y) * 0.16;
    return { x: hx, y: hy };
  }

  // -------------------------------------------------------------- update

  function update(dt) {
    cat.stateT += dt;

    // Energy: drains while up and about, recovers while curled up.
    if (cat.state === 'sleep') cat.energy = clamp(cat.energy + dt * 0.012, 0, 1);
    else if (cat.state === 'loaf') cat.energy = clamp(cat.energy + dt * 0.004, 0, 1);
    else cat.energy = clamp(cat.energy - dt * 0.0028, 0, 1);

    cat.blinkIn -= dt;
    if (cat.blinkFor > 0) cat.blinkFor -= dt;
    else if (cat.blinkIn <= 0) { cat.blinkFor = 0.13; cat.blinkIn = rand(2.5, 7); }

    reactToCursor(dt);
    stepPhysics(dt);

    if (cat.grabbed) {
      // Follows the pointer with a bit of dangle.
      cat.x += (cursor.x - pointer.offX - cat.x) * Math.min(1, dt * 22);
      cat.y += (cursor.y - pointer.offY - cat.y) * Math.min(1, dt * 22);
      cat.phase += dt;
    } else if (cat.state === 'walk' || cat.state === 'chase') {
      var target = cat.state === 'chase' ? cursor.x : cat.targetX;
      if (target === null || target === undefined) pickNext();
      else {
        var d = target - cat.x;
        var speed = cat.state === 'chase' ? CHASE_SPEED : WANDER_SPEED;
        if (Math.abs(d) < 6) {
          if (cat.state === 'chase') setState('watch');
          else pickNext();
        } else {
          var step = (d > 0 ? 1 : -1) * Math.min(Math.abs(d), speed * dt);
          cat.x = clamp(cat.x + step, geom.left + 20, geom.right - 20);
          cat.facing = step > 0 ? 1 : -1;
          cat.phase = (cat.phase + Math.abs(step) / (STRIDE * scale)) % 1;
        }
      }
    } else {
      var st = STATES[cat.state];
      if (st.oneShot) cat.phase = clamp(cat.stateT / cat.stateDur, 0, 1);
      else cat.phase = (cat.phase + dt / (st.cycle || 3)) % 1;
    }

    for (var i = particles.length - 1; i >= 0; i--) {
      particles[i].t += dt;
      if (particles[i].t > particles[i].life) particles.splice(i, 1);
    }

    // Speech timers.
    talkCool -= dt;
    idleFor += dt;
    if (speech) {
      speech.t += dt;
      if (speech.t > speech.life) speech = null;
    }
    randomSayIn -= dt;
    if (randomSayIn <= 0) {
      randomSayIn = rand(30, 70);
      maybeSay(idleFor > 75 ? 'idle' : 'random', 0.55);
    }

    if (!cat.grabbed && !cat.airborne && cat.stateT >= cat.stateDur) {
      if (cat.state === 'stretch') setState('stand', 1.2);
      else if (cat.state === 'sleep') { setState('stretch'); maybeSay('wake', 0.5); }
      else pickNext();
    }
  }

  // -------------------------------------------------------------- speech

  /* Ask the cat's brain for a line. Fire-and-forget; it arrives when it arrives. */
  function maybeSay(trigger, chance) {
    if (pendingSay || talkCool > 0) return;
    if (cat.state === 'sleep' && trigger !== 'wake') return;
    if (Math.random() > (chance === undefined ? 1 : chance)) return;

    pendingSay = true;
    talkCool = TALK_GAP;      // start the cooldown now, not when she answers
    bridge.say(trigger, {
      state: cat.state,
      energy: Math.round(cat.energy * 100) / 100,
      hour: new Date().getHours(),
      idleSec: Math.round(idleFor)
    }).then(function (line) {
      pendingSay = false;
      if (line) showSpeech(line);
    }, function () {
      pendingSay = false;
    });
  }

  function showSpeech(text) {
    var lines = wrapText(text, 230);
    speech = {
      lines: lines,
      t: 0,
      life: clamp(2.8 + text.length * 0.055, 3, 7.5),
      w: 0,
      h: 0
    };
  }

  function wrapText(text, maxWidth) {
    ctx.font = '600 14px -apple-system, BlinkMacSystemFont, sans-serif';
    var words = String(text).split(/\s+/);
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var next = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines.slice(0, 3);
  }

  function speechRect(head) {
    if (!speech) return null;
    ctx.font = '600 14px -apple-system, BlinkMacSystemFont, sans-serif';
    var padX = 12, padY = 9, lh = 18;
    var w = 0;
    for (var i = 0; i < speech.lines.length; i++) {
      w = Math.max(w, ctx.measureText(speech.lines[i]).width);
    }
    w += padX * 2;
    var h = speech.lines.length * lh + padY * 2;
    var x = clamp(head.x - w / 2, geom.left + 8, geom.right - w - 8);
    var y = head.y - 42 * scale - h;
    return { x: x, y: Math.max(geom.ceiling + 6, y), w: w, h: h, lh: lh, padX: padX, padY: padY };
  }

  function drawSpeech(box) {
    if (!speech || !box) return;
    // Quick pop in, hold, fade out.
    var a = Math.min(1, speech.t / 0.16);
    var left = speech.life - speech.t;
    if (left < 0.5) a = Math.min(a, Math.max(0, left / 0.5));
    var pop = 1 - Math.pow(1 - Math.min(1, speech.t / 0.22), 3);

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(box.x + box.w / 2, box.y + box.h);
    ctx.scale(0.86 + 0.14 * pop, 0.86 + 0.14 * pop);
    ctx.translate(-(box.x + box.w / 2), -(box.y + box.h));

    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, 11);
    // Tail pointing down at her head.
    var tx = clamp(box.x + box.w / 2, box.x + 16, box.x + box.w - 16);
    ctx.moveTo(tx - 8, box.y + box.h - 1);
    ctx.lineTo(tx + 1, box.y + box.h + 11);
    ctx.lineTo(tx + 9, box.y + box.h - 1);
    ctx.closePath();

    ctx.fillStyle = 'rgba(255,252,246,0.97)';
    ctx.strokeStyle = '#3b2417';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#2b1a10';
    ctx.font = '600 14px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline = 'top';
    for (var i = 0; i < speech.lines.length; i++) {
      ctx.fillText(speech.lines[i], box.x + box.padX, box.y + box.padY + i * box.lh + 1);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ rendering

  function poseFor() {
    var s = STATES[cat.state];
    var eye = 'open';
    var ear = 0;

    if (cat.state === 'groom' || cat.state === 'purr') eye = 'closed';
    else if (cat.state === 'sleep') eye = 'closed';
    else if (cat.state === 'loaf') eye = cat.energy < 0.45 ? 'half' : 'open';
    else if (cat.state === 'alert' || cat.state === 'watch') { eye = 'wide'; ear = 0.7; }
    else if (cat.state === 'fall' || cat.grabbed) { eye = 'wide'; ear = 0.9; }
    if (cat.blinkFor > 0 && eye === 'open') eye = 'closed';
    if (cat.state === 'sleep') ear = 0.5;

    return {
      mode: s.pose,
      phase: cat.phase,
      eye: eye,
      ear: ear,
      tailUp: cat.state === 'chase' ? 0.3 : (cat.state === 'alert' ? 1.4 : 1),
      look: cat.look,
      cig: cat.state !== 'sleep'      // she puts it out to nap
    };
  }

  function catRect() {
    return {
      x: cat.x - (D.w / 2) * scale,
      y: cat.y - D.floor * scale,
      w: D.w * scale,
      h: D.h * scale
    };
  }

  var lastRect = null;

  function draw() {
    var pose = poseFor();
    var r = catRect();
    var head = art.headOf(pose);
    var headScreen = updateGaze(head, r);

    // Clear only what we touched last frame plus what we're about to touch.
    // The speech bubble counts: it can reach well above and beside her.
    var box = speechRect(headScreen);
    var area = box ? union(r, box) : r;
    var pad = 100;
    var dirty = lastRect ? union(lastRect, area) : area;
    ctx.clearRect(dirty.x - pad, dirty.y - pad, dirty.w + pad * 2, dirty.h + pad * 2);
    lastRect = area;

    // Contact shadow, softened as she rises off the floor.
    var lift = clamp((geom.floor - cat.y) / 220, 0, 1);
    var alpha = 0.24 * (1 - lift * 0.8);
    if (alpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(cat.x, geom.floor + 2, (52 - lift * 16) * scale, 9 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.scale(scale, scale);
    if (cat.facing < 0) {
      ctx.translate(D.w, 0);
      ctx.scale(-1, 1);
    }
    art.draw(ctx, pose);
    ctx.restore();

    spawnParticles(headScreen, pose, r);
    drawParticles();
    drawSpeech(box);
    reportHitbox(r);
  }

  function union(a, b) {
    var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x: x, y: y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }

  function spawnParticles(head, pose, rect) {
    if (cat.state === 'purr' && Math.random() < 0.05) {
      particles.push({ kind: 'heart', x: head.x + rand(-14, 14), y: head.y - 34 * scale, t: 0, life: 1.4 });
    }
    if (cat.state === 'sleep' && Math.random() < 0.014) {
      particles.push({ kind: 'z', x: head.x + 26 * scale, y: head.y - 26 * scale, t: 0, life: 2.6 });
    }
    // Smoke drifts off the ember, wherever her head happens to be.
    if (pose.cig && !cat.grabbed && Math.random() < 0.08) {
      var tip = art.cigTip(art.headOf(pose));
      var tx = cat.facing < 0 ? rect.x + (D.w - tip.x) * scale : rect.x + tip.x * scale;
      particles.push({
        kind: 'smoke',
        x: tx,
        y: rect.y + tip.y * scale,
        drift: cat.facing * rand(4, 14),
        t: 0,
        life: rand(1.6, 2.6)
      });
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var k = p.t / p.life;
      var a = Math.sin(Math.min(1, k) * Math.PI) * 0.95;
      var y = p.y - k * 46;
      var x = p.x + Math.sin(k * 6) * 8;
      ctx.save();
      ctx.globalAlpha = a;
      if (p.kind === 'smoke') {
        // Rises, spreads and thins out.
        ctx.globalAlpha = a * 0.42;
        ctx.fillStyle = '#cfd3dd';
        ctx.beginPath();
        ctx.arc(p.x + p.drift * k + Math.sin(k * 4) * 5,
                p.y - k * 60 * scale,
                (3 + k * 13) * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }
      if (p.kind === 'heart') {
        ctx.fillStyle = '#ff6b8b';
        ctx.strokeStyle = 'rgba(59,36,23,0.85)';
        ctx.lineWidth = 2;
        var s = 6 + k * 3;
        ctx.beginPath();
        ctx.moveTo(x, y + s * 0.9);
        ctx.bezierCurveTo(x - s * 1.4, y - s * 0.2, x - s * 0.5, y - s * 1.2, x, y - s * 0.4);
        ctx.bezierCurveTo(x + s * 0.5, y - s * 1.2, x + s * 1.4, y - s * 0.2, x, y + s * 0.9);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      } else {
        ctx.font = 'bold ' + Math.round(16 + k * 9) + 'px -apple-system, sans-serif';
        ctx.strokeStyle = 'rgba(59,36,23,0.85)';
        ctx.lineWidth = 3;
        ctx.fillStyle = '#fff';
        ctx.strokeText('z', x, y);
        ctx.fillText('z', x, y);
      }
      ctx.restore();
    }
  }

  var sentBox = { x: 0, y: 0, w: 0, h: 0 };

  function reportHitbox(r) {
    // Tighter than the design box, which has empty margins around the cat.
    var box = {
      x: Math.round(r.x + 10 * scale),
      y: Math.round(r.y + 14 * scale),
      w: Math.round(r.w - 18 * scale),
      h: Math.round(r.h - 14 * scale)
    };
    if (Math.abs(box.x - sentBox.x) < 2 && Math.abs(box.y - sentBox.y) < 2 &&
        box.w === sentBox.w && box.h === sentBox.h) return;
    sentBox = box;
    bridge.setHitbox(box);
  }

  // --------------------------------------------------------------- input

  window.addEventListener('mousemove', function (e) {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
    if (pointer.down) {
      pointer.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (!cat.grabbed && pointer.moved > 6) {
        cat.grabbed = true;
        cat.airborne = false;
        bridge.setHeld(true);
        setState('dangle');
        particles.length = 0;
        maybeSay('grab', 0.8);
      }
    }
  });

  window.addEventListener('mousedown', function (e) {
    var r = catRect();
    if (e.clientX < r.x || e.clientX > r.x + r.w || e.clientY < r.y || e.clientY > r.y + r.h) return;
    pointer.down = true;
    pointer.downAt = now();
    pointer.moved = 0;
    pointer.offX = e.clientX - cat.x;
    pointer.offY = e.clientY - cat.y;
    e.preventDefault();
  });

  window.addEventListener('mouseup', function () {
    if (!pointer.down) return;
    pointer.down = false;

    if (cat.grabbed) {
      cat.grabbed = false;
      bridge.setHeld(false);
      cat.vx = clamp(cursor.vx * 0.9, -900, 900);
      cat.vy = clamp(cursor.vy * 0.9, -1100, 900);
      cat.airborne = true;
      setState('fall');
      if (Math.abs(cat.vx) > 260 || Math.abs(cat.vy) > 260) maybeSay('thrown', 0.85);
    } else {
      setState('purr');                              // a tap is a pet
      cat.energy = clamp(cat.energy + 0.05, 0, 1);
      maybeSay('pet', 0.75);
    }
  });

  // ----------------------------------------------------------- ipc + loop

  bridge.onGeometry(function (g) {
    geom = { floor: g.floor, left: g.left, right: g.right, ceiling: g.ceiling };
    resize();
    cat.x = clamp(cat.x, geom.left + 20, geom.right - 20);
    if (!cat.airborne && !cat.grabbed) cat.y = geom.floor;
  });

  bridge.onCursor(function (c) {
    // The polled global cursor drives awareness; local mousemove wins while dragging.
    if (!pointer.down) { cursor.x = c.x; cursor.y = c.y; }
    cursor.vx = c.dx / c.dt;
    cursor.vy = c.dy / c.dt;
    cursor.speed = Math.sqrt(cursor.vx * cursor.vx + cursor.vy * cursor.vy);
    if (Math.abs(c.dx) > 1 || Math.abs(c.dy) > 1) idleFor = 0;
  });

  bridge.onCommand(function (cmd) {
    if (cmd.type === 'come') {
      cat.targetX = clamp(cmd.x, geom.left + 20, geom.right - 20);
      if (cat.state === 'sleep' || cat.state === 'loaf') wake();
      setState('walk', 30);
      maybeSay('come', 0.8);
    } else if (cmd.type === 'speak') {
      talkCool = 0;                                  // menu bar overrides the cooldown
      maybeSay('random', 1);
    } else if (cmd.type === 'sleep') {
      setState('sleep');
    } else if (cmd.type === 'wander') {
      cat.wander = cmd.on;
      if (!cmd.on && (cat.state === 'walk' || cat.state === 'chase')) setState('sit');
    } else if (cmd.type === 'scale') {
      sizeKey = cmd.scale;
      scale = HEIGHTS[sizeKey] / D.h;
      localStorage.setItem('tabby.scale', String(sizeKey));
      lastRect = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lastRect = null;
  }

  window.addEventListener('resize', resize);
  resize();
  cat.y = geom.floor;
  setState('stand', 1.5);

  var last = now();
  var saveIn = 10;

  function tick() {
    requestAnimationFrame(tick);

    var t = now();
    var elapsed = t - last;
    if (elapsed * 1000 < FRAME_MS) return;
    last = t;
    var dt = Math.min(0.05, elapsed);

    update(dt);
    draw();

    saveIn -= dt;
    if (saveIn <= 0) {
      saveIn = 10;
      localStorage.setItem('tabby.energy', String(cat.energy));
    }
  }

  requestAnimationFrame(tick);
})();
