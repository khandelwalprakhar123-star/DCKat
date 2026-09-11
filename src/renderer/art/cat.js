/*
 * Vector tabby.
 *
 * Everything is drawn as anti-aliased canvas paths in a fixed 180x152 design
 * space, so the cat is resolution independent — she is rasterised straight at
 * the display's device pixels rather than blown up from a low-res grid.
 *
 * Body stays in profile; the head always faces the viewer.
 *
 * Silhouettes are drawn in two passes per group: every path is stroked with the
 * outline colour first, then all of them are filled. Interior strokes get
 * covered by the later fills, which leaves one clean outline around the group
 * instead of seams where parts overlap.
 */
(function (root) {
  'use strict';

  var DESIGN = { w: 180, h: 152, floor: 144 };

  /*
   * Two looks. Switch with PALETTES.tabby / PALETTES.noir below.
   *
   * Note the noir fur is charcoal, never true black: a pure-black cat loses all
   * interior form and reads as a silhouette. The gradient between FUR_LIT and
   * FUR_DEEP is what keeps her body legible.
   */
  var PALETTES = {
    tabby: {
      OUTLINE: '#3b2417', FUR: '#d98d3f', FUR_LIT: '#eaa963', FUR_DEEP: '#c67f36',
      STRIPE: '#ad5f24', SHADE: '#b3752f', CREAM: '#fbeed6', BELLY: '#f2dcb6',
      PINK: '#ef97a2', IRIS: '#8ed08a', DARK: '#2b1a10',
      SHEEN: 'rgba(255,225,180,0.55)', WHISKER: 'rgba(70,48,30,0.7)'
    },
    noir: {
      OUTLINE: '#0f0e13', FUR: '#3a3843', FUR_LIT: '#514f5d', FUR_DEEP: '#28262f',
      STRIPE: '#2c2a34', SHADE: '#2e2c37', CREAM: '#474553', BELLY: '#414050',
      PINK: '#9c6a74', IRIS: '#e23a30', DARK: '#0a090d',
      SHEEN: 'rgba(190,200,230,0.22)', WHISKER: 'rgba(216,220,238,0.5)'
    }
  };

  var C = PALETTES.noir;

  var OUTLINE = C.OUTLINE;
  var FUR = C.FUR;
  var FUR_LIT = C.FUR_LIT;
  var FUR_DEEP = C.FUR_DEEP;
  var STRIPE = C.STRIPE;
  var SHADE = C.SHADE;      // limbs on the far side
  var CREAM = C.CREAM;      // muzzle, paws
  var BELLY = C.BELLY;      // underside
  var PINK = C.PINK;
  var IRIS = C.IRIS;
  var DARK = C.DARK;

  var LW = 4.5;            // outline half-width

  // ------------------------------------------------------------ primitives

  function ellipsePath(cx, cy, rx, ry, rot) {
    return function (ctx) { ctx.ellipse(cx, cy, rx, ry, rot || 0, 0, Math.PI * 2); };
  }

  /* Rounded capsule between two points — used for every limb. */
  function capsule(x0, y0, x1, y1, r) {
    return function (ctx) {
      var a = Math.atan2(y1 - y0, x1 - x0);
      var n = a + Math.PI / 2;
      ctx.moveTo(x0 + Math.cos(n) * r, y0 + Math.sin(n) * r);
      ctx.lineTo(x1 + Math.cos(n) * r, y1 + Math.sin(n) * r);
      ctx.arc(x1, y1, r, n, n + Math.PI);
      ctx.lineTo(x0 + Math.cos(n + Math.PI) * r, y0 + Math.sin(n + Math.PI) * r);
      ctx.arc(x0, y0, r, n + Math.PI, n + Math.PI * 2);
      ctx.closePath();
    };
  }

  function cubic(p0, p1, p2, p3, t) {
    var u = 1 - t;
    return [
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
    ];
  }

  function samples(p0, p1, p2, p3, n) {
    var out = [];
    for (var i = 0; i <= n; i++) out.push(cubic(p0, p1, p2, p3, i / n));
    return out;
  }

  /* Polygon around a centreline whose width tapers from w0 to w1. */
  function tapered(pts, w0, w1) {
    var left = [], right = [], i;
    for (i = 0; i < pts.length; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len, ny = dx / len;
      var w = (w0 + (w1 - w0) * (i / (pts.length - 1))) / 2;
      left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
      right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
    }
    return function (ctx) {
      ctx.moveTo(left[0][0], left[0][1]);
      for (var i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
      var tip = pts[pts.length - 1];
      ctx.arc(tip[0], tip[1], w1 / 2, 0, Math.PI * 2);
      for (var j = right.length - 1; j >= 0; j--) ctx.lineTo(right[j][0], right[j][1]);
      ctx.closePath();
    };
  }

  /* Two-pass group: outline every path, then fill every path. */
  function group(ctx, parts) {
    var i, part;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = OUTLINE;
    for (i = 0; i < parts.length; i++) {
      part = parts[i];
      ctx.beginPath();
      part.p(ctx);
      ctx.lineWidth = part.w ? part.w + LW * 2 : LW * 2;
      ctx.stroke();
      if (!part.w) { ctx.fillStyle = OUTLINE; ctx.fill(); }
    }
    for (i = 0; i < parts.length; i++) {
      part = parts[i];
      ctx.beginPath();
      part.p(ctx);
      if (part.w) {
        ctx.lineWidth = part.w;
        ctx.strokeStyle = part.c;
        ctx.stroke();
        ctx.strokeStyle = OUTLINE;
      } else {
        ctx.fillStyle = part.c;
        ctx.fill();
      }
    }
  }

  function furGradient(ctx, top, bottom) {
    var g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, FUR_LIT);
    g.addColorStop(0.55, FUR);
    g.addColorStop(1, FUR_DEEP);
    return g;
  }

  function softPatch(ctx, cx, cy, rx, ry, colour) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
  }

  // ------------------------------------------------------------------ tail

  function tail(pts, w0, w1) {
    return { p: tapered(pts, w0, w1), c: FUR, pts: pts, w0: w0, w1: w1 };
  }

  function tailRings(ctx, part) {
    ctx.save();
    ctx.beginPath();
    part.p(ctx);
    ctx.clip();
    ctx.strokeStyle = STRIPE;
    ctx.lineCap = 'butt';
    var pts = part.pts;
    for (var k = 0.24; k < 1; k += 0.26) {
      var i = Math.round(k * (pts.length - 1));
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len * 20, ny = dx / len * 20;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(pts[i][0] + nx, pts[i][1] + ny);
      ctx.lineTo(pts[i][0] - nx, pts[i][1] - ny);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ head

  /* Front-facing head. h = {x, y, r, rot}; p carries expression + gaze. */
  function drawHead(ctx, h, p) {
    var eye = p.eye || 'open';
    var ear = p.ear || 0;
    var look = p.look || { x: 0, y: 0 };
    var R = h.r;

    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot || 0);
    ctx.scale(R / 34, R / 34);   // design the head at r = 34, then scale

    var earDrop = ear * 13;
    var earOut = ear * 7;

    var parts = [
      // Ears first so the skull fill covers their inner edges.
      { p: function (c) {
          c.moveTo(-30 - earOut, -14 + earDrop * 0.5);
          c.quadraticCurveTo(-31 - earOut, -40 + earDrop, -24 - earOut, -41 + earDrop);
          c.quadraticCurveTo(-14, -33, -6, -25);
          c.closePath();
        }, c: FUR },
      { p: function (c) {
          c.moveTo(30 + earOut, -14 + earDrop * 0.5);
          c.quadraticCurveTo(31 + earOut, -40 + earDrop, 24 + earOut, -41 + earDrop);
          c.quadraticCurveTo(14, -33, 6, -25);
          c.closePath();
        }, c: FUR },
      { p: ellipsePath(0, 0, 34, 31), c: FUR },
      { p: ellipsePath(-19, 9, 17, 15), c: FUR },   // cheeks
      { p: ellipsePath(19, 9, 17, 15), c: FUR }
    ];
    group(ctx, parts);

    // Skull shading + inner ears.
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(0, 0, 34, 31, 0, 0, Math.PI * 2);
    ctx.ellipse(-19, 9, 17, 15, 0, 0, Math.PI * 2);
    ctx.ellipse(19, 9, 17, 15, 0, 0, Math.PI * 2);
    ctx.clip();
    var g = ctx.createLinearGradient(0, -32, 0, 26);
    g.addColorStop(0, C.SHEEN);
    g.addColorStop(0.6, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-40, -40, 80, 70);

    // Forehead "M" and cheek bars.
    ctx.strokeStyle = STRIPE;
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    [[-11, -30, -13, -18], [0, -33, 0, -20], [11, -30, 13, -18]].forEach(function (s) {
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      ctx.quadraticCurveTo((s[0] + s[2]) / 2, (s[1] + s[3]) / 2, s[2], s[3]);
      ctx.stroke();
    });
    ctx.lineWidth = 4.5;
    [[-34, -4, -22, -2], [-33, 6, -22, 7], [34, -4, 22, -2], [33, 6, 22, 7]].forEach(function (s) {
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      ctx.lineTo(s[2], s[3]);
      ctx.stroke();
    });
    ctx.restore();

    // Inner ears.
    ctx.fillStyle = PINK;
    [-1, 1].forEach(function (s) {
      ctx.beginPath();
      ctx.moveTo(s * (24 + earOut), -18 + earDrop * 0.5);
      ctx.quadraticCurveTo(s * (24 + earOut), -31 + earDrop, s * (21 + earOut), -32 + earDrop);
      ctx.quadraticCurveTo(s * 18, -27, s * 14, -22);
      ctx.closePath();
      ctx.fill();
    });

    // Muzzle.
    softPatch(ctx, 0, 15, 21, 13, CREAM);
    softPatch(ctx, 0, 20, 15, 8, CREAM);

    drawEyes(ctx, eye, look);

    // Nose.
    ctx.beginPath();
    ctx.moveTo(-6, 6);
    ctx.lineTo(6, 6);
    ctx.quadraticCurveTo(6, 13, 0, 14.5);
    ctx.quadraticCurveTo(-6, 13, -6, 6);
    ctx.closePath();
    ctx.fillStyle = PINK;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(59,36,23,0.55)';
    ctx.stroke();

    // Mouth: corners fall below the centre. The old version curved them back up,
    // which is what made her look pleased about everything.
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 15);
    ctx.lineTo(0, 17.5);
    ctx.moveTo(0, 17.5);
    ctx.quadraticCurveTo(-5, 18.6, -9, 21.5);
    ctx.moveTo(0, 17.5);
    ctx.quadraticCurveTo(5, 18.6, 9, 21.5);
    ctx.stroke();

    if (p.cig !== false) drawCigarette(ctx);

    // Whiskers.
    ctx.strokeStyle = C.WHISKER;
    ctx.lineWidth = 1.9;
    [[-1, -4], [-1, 2], [-1, 8], [1, -4], [1, 2], [1, 8]].forEach(function (wk) {
      var s = wk[0], y = wk[1] + 12;
      ctx.beginPath();
      ctx.moveTo(s * 15, y);
      ctx.quadraticCurveTo(s * 32, y - 3, s * 46, y - 7 + wk[1] * 0.7);
      ctx.stroke();
    });

    ctx.restore();
  }

  /*
   * Cigarette, in head-local units (the head is authored at r = 34 and scaled),
   * so it inherits her head tilt and mirrors when she turns around.
   * CIG_TIP is where the ember sits — the renderer hangs smoke off it.
   */
  var CIG_BASE = [7.5, 19.5];
  var CIG_TIP = [34, 25.5];

  function drawCigarette(ctx) {
    var x0 = CIG_BASE[0], y0 = CIG_BASE[1];
    var x1 = CIG_TIP[0], y1 = CIG_TIP[1];
    var a = Math.atan2(y1 - y0, x1 - x0);
    var nx = -Math.sin(a), ny = Math.cos(a);
    var half = 2.6;

    // Paper.
    ctx.beginPath();
    ctx.moveTo(x0 + nx * half, y0 + ny * half);
    ctx.lineTo(x1 + nx * half, y1 + ny * half);
    ctx.lineTo(x1 - nx * half, y1 - ny * half);
    ctx.lineTo(x0 - nx * half, y0 - ny * half);
    ctx.closePath();
    ctx.fillStyle = '#efe9dd';
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Filter, at the mouth end.
    var fx = x0 + (x1 - x0) * 0.3, fy = y0 + (y1 - y0) * 0.3;
    ctx.beginPath();
    ctx.moveTo(x0 + nx * half, y0 + ny * half);
    ctx.lineTo(fx + nx * half, fy + ny * half);
    ctx.lineTo(fx - nx * half, fy - ny * half);
    ctx.lineTo(x0 - nx * half, y0 - ny * half);
    ctx.closePath();
    ctx.fillStyle = '#c9a063';
    ctx.fill();

    // Ash then ember at the far end.
    var ax = x0 + (x1 - x0) * 0.86, ay = y0 + (y1 - y0) * 0.86;
    ctx.beginPath();
    ctx.moveTo(ax + nx * half, ay + ny * half);
    ctx.lineTo(x1 + nx * half, y1 + ny * half);
    ctx.lineTo(x1 - nx * half, y1 - ny * half);
    ctx.lineTo(ax - nx * half, ay - ny * half);
    ctx.closePath();
    ctx.fillStyle = '#5d5a58';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x1, y1, half * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = '#ff7a2a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x1, y1, half * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd6a0';
    ctx.fill();
  }

  /* Ember position in design space, for hanging smoke particles off. */
  function cigTip(h) {
    var k = h.r / 34;
    var rot = h.rot || 0;
    var x = CIG_TIP[0] * k, y = CIG_TIP[1] * k;
    return {
      x: h.x + x * Math.cos(rot) - y * Math.sin(rot),
      y: h.y + x * Math.sin(rot) + y * Math.cos(rot)
    };
  }

  function drawEyes(ctx, eye, look) {
    var lx = Math.max(-1, Math.min(1, look.x)) * 3.2;
    var ly = Math.max(-1, Math.min(1, look.y)) * 2.6;

    if (eye === 'closed') {
      // Flat, faintly downturned lids. An upward ∪ arc here reads as delight.
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 3.4;
      ctx.lineCap = 'round';
      [-1, 1].forEach(function (s) {
        ctx.beginPath();
        ctx.moveTo(s * 7, -5);
        ctx.quadraticCurveTo(s * 14, -3.2, s * 21, -4.6);
        ctx.stroke();
      });
      return;
    }

    var big = eye === 'wide' ? 1.16 : 1;
    var rx = 9.5 * big, ry = 10.5 * big;

    [-14, 14].forEach(function (x) {
      ctx.beginPath();
      ctx.ellipse(x, -3, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = IRIS;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = OUTLINE;
      ctx.stroke();

      // Slit pupil.
      ctx.beginPath();
      ctx.ellipse(x + lx, -3 + ly, eye === 'wide' ? 4.6 : 3.3, ry * 0.82, 0, 0, Math.PI * 2);
      ctx.fillStyle = DARK;
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(x + lx - 3, -8 + ly, 2.5, 2.1, -0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
    });

    // Heavy upper lids + flat brows. Lids alone read as sleepy; the brows tip it
    // into unimpressed. Angling the inner ends down any further reads as furious.
    if (eye !== 'wide') {
      ctx.fillStyle = FUR;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      [-14, 14].forEach(function (x) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(x, -3, rx + 1.4, ry + 1.4, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillRect(x - rx - 2, -ry - 7, rx * 2 + 4, ry * 0.62);
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(x - rx * 0.95, -3 - ry * 0.42);
        ctx.lineTo(x + rx * 0.95, -3 - ry * 0.42);
        ctx.stroke();
      });

      ctx.lineWidth = 2.6;
      [-1, 1].forEach(function (s) {
        ctx.beginPath();
        ctx.moveTo(s * 22, -16.5);
        ctx.lineTo(s * 8, -14.5);
        ctx.stroke();
      });
    }

    if (eye === 'half') {
      ctx.fillStyle = FUR;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.6;
      [-14, 14].forEach(function (x) {
        ctx.beginPath();
        ctx.moveTo(x - rx - 2, -3);
        ctx.lineTo(x + rx + 2, -3);
        ctx.lineTo(x + rx + 2, -ry - 4);
        ctx.lineTo(x - rx - 2, -ry - 4);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - rx, -3);
        ctx.lineTo(x + rx, -3);
        ctx.stroke();
      });
    }
  }

  // ----------------------------------------------------------------- poses

  function legPair(xNear, xFar, hipY, footNear, footFar, r) {
    return {
      far: { p: capsule(xFar, hipY, footFar[0], footFar[1], r * 0.88), c: SHADE },
      near: { p: capsule(xNear, hipY, footNear[0], footNear[1], r), c: FUR }
    };
  }

  function poseStand(p) {
    var t = p.phase || 0;
    var moving = !!p.moving;
    var bob = moving ? Math.abs(Math.sin(t * Math.PI * 4)) * 3 : Math.sin(t * Math.PI * 2) * 1.6;
    var cy = 88 - bob;
    var hip = cy + 16;

    function foot(ph) {
      var s = Math.sin((t + ph) * Math.PI * 2);
      return moving
        ? [0 + s * 13, DESIGN.floor - Math.max(0, s) * 13]
        : [0, DESIGN.floor];
    }

    var fBackFar = foot(0.0), fFrontFar = foot(0.5);
    var fBackNear = foot(0.25), fFrontNear = foot(0.75);

    var lift = p.tailUp === undefined ? 1 : p.tailUp;
    var wave = Math.sin(t * Math.PI * 2 + 1) * (moving ? 7 : 4);
    var tPts = samples(
      [30, cy - 2],
      [4, cy - 14 - lift * 10],
      [2 + wave, cy - 52 - lift * 22],
      [26 + wave, cy - 60 - lift * 30], 22);

    var tl = tail(tPts, 17, 8);

    return {
      back: [
        tl,
        { p: capsule(48, hip, 48 + fBackFar[0], fBackFar[1], 8.5), c: SHADE },
        { p: capsule(102, hip, 102 + fFrontFar[0], fFrontFar[1], 8.5), c: SHADE }
      ],
      tailPart: tl,
      core: [{ p: ellipsePath(72, cy, 46, 27), c: null }],
      coreShade: [cy - 27, cy + 27],
      front: [
        { p: capsule(60, hip, 60 + fBackNear[0], fBackNear[1], 9.5), c: FUR },
        { p: capsule(112, hip, 112 + fFrontNear[0], fFrontNear[1], 9.5), c: FUR }
      ],
      paws: [
        [60 + fBackNear[0], fBackNear[1], 9.5], [112 + fFrontNear[0], fFrontNear[1], 9.5]
      ],
      // Sits mostly below the body edge, so only a pale underside shows.
      belly: function (ctx) {
        softPatch(ctx, 82, cy + 34, 36, 15, BELLY);
        softPatch(ctx, 111, cy + 14, 11, 14, BELLY);   // chest, under the chin
      },
      stripes: bodyStripes(72, cy, 46, 27),
      head: { x: 132, y: cy - 34 - bob * 0.3, r: 31 }
    };
  }

  function bodyStripes(cx, cy, rx, ry) {
    var out = [];
    for (var i = -3; i <= 3; i++) {
      var x = cx + i * 13 - 4;
      out.push([x + 6, cy - ry - 4, x - 1, cy - 6, x - 5, cy + ry * 0.35]);
    }
    return out;
  }

  function poseSit(p) {
    var t = p.phase || 0;
    var br = Math.sin(t * Math.PI * 2) * 1.5;
    var wave = Math.sin(t * Math.PI * 2) * 9;
    var tPts = samples([34, 122], [40, 150 + wave * 0.4], [96, 150], [140, 132 - wave], 20);
    var tl = tail(tPts, 17, 8);

    return {
      back: [tl, { p: capsule(88, 112, 90, DESIGN.floor - 2, 8.5), c: SHADE }],
      tailPart: tl,
      core: [
        { p: ellipsePath(60, 104 + br, 34, 38), c: null },
        { p: ellipsePath(98, 100 + br, 26, 34), c: null }
      ],
      coreShade: [64, 142],
      front: [{ p: capsule(100, 106 + br, 103, DESIGN.floor - 2, 9.5), c: FUR }],
      paws: [[103, DESIGN.floor - 2, 9.5], [90, DESIGN.floor - 2, 8.5]],
      belly: function (ctx) { softPatch(ctx, 103, 116 + br, 12, 20, BELLY); },
      stripes: bodyStripes(58, 100 + br, 32, 34),
      head: { x: 114, y: 54 + br, r: 32 }
    };
  }

  function poseGroom(p) {
    var t = p.phase || 0;
    var reach = Math.sin(t * Math.PI * 2) * 5;
    var base = poseSit({ phase: 0 });
    base.front = [{ p: capsule(100, 112, 114, 84 + reach, 9), c: FUR }];
    base.paws = [[114, 84 + reach, 9]];
    base.head = { x: 114, y: 62 + reach * 0.4, r: 32, rot: 0.16 };
    return base;
  }

  function poseLoaf(p) {
    var t = p.phase || 0;
    var br = Math.sin(t * Math.PI * 2) * 1.6;
    var tPts = samples([28, 124], [30, 148], [92, 150], [136, 138], 18);
    var tl = tail(tPts, 16, 8);

    return {
      back: [tl],
      tailPart: tl,
      core: [{ p: ellipsePath(80, 110 + br, 50, 29), c: null }],
      coreShade: [80, 140],
      front: [],
      paws: [],
      belly: function (ctx) { softPatch(ctx, 84, 142 + br, 34, 13, BELLY); },
      extras: function (ctx) {
        softPatch(ctx, 112, 133, 13, 6.5, CREAM);   // tucked toes
        softPatch(ctx, 132, 134, 12, 6, CREAM);
      },
      stripes: bodyStripes(78, 108 + br, 48, 28),
      head: { x: 130, y: 76 + br, r: 31 }
    };
  }

  function poseCurl(p) {
    var t = p.phase || 0;
    var br = Math.sin(t * Math.PI * 2) * 1.8;
    var tPts = samples([32, 108], [30, 146], [96, 152], [136, 132], 18);
    var tl = tail(tPts, 16, 8);

    return {
      back: [tl],
      tailPart: tl,
      core: [{ p: ellipsePath(74, 100 + br, 46, 44 + br * 0.3), c: null }],
      coreShade: [58, 144],
      front: [],
      paws: [],
      belly: function (ctx) { softPatch(ctx, 96, 140, 22, 10, BELLY); },
      stripes: bodyStripes(70, 96 + br, 44, 40),
      head: { x: 118, y: 108 + br, r: 29, rot: 0.22 }
    };
  }

  function poseStretch(p) {
    var ext = Math.sin(Math.min(1, p.phase || 0) * Math.PI);
    var tPts = samples([28, 96], [6, 74], [4, 34 - ext * 12], [26, 22 - ext * 14], 20);
    var tl = tail(tPts, 17, 8);

    return {
      back: [
        tl,
        { p: capsule(44, 108, 44, DESIGN.floor - 2, 8.5), c: SHADE },
        { p: capsule(104, 124, 132 + ext * 14, DESIGN.floor - 4, 8), c: SHADE }
      ],
      tailPart: tl,
      core: [
        { p: ellipsePath(48, 96 - ext * 6, 30, 30), c: null },
        { p: ellipsePath(90, 116 + ext * 4, 44, 21), c: null }
      ],
      coreShade: [66, 138],
      front: [
        { p: capsule(56, 110, 56, DESIGN.floor - 2, 9.5), c: FUR },
        { p: capsule(110, 126, 142 + ext * 14, DESIGN.floor - 3, 9), c: FUR }
      ],
      paws: [[56, DESIGN.floor - 2, 9.5], [142 + ext * 14, DESIGN.floor - 3, 9]],
      belly: function (ctx) { softPatch(ctx, 92, 138 + ext * 4, 32, 12, BELLY); },
      stripes: bodyStripes(88, 114 + ext * 4, 42, 20),
      head: { x: 140 + ext * 6, y: 106 + ext * 6, r: 29, rot: -0.1 }
    };
  }

  function poseFall(p) {
    var fl = Math.sin((p.phase || 0) * Math.PI * 6) * 9;
    var cy = 88;
    var tPts = samples([30, cy - 2], [0, cy - 30], [10, cy - 66], [40 + fl, cy - 74], 20);
    var tl = tail(tPts, 17, 8);

    return {
      back: [
        tl,
        { p: capsule(52, cy + 14, 24, cy + 44 + fl, 8.5), c: SHADE },
        { p: capsule(100, cy + 14, 130, cy + 40 - fl, 8.5), c: SHADE }
      ],
      tailPart: tl,
      core: [{ p: ellipsePath(72, cy, 44, 28), c: null }],
      coreShade: [cy - 28, cy + 28],
      front: [
        { p: capsule(60, cy + 16, 30, cy + 52 - fl, 9.5), c: FUR },
        { p: capsule(108, cy + 16, 140, cy + 50 + fl, 9.5), c: FUR }
      ],
      paws: [[30, cy + 52 - fl, 9.5], [140, cy + 50 + fl, 9.5]],
      belly: function (ctx) { softPatch(ctx, 80, cy + 30, 32, 13, BELLY); },
      stripes: bodyStripes(72, cy, 44, 28),
      head: { x: 130, y: cy - 34, r: 31 }
    };
  }

  var POSES = {
    stand: poseStand,
    walk: function (p) { p.moving = true; return poseStand(p); },
    sit: poseSit,
    groom: poseGroom,
    loaf: poseLoaf,
    curl: poseCurl,
    stretch: poseStretch,
    fall: poseFall
  };

  // ------------------------------------------------------------------- api

  function draw(ctx, p) {
    var pose = (POSES[p.mode] || poseStand)(p);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    var grad = furGradient(ctx, pose.coreShade[0], pose.coreShade[1]);
    pose.core.forEach(function (c) { c.c = grad; });

    // Near legs share the body's group so their tops merge into the silhouette
    // instead of reading as separate sausages stuck underneath it.
    group(ctx, pose.back.concat(pose.core, pose.front));

    // Stripes and belly, clipped to the body.
    ctx.save();
    ctx.beginPath();
    pose.core.forEach(function (c) { c.p(ctx); });
    ctx.clip();
    ctx.strokeStyle = STRIPE;
    ctx.lineWidth = 6.5;
    ctx.lineCap = 'round';
    pose.stripes.forEach(function (s) {
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]);
      ctx.quadraticCurveTo(s[2], s[3], s[4], s[5]);
      ctx.stroke();
    });
    if (pose.belly) pose.belly(ctx);
    ctx.restore();

    if (pose.tailPart) tailRings(ctx, pose.tailPart);
    if (pose.extras) pose.extras(ctx);

    // Paw tips, kept inside the leg so they read as toes rather than blobs.
    pose.paws.forEach(function (pw) {
      softPatch(ctx, pw[0], pw[1] + 1.5, (pw[2] || 9.5) * 0.88, (pw[2] || 9.5) * 0.62, CREAM);
    });

    drawHead(ctx, pose.head, p);
  }

  /* Where the face sits, so callers can aim particles and gaze at it. */
  function headOf(p) {
    return (POSES[p.mode] || poseStand)(p).head;
  }

  var api = {
    DESIGN: DESIGN, draw: draw, headOf: headOf, cigTip: cigTip,
    POSES: POSES, PALETTES: PALETTES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CatArt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
