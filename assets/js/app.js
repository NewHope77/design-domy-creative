/* Design Domy Creative: day/evening scene, scroll story, catalogue, gallery, enquiry form. No dependencies.
   Scroll rule: geometry is measured once, and each frame only writes opacity and transform on layers that really changed. */
(function () {
  'use strict';

  function $(s, c) { return (c || document).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  var root = document.documentElement;
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setOp(el, v) {
    if (!el) return;
    v = Math.round(v * 500) / 500;
    if (el.__op === v) return;
    el.__op = v;
    el.style.opacity = v;
  }
  function setTf(el, t) {
    if (!el || el.__tf === t) return;
    el.__tf = t;
    el.style.transform = t;
  }
  function setClass(el, name, on) {
    if (!el) return;
    var key = '__c_' + name;
    if (el[key] === on) return;
    el[key] = on;
    el.classList.toggle(name, on);
  }

  /* ---------- theme = time of day ---------- */
  var themeListeners = [];
  function isDark() { return root.getAttribute('data-theme') === 'dark'; }
  function setTheme(dark, animate) {
    if (animate && !reduced) {
      root.classList.add('theme-anim');
      setTimeout(function () { root.classList.remove('theme-anim'); }, 900);
    }
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { localStorage.setItem('ddc-theme', dark ? 'dark' : 'light'); } catch (e) {}
    themeListeners.forEach(function (fn) { fn(dark); });
  }
  $$('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () { setTheme(!isDark(), true); });
  });

  /* ---------- header & drawer ---------- */
  var header = $('.header');
  var drawer = $('.drawer');
  var burger = $('.burger');
  function setDrawer(open) {
    if (!drawer) return;
    drawer.classList.toggle('open', open);
    if (burger) burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
  }
  if (burger) burger.addEventListener('click', function () { setDrawer(!drawer.classList.contains('open')); });
  $$('[data-drawer-close]').forEach(function (el) { el.addEventListener('click', function () { setDrawer(false); }); });

  /* ---------- reveal ---------- */
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      io.unobserve(en.target);
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' }) : null;
  $$('[data-reveal]').forEach(function (el) { if (io) io.observe(el); else el.classList.add('in'); });

  /* ---------- decode images before they scroll into view, so they never hold up a frame ---------- */
  if ('IntersectionObserver' in window) {
    var decodeIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        decodeIo.unobserve(en.target);
        var im = en.target;
        var go = function () { if (im.decode) im.decode().catch(function () {}); };
        if (im.complete) go(); else im.addEventListener('load', go, { once: true });
      });
    }, { rootMargin: '1400px 0px' });
    $$('img').forEach(function (im) { decodeIo.observe(im); });
  }

  /* ---------- endless animations run only while their block is on screen ---------- */
  if ('IntersectionObserver' in window) {
    var pauseIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { en.target.classList.toggle('is-paused', !en.isIntersecting); });
    }, { rootMargin: '60px 0px' });
    $$('.hero__pin, .marquee, .stage').forEach(function (el) { pauseIo.observe(el); });
  }

  var active = { hero: true, build: false, words: false };

  /* ---------- hero: day to evening, on the render's own trees and sky ---------- */
  var hero = $('[data-hero]');
  var heroState = null;
  if (hero) {
    var pin = $('.hero__pin', hero);
    var scene = $('[data-scene]', hero);
    var copy = $('.hero__copy', hero);
    var caption = $('[data-hero-caption]', hero);
    var lightsBtn = $('[data-lights]', hero);
    var lightsLabel = lightsBtn && $('[data-lights-label]', lightsBtn);
    var fadeOut = $$('[data-hero-copy]', hero);
    var L = {};
    $$('[data-l]', hero).forEach(function (el) { L[el.getAttribute('data-l')] = el; });
    var lamps = $$('.eve-l', hero).map(function (el) { return { el: el, at: parseFloat(el.getAttribute('data-at')) }; });
    var forced = isDark() ? 1 : 0;   // what the switch asks for: 0 = follow scroll, 1 = evening
    var shownForce = forced;
    var geo = { range: 1, d0: 0, d1: 0, bottom: 0, vw: 1, vh: 1, W: 1 };
    var landscape = window.matchMedia('(min-width: 900px) and (min-aspect-ratio: 13/10)');
    var view = { n: forced, d: 0 };   // what the shader has to match
    var LOWEST = 990;                 // the painted ground ends here, in the render's coordinates
    var upright = window.matchMedia('(max-aspect-ratio: 4/5)');
    var skyDay = $('.sky__day', hero);

    var measure = function () {
      var vw = window.innerWidth, vh = pin.clientHeight;
      var was = parseFloat(copy.style.marginTop) || 0;
      var copyBottom = copy.offsetTop - was + copy.offsetHeight;
      var margin = 0, W, s;
      if (landscape.matches) {
        // the whole house from the first moment: the ridge (y 51) just under the buttons, the garden around it as far as the screen goes.
        // The scene (2400 wide) always fills the screen; on a very low screen only the foreground runs past the bottom, never the house
        var room = vh - (copyBottom + 12);
        s = Math.max(room / (LOWEST - 51), vw / 2400);
        W = s * 1350;
        geo.d0 = geo.d1 = (900 - Math.min(LOWEST, 51 + room / s)) * s;
      } else {
        // upright screens: the house fills the width, only the garden edges run past the screen
        W = vw <= 640 || upright.matches ? vw * 1.22 : Math.min(vw, Math.max(vh * 1.95, 1100));
        s = W / 1350;
        // at the start the roof sits just under the buttons; at the end the house is whole, right below the header.
        // A tall screen shows more of the ground below the render
        var below = (900 - LOWEST) * s;
        var overflow = copyBottom + 10 + 849 * s - vh;
        geo.d0 = Math.max(below, overflow);
        geo.d1 = Math.max(below, Math.min(geo.d0, (vw <= 640 ? 70 : 62) + 860 * s - vh));
        // what is left of the sky goes above and below the text, so the text does not hang under the header with a hole beneath it
        margin = Math.max(0, (vh + geo.d0 - 849 * s - copyBottom - 30) * .42);
      }
      if (margin !== was) copy.style.marginTop = margin ? margin.toFixed(1) + 'px' : '';
      var H = 860 * s;
      scene.style.setProperty('--sw', W.toFixed(1) + 'px');
      // the plain sky under the land, until the shader takes over: in place on a wide screen, only its real sky on an upright one (CSS)
      skyDay.style.backgroundSize = landscape.matches ? (2400 * s).toFixed(0) + 'px auto' : '';
      skyDay.style.backgroundPosition = landscape.matches ? '50% ' + (vh + geo.d0 - 1260 * s).toFixed(0) + 'px' : '';
      geo.range = Math.max(1, hero.offsetHeight - vh);
      geo.bottom = hero.offsetTop + hero.offsetHeight;
      geo.vw = vw; geo.vh = vh; geo.W = W;
      geo.H = H;
      // a tall screen shows more sky than the picture has (it ends at y -360): higher up the clouds grow to fill it, as overhead in a real sky.
      // Below y 40 nothing changes, so what is hidden behind the house never comes into view
      var high = 40 - (900 - (vh + geo.d0) / s), lo = 0, hi = 1;
      if (high > 400) {
        for (var i = 0; i < 30; i++) {
          var k = (lo + hi) / 2, z = 1 + 150 * k;
          if (Math.log(z) / k + (high - 150) / z > 400) lo = k; else hi = k;
        }
      }
      geo.skyK = high > 400 ? hi : 0;
      setClass(header, 'under-trees', vh + geo.d0 - (900 + 266) * s < 62);   // the top of the rowan's crown is at y -266
      if (sky) sky.resize();
    };

    var paint = function () {
      var p = reduced ? 0 : clamp(window.scrollY / geo.range, 0, 1);
      var e = Math.max(clamp(p / .92, 0, 1), shownForce);     // how far the evening has come
      var d = geo.d0 + (geo.d1 - geo.d0) * easeOut(clamp(p / .62, 0, 1));
      var cp = 1 - smooth(.02, .2, p);
      setTf(scene, 'translateX(-50%) translateY(' + d.toFixed(1) + 'px)');
      var dusk = smooth(.1, .66, e);                          // the same pixels, less and less daylight
      setOp(L.eve, dusk); setOp(L.landE, dusk);
      setClass(hero, 'eve-done', dusk >= 1);                  // the bright day picture must not show through the soft edge of the dark one
      setOp(L.skyN, smooth(.3, .78, e));
      setOp(L.tint, smooth(.06, .3, e) * (1 - smooth(.36, .62, e)));
      lamps.forEach(function (lamp) { setOp(lamp.el, smooth(lamp.at, lamp.at + .12, e)); });
      setOp(L.flies, smooth(.72, .95, e));
      // the moon comes down from above the screen to its place over the roof: pale while it is still light, bright when it is dark
      var mt = clamp((e - .14) / .72, 0, 1);
      setOp(L.moon, smooth(.14, .6, e));
      setTf(L.moon, 'translateY(' + (-(1 - mt * (1.5 - mt * .5)) * (geo.vh - geo.H * 1.005 + d + geo.W * .0593 + 60)).toFixed(1) + 'px)');
      fadeOut.forEach(function (el) {
        setOp(el, cp);
        // a faded-out headline must not repaint its soft shadow when the colours change to evening
        var hide = cp <= 0;
        if (el.__hid !== hide) { el.__hid = hide; el.style.visibility = hide ? 'hidden' : ''; }
      });
      setTf(copy, 'translateY(' + ((1 - cp) * -30).toFixed(1) + 'px)');
      var night = e > .45;
      setClass(hero, 'is-night', night);
      setClass(header, 'is-night', night);
      setClass(header, 'is-dusk', e > .08);
      setClass(caption, 'show', p > .8);
      if (view.n !== e || view.d !== d) {
        view.n = e; view.d = d;
        if (sky) sky.draw();
      }
    };

    /* the living background: clouds drift behind the trees, the wind moves the leaves, stars twinkle.
       One small shader on one canvas; the house itself stays a sharp image on top, so it never moves. */
    var sky = (function () {
      var canvas = $('.sky__gl', hero);
      if (!canvas || !window.WebGLRenderingContext) return null;
      var gl;
      try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' }); } catch (e) { return null; }
      if (!gl) return null;
      var VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
      var FS = [
        '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
        'uniform sampler2D uLandD,uLandN,uSky,uWind;uniform vec2 uRes;uniform float uDpr,uScale,uCx,uBottom,uTime,uN,uK;',
        'float mir(float x){return abs(mod(x+1.,2.)-1.);}',
        'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
        'void main(){',
        ' vec2 css=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uDpr;',
        ' vec2 f=vec2((css.x-uCx)/uScale+675.,900.-(uBottom-css.y)/uScale);',
        ' vec2 uv=vec2((f.x+525.)/2400.,(f.y+360.)/1350.);',                     // the render sits at 525,360 inside the 2400x1350 scene
        ' float w=texture2D(uWind,uv).r;',
        ' float s=sin(uTime*.9+f.x*.012+f.y*.02)*.6+sin(uTime*1.7+f.y*.05+f.x*.03)*.3+sin(uTime*3.1+f.x*.11+f.y*.09)*.12;',
        ' vec2 luv=uv+vec2(s,s*.35)*w*vec2(3.4/2400.,3.4/1350.);',
        ' float dk=smoothstep(.1,.66,uN);',   // the same moment as the house on top
        ' vec4 l=mix(texture2D(uLandD,luv),texture2D(uLandN,luv),dk);',
        ' if(uv.y<0.)l=vec4(0.);',
        ' float h=max(0.,40.-f.y),hr=min(h,150.),z=1.+uK*hr;',
        ' vec2 sp=vec2((f.x-675.)/z+675.,uK>0.&&h>0.?40.-log(z)/uK-(h-hr)/z:f.y);',
        ' vec3 k=texture2D(uSky,vec2(mir((sp.x+525.+uTime*5.)/2400.),mir((sp.y+360.)/1350.))).rgb;',
        ' float cl=smoothstep(.5,.86,dot(k,vec3(.3,.59,.11)));',                 // the real clouds stay and change colour with the rest
        ' float hz=smoothstep(-160.,540.,sp.y);',
        ' vec3 gold=mix(mix(vec3(.3,.42,.74),vec3(1.,.66,.4),hz*hz),vec3(1.,.73,.62)*(.76+.24*hz),cl*.85);',   // sunset, orange at the horizon
        ' vec3 dusk=mix(vec3(.05,.09,.25),vec3(.5,.32,.4),hz*hz*hz);dusk=mix(dusk,dusk*.55+vec3(.16,.13,.2),cl*.8);',   // the glow is going, deep blue from above
        ' vec3 night=mix(vec3(.027,.067,.18),vec3(.12,.19,.4),smoothstep(-500.,560.,sp.y));night*=1.+cl*.28;',
        ' k=mix(mix(mix(k,gold,smoothstep(.08,.36,uN)),dusk,smoothstep(.34,.6,uN)),night,smoothstep(.56,.86,uN));',
        ' vec2 q=f*uScale/3.;float r=hash(floor(q));',
        ' k+=step(.9935,r)*smoothstep(.55,.12,length(fract(q)-.5))*(.55+.45*sin(uTime*(.6+r*2.4)+r*60.))*vec3(1.,.97,.9)*smoothstep(.56,.9,uN)*(1.-cl*.8);',
        ' gl_FragColor=vec4(l.rgb+k*(1.-l.a),1.);',
        '}'
      ].join('\n');
      function shader(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; }
      var prog = gl.createProgram();
      gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      gl.useProgram(prog);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var aLoc = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(aLoc);
      gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
      var U = {};
      ['uRes', 'uDpr', 'uScale', 'uCx', 'uBottom', 'uTime', 'uN', 'uK', 'uLandD', 'uLandN', 'uSky', 'uWind'].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
      var ready = false, time = 0, lastT = 0, running = false, animOff = reduced, skip = false;
      var phone = window.innerWidth <= 640;
      var dprMax = phone ? 1.25 : 1.5, dpr = 1;
      var dts = [];

      function upload(slot, name, source) {
        gl.activeTexture(gl.TEXTURE0 + slot);
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.uniform1i(U[name], slot);
      }
      function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, dprMax);
        canvas.width = Math.round(geo.vw * dpr);
        canvas.height = Math.round(geo.vh * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        if (ready) draw();
      }
      function draw() {
        if (!ready) return;
        gl.uniform2f(U.uRes, canvas.width, canvas.height);
        gl.uniform1f(U.uDpr, dpr);
        gl.uniform1f(U.uScale, geo.W / 1350);
        gl.uniform1f(U.uCx, geo.vw / 2);
        gl.uniform1f(U.uBottom, geo.vh + view.d);
        gl.uniform1f(U.uTime, time);
        gl.uniform1f(U.uN, view.n);
        gl.uniform1f(U.uK, geo.skyK);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      function tick(t) {
        if (!running) return;
        requestAnimationFrame(tick);
        var dt = lastT ? t - lastT : 16;
        lastT = t;
        if (animOff || document.hidden) return;
        time += Math.min(dt, 50) / 1000;
        // protect slow devices: first lower the inner resolution, then stop the motion and keep the still picture
        dts.push(dt);
        if (dts.length >= 50) {
          var avg = dts.reduce(function (x, y) { return x + y; }, 0) / dts.length;
          dts = [];
          if (avg > 42 && dprMax > 1) { dprMax = 1; resize(); }
          else if (avg > 62) { animOff = true; return; }
        }
        skip = !skip;            // slow motion looks the same at half the frame rate, and costs half
        if (!skip) draw();
      }
      function wake() {
        var want = ready && active.hero && !animOff;
        if (want && !running) { running = true; lastT = 0; requestAnimationFrame(tick); }
        if (!want) running = false;
      }
      function start() {
        var dayLand = $('[data-land="day"]', hero), eveLand = $('[data-land="eve"]', hero);
        var root = document.body.getAttribute('data-root') || '';
        var skyImg = new Image(), windImg = new Image();
        skyImg.src = root + 'assets/img/hero/sky-day.jpg';
        windImg.src = root + 'assets/img/hero/wind.webp';
        var all = [dayLand, eveLand, skyImg, windImg];
        Promise.all(all.map(function (im) { return im.decode ? im.decode() : Promise.resolve(); })).then(function () {
          // one texture per frame, so the upload never holds up scrolling
          var jobs = [[0, 'uLandD', dayLand], [1, 'uLandN', eveLand], [2, 'uSky', skyImg], [3, 'uWind', windImg]];
          (function next() {
            var j = jobs.shift();
            if (j) { upload(j[0], j[1], j[2]); requestAnimationFrame(next); return; }
            ready = true;
            resize();
            draw();
            hero.classList.add('gl-on');
            setTimeout(function () { hero.classList.add('gl-done'); }, 750);   // once the canvas has faded in over the plain images
            wake();
          })();
        }).catch(function () { /* the plain images stay */ });
      }
      canvas.addEventListener('webglcontextlost', function () { hero.classList.remove('gl-on', 'gl-done'); ready = false; });
      return { resize: resize, draw: draw, wake: wake, start: start };
    })();

    var animTo = function (target) {
      if (reduced) { shownForce = target; paint(); return; }
      var from = shownForce, t0 = null, dur = 2600;
      var step = function (t) {
        if (t0 === null) t0 = t;
        var k = clamp((t - t0) / dur, 0, 1);
        shownForce = from + (target - from) * k * k * (3 - 2 * k);
        paint();
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    var syncSwitch = function () {
      if (!lightsBtn) return;
      lightsBtn.classList.toggle('is-lit', forced === 1);
      lightsBtn.setAttribute('aria-pressed', forced === 1 ? 'true' : 'false');
      if (lightsLabel) lightsLabel.textContent = forced === 1 ? 'Zgaś światła' : 'Zapal światła';
    };
    if (lightsBtn) lightsBtn.addEventListener('click', function () { setTheme(forced !== 1, true); });
    themeListeners.push(function (dark) { forced = dark ? 1 : 0; animTo(forced); syncSwitch(); });

    measure(); paint(); syncSwitch();
    heroState = { measure: measure, paint: paint, geo: geo, sky: sky };
    // show the evening pictures to the GPU once, invisibly: their first real appearance during the scroll then needs no upload
    var warmUp = function () {
      if (shownForce > 0) return;
      [L.eve, L.moon].concat(lamps.map(function (lamp) { return lamp.el; })).forEach(function (el) {
        var go = function () {
          if (el.__op > 0) return;
          el.style.opacity = '.004';
          setTimeout(function () { if (!el.__op) el.style.opacity = 0; }, 500);
        };
        if (el.decode) el.decode().then(go, function () {}); else go();
      });
    };
    setTimeout(warmUp, 300);
    // the trees fade in once they are ready, instead of popping in behind the house
    var dayLandEl = $('[data-land="day"]', hero);
    var landReady = function () { hero.classList.add('land-ready'); };
    if (dayLandEl) {
      if (dayLandEl.decode) dayLandEl.decode().then(landReady, landReady);
      else landReady();
    }
  }

  /* ---------- statement: words light up while scrolling ---------- */
  var wordBox = $('[data-words]');
  var words = wordBox ? $$('span', wordBox) : [];
  var wordGeo = { top: 0, height: 1 };
  var wordsOn = 0;
  function paintWords(y) {
    var vh = window.innerHeight;
    var prog = clamp((y + vh * .86 - wordGeo.top) / (wordGeo.height + vh * .38), 0, 1);
    var upto = Math.round(prog * words.length);
    if (upto === wordsOn) return;
    var a = Math.min(upto, wordsOn), b = Math.max(upto, wordsOn);
    for (var i = a; i < b; i++) words[i].classList.toggle('on', i < upto);
    wordsOn = upto;
  }

  /* ---------- a day in your home: section colour follows the card ---------- */
  var dayBox = $('[data-day]');
  if (dayBox && 'IntersectionObserver' in window) {
    var dayIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) dayBox.setAttribute('data-now', en.target.getAttribute('data-phase')); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    $$('.daycard', dayBox).forEach(function (c, i) {
      dayIo.observe(c);
      c.style.zIndex = i + 1;   // sticky cards overlap: keep the stack in order
      if (i === 0) dayBox.setAttribute('data-now', c.getAttribute('data-phase'));
    });
  }

  /* ---------- assembly: parts land as you scroll ---------- */
  var build = $('[data-build]');
  var isoEl = build && $('.iso', build);
  var parts = build ? $$('.pt', build).map(function (el) {
    return { el: el, a: +el.getAttribute('data-a'), b: +el.getAttribute('data-b'), dy: +el.getAttribute('data-dy'), fade: el.hasAttribute('data-fade'), state: null, t: -1 };
  }) : [];
  var bsteps = build ? $$('.bstep', build) : [];
  var bdots = build ? $$('.bdots i', build) : [];
  var STEP_AT = [0, .16, .4, .53, .74, .88];
  var buildGeo = { top: 0, range: 1, k: 1 };
  var buildStep = -1;
  function paintBuild(y) {
    var p = clamp((y - buildGeo.top) / buildGeo.range, 0, 1);
    parts.forEach(function (o) {
      var t = easeOut(clamp((p - o.a) / (o.b - o.a), 0, 1));
      var state = t <= 0 ? 'wait' : t >= 1 ? 'done' : 'move';
      // a layer exists only just before and during its own landing
      var near = state === 'move' || (state === 'wait' && p > o.a - .04);
      if (o.near !== near) { o.near = near; o.el.style.willChange = near ? 'transform, opacity' : 'auto'; }
      if (state === o.state && (state !== 'move' || t === o.t)) return;
      o.state = state; o.t = t;
      if (state === 'wait') { o.el.style.visibility = 'hidden'; return; }
      o.el.style.visibility = 'visible';
      o.el.style.opacity = state === 'done' ? 1 : (o.fade ? t : Math.min(1, t * 4));
      o.el.style.transform = state === 'done' || !o.dy ? 'none' : 'translate3d(0,' + (o.dy * buildGeo.k * (1 - t)).toFixed(1) + 'px,0)';
    });
    var cur = 0;
    STEP_AT.forEach(function (v, i) { if (p >= v) cur = i; });
    if (cur !== buildStep) {
      buildStep = cur;
      bsteps.forEach(function (s, i) { s.classList.toggle('is-on', i === cur); });
      bdots.forEach(function (d, i) { d.classList.toggle('on', i <= cur); });
    }
  }
  if (build && reduced) parts.forEach(function (o) { o.el.style.visibility = 'visible'; });

  /* ---------- scroll loop ---------- */
  var ticking = false;
  var mbar = $('.mbar');
  var mbarAt = 280;
  function onFrame() {
    ticking = false;
    var y = window.scrollY;
    setClass(header, 'is-scrolled', y > 10);
    setClass(mbar, 'show', y > mbarAt);
    if (heroState) {
      setClass(header, 'is-past', y > heroState.geo.bottom - 90);
      if (active.hero) heroState.paint();
    }
    if (build && active.build && !reduced) paintBuild(y);
    if (words.length && active.words && !reduced) paintWords(y);
  }
  function requestFrame() { if (!ticking) { ticking = true; requestAnimationFrame(onFrame); } }

  function measureAll() {
    if (heroState) heroState.measure();
    mbarAt = hero ? hero.offsetHeight - window.innerHeight * .6 : 280;   // not before the evening has come
    if (build) {
      buildGeo.top = build.getBoundingClientRect().top + window.scrollY;
      buildGeo.range = Math.max(1, build.offsetHeight - window.innerHeight);
      buildGeo.k = isoEl.clientWidth / 784;
    }
    if (wordBox) {
      var b = wordBox.getBoundingClientRect();
      wordGeo.top = b.top + window.scrollY;
      wordGeo.height = b.height;
    }
    requestFrame();
  }
  measureAll();

  if ('IntersectionObserver' in window) {
    var zoneIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        active[en.target.__zone] = en.isIntersecting;
        if (en.isIntersecting) requestFrame();
        if (en.target.__zone === 'hero' && heroState && heroState.sky) heroState.sky.wake();
      });
    }, { rootMargin: '120px 0px' });
    [[hero, 'hero'], [build, 'build'], [wordBox, 'words']].forEach(function (z) {
      if (z[0]) { z[0].__zone = z[1]; zoneIo.observe(z[0]); }
    });
  } else {
    active.hero = !!hero; active.build = !!build; active.words = !!wordBox;
  }

  window.addEventListener('scroll', requestFrame, { passive: true });
  window.addEventListener('resize', measureAll);
  window.addEventListener('load', measureAll);
  if (heroState && heroState.sky) setTimeout(heroState.sky.start, 0);   // no need to wait for the rest of the page
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureAll);
  if ('ResizeObserver' in window) {
    var roTick = false;
    new ResizeObserver(function () {
      if (roTick) return;
      roTick = true;
      requestAnimationFrame(function () { roTick = false; measureAll(); });
    }).observe(document.body);
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setDrawer(false); closeLb(); } });
  if (build && !reduced) paintBuild(window.scrollY);

  /* ---------- counters ---------- */
  $$('[data-count]').forEach(function (el) {
    if (reduced) return;
    var target = +el.getAttribute('data-count'), t0 = null;
    el.textContent = '0';
    var step = function (t) {
      if (t0 === null) t0 = t;
      var k = clamp((t - t0) / 1400, 0, 1);
      el.textContent = Math.round(target * easeOut(k));
      if (k < 1) requestAnimationFrame(step);
    };
    setTimeout(function () { requestAnimationFrame(step); }, 700);
  });

  /* ---------- catalogue ---------- */
  if (window.matchMedia && matchMedia('(hover: hover)').matches) {
    // the full scene is fetched only when someone actually points at the card
    $$('[data-hover-scene]').forEach(function (a) {
      a.closest('.dom').addEventListener('mouseenter', function () {
        if (a.__scene) return;
        a.__scene = true;
        var im = new Image();
        im.className = 'dom__scene';
        im.alt = '';
        im.decoding = 'async';
        im.onload = function () { a.appendChild(im); requestAnimationFrame(function () { a.classList.add('has-scene'); }); };
        im.src = a.getAttribute('data-hover-scene');
      });
    });
  }
  var grid = $('[data-grid]');
  if (grid) {
    var cards = $$('.dom', grid);
    var filter = $('[data-filter]');
    var sort = $('[data-sort]');
    var applyGrid = function () {
      var f = filter ? ($('[aria-pressed="true"]', filter) || {}).getAttribute('data-f') : 'all';
      var mode = sort ? sort.value : 'order';
      cards.slice().sort(function (a, b) {
        if (mode === 'price-asc') return +a.dataset.price - +b.dataset.price;
        if (mode === 'price-desc') return +b.dataset.price - +a.dataset.price;
        if (mode === 'area-asc') return +a.dataset.area - +b.dataset.area;
        if (mode === 'area-desc') return +b.dataset.area - +a.dataset.area;
        return +a.dataset.order - +b.dataset.order;
      }).forEach(function (c) {
        c.hidden = !(f === 'all' || c.dataset.type === f);
        c.classList.add('in');
        grid.appendChild(c);
      });
    };
    if (filter) $$('button', filter).forEach(function (b) {
      b.addEventListener('click', function () {
        $$('button', filter).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        applyGrid();
      });
    });
    if (sort) sort.addEventListener('change', applyGrid);
  }

  /* ---------- receipt: surowy / deweloperski ---------- */
  var rc = $('[data-receipt]');
  if (rc) {
    var rcBtns = $$('[data-rc]', rc);
    rcBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        rcBtns.forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
        $$('[data-rc-panel]', rc).forEach(function (panel) { panel.hidden = panel.getAttribute('data-rc-panel') !== b.getAttribute('data-rc'); });
      });
    });
  }

  /* ---------- project gallery ---------- */
  var main = $('[data-gallery-main]');
  if (main) {
    var mainImg = $('img', main);
    var thumbs = $$('[data-thumb]');
    var setMain = function (src) {
      mainImg.style.opacity = .35;
      var pre = new Image();
      pre.onload = function () { mainImg.src = src; main.href = src; mainImg.style.opacity = 1; };
      pre.src = src;
    };
    thumbs.forEach(function (b) {
      b.addEventListener('click', function () {
        thumbs.forEach(function (x) { x.classList.toggle('is-on', x === b); });
        setMain(b.getAttribute('data-thumb'));
      });
    });
    var ev = $('[data-evening]');
    if (ev) {
      var lit = false;
      new Image().src = ev.getAttribute('data-evening');
      ev.addEventListener('click', function () {
        lit = !lit;
        ev.classList.toggle('is-lit', lit);
        $('[data-lights-label]', ev).textContent = lit ? 'Zgaś światła' : 'Zapal światła';
        var src = ev.getAttribute(lit ? 'data-evening' : 'data-day');
        thumbs.forEach(function (x) { x.classList.toggle('is-on', x.getAttribute('data-thumb') === src); });
        setMain(src);
      });
    }
  }
  $$('[data-plan]').forEach(function (b, _, all) {
    b.addEventListener('click', function () {
      all.forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      $$('[data-plan-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-plan-panel') !== b.getAttribute('data-plan'); });
    });
  });

  /* ---------- lightbox ---------- */
  var lb = null;
  function closeLb() { if (lb) { lb.classList.remove('open'); document.body.style.overflow = ''; } }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-lightbox]');
    if (!a) return;
    e.preventDefault();
    if (!lb) {
      lb = document.createElement('div');
      lb.className = 'lb';
      lb.setAttribute('role', 'dialog');
      lb.setAttribute('aria-label', 'Powiększenie');
      lb.innerHTML = '<img alt=""><button class="icon-btn lb__close" type="button" aria-label="Zamknij"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
      lb.addEventListener('click', closeLb);
      document.body.appendChild(lb);
    }
    $('img', lb).src = a.getAttribute('href');
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
  });

  /* ---------- enquiry form: prepares an e-mail in the visitor's own mail app, like on the old site ---------- */
  var form = $('form[data-mail]');
  if (form) {
    var q = new URLSearchParams(location.search).get('dom');
    if (q && form.elements.dom) form.elements.dom.value = q;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true;
      $$('.field', form).forEach(function (f) {
        var inp = $('input, textarea, select', f);
        var bad = inp && !inp.checkValidity();
        f.classList.toggle('invalid', !!bad);
        if (bad) ok = false;
      });
      if (!ok) { var first = $('.invalid', form); if (first) first.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }); return; }
      var el = form.elements;
      var dom = el.dom.options[el.dom.selectedIndex].text;
      var lines = ['Imię: ' + el.imie.value, 'E-mail: ' + el.email.value, 'Telefon: ' + (el.telefon.value || '-'), 'Lokalizacja działki: ' + el.lokalizacja.value,
        'Interesujący dom: ' + dom, 'Planowany metraż: ' + (el.metraz.value || '-'), 'Etap: ' + el.etap.value, '', el.wiadomosc.value];
      var href = 'mailto:' + form.getAttribute('data-mail') + '?subject=' + encodeURIComponent('Zapytanie o budowę domu: ' + el.lokalizacja.value) + '&body=' + encodeURIComponent(lines.join('\n'));
      form.innerHTML = '<div class="sent"><div class="sent__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></div>' +
        '<h2>Zapytanie gotowe</h2><p>Otwieramy Twoją pocztę. Sprawdź treść i wyślij wiadomość.</p><a class="btn btn--accent btn--lg" data-mailto href="">Otwórz pocztę</a></div>';
      $('[data-mailto]', form).href = href;
      window.location.href = href;
    });
    $$('input, textarea', form).forEach(function (inp) {
      inp.addEventListener('input', function () { var f = inp.closest('.field'); if (f && inp.checkValidity()) f.classList.remove('invalid'); });
    });
  }
})();
