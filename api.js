/* Jarvis website bridge: the dashboard page talks to your Jarvis API with your session key.
   Speed: every page shows its last copy instantly and refreshes itself in the background, and the
   main pages are fetched ahead in one trip. That copy and the session key stay on this device only,
   for at most 6 hours, and "Sign out" wipes both. */
(function () {
  var API_URL = 'https://script.google.com/macros/s/AKfycbx7FeaoVlZbw-2nv_ouBJdag0gqMo2LtIA8lRCBBLMD2Xe4L_j1XgDWMdDppEYFoZR8/exec';
  var KEY = 'jarvis_session';
  var CKEY = 'jarvis_cache';
  var MAX_AGE = 6 * 3600 * 1000 - 60000;

  function token() {
    try {
      var t = localStorage.getItem(KEY), at = Number(localStorage.getItem(KEY + '_t') || 0);
      return t && Date.now() - at < MAX_AGE ? t : null;
    } catch (e) { return null; }
  }
  function clearToken() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '_t'); localStorage.removeItem(CKEY); sessionStorage.removeItem(KEY); } catch (e) {}
  }
  if (!token()) { clearToken(); location.replace('./'); return; }

  function post(body) {
    return fetch(API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow', cache: 'no-store' })
      .then(function (r) { return r.json(); });
  }

  /* ---------- last-copy cache for pages that only read data ---------- */
  // function -> page it draws (that page is redrawn when fresher data arrives)
  var READS = { getHome: 'home', listTasks: 'tasks', listMail: 'inbox', listEvents: 'calendar', listNotes: 'memory',
    getChat: 'jarvis', getNotifications: 'alerts', listTags: '', listFacts: '', getSettings: '', getAISettings: '',
    getNotifySettings: '', getTelegramStatus: '', listHelpers: '', getWebLogin: '' };
  // calls that do not change your data (so they do not throw the cache away)
  var KEEP = { jarvis: 1, ask: 1, driveSearch: 1, testAI: 1, listAIModels: 1, recordFeedback: 1, markNotificationsRead: 1 };
  var mem = {};
  try { mem = JSON.parse(localStorage.getItem(CKEY) || '{}') || {}; } catch (e) { mem = {}; }
  var saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(CKEY, JSON.stringify(mem)); }
      catch (e) { try { localStorage.removeItem(CKEY); } catch (e2) {} }   // storage full: keep memory only
    }, 300);
  }
  function keyOf(fn, args) { return fn + '|' + JSON.stringify(args || []); }
  function remember(fn, args, result) {
    var s = JSON.stringify(result);
    if (s && s.length < 400000) { mem[keyOf(fn, args)] = s; persist(); }
    return s;
  }
  function forgetAll() { mem = {}; persist(); }

  function typing() {
    var a = document.activeElement;
    return a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && String(a.value || '').length > 0;
  }
  // redraw the page on screen when newer data arrived for it (never while you are typing)
  function redraw(fn) {
    var p = READS[fn];
    if (!p || !window.state || window.state.page !== p || typing() || typeof window.go !== 'function') return;
    var y = window.scrollY;
    redraw.busy = true;
    try { window.go(p); } finally { redraw.busy = false; }
    window.scrollTo(0, y);
  }

  function handle(r, ok, fail, fn, args, hadCopy, oldCopy) {
    if (r && r.ok) {
      if (READS.hasOwnProperty(fn)) {
        var s = remember(fn, args, r.result);
        if (!hadCopy) { if (ok) ok(r.result); }
        else if (s !== oldCopy) redraw(fn);
      } else {
        if (!KEEP[fn]) forgetAll();
        if (ok) ok(r.result);
      }
      return;
    }
    if (r && r.signedOut) { clearToken(); location.replace('./?expired=1'); return; }
    if (!hadCopy && fail) fail(new Error((r && r.error) || 'Something went wrong.'));
  }

  /* Same shape as Google's google.script.run, so the dashboard code works unchanged. */
  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (t, name) {
        if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
        if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
        if (name === 'withUserObject') return function () { return runner(ok, fail); };
        return function () {
          var fn = String(name), args = Array.prototype.slice.call(arguments);
          var copy = READS.hasOwnProperty(fn) ? mem[keyOf(fn, args)] : undefined;
          if (copy !== undefined) {
            // show the last copy at once...
            setTimeout(function () { try { if (ok) ok(JSON.parse(copy)); } catch (e) {} }, 0);
            // ...and refresh it, unless this draw is itself a refresh
            if (redraw.busy) return;
          }
          post({ action: 'call', token: token(), fn: fn, args: args })
            .then(function (r) { handle(r, ok, fail, fn, args, copy !== undefined, copy); })
            .catch(function () {
              if (copy === undefined && fail) fail(new Error('Network problem - check your internet and try again.'));
            });
        };
      }
    });
  }
  window.google = { script: { run: runner(null, null) } };

  /* Fetch the main pages ahead, in one trip, so opening them is instant. */
  function prefetch() {
    var calls = [
      { fn: 'getHome', args: [] }, { fn: 'listTasks', args: [] }, { fn: 'getChat', args: [40] },
      { fn: 'getNotifications', args: [] }, { fn: 'listMail', args: [{ account: '', category: '', unread: false }] },
      { fn: 'listNotes', args: [{ tag: '' }] }
    ];
    post({ action: 'batch', token: token(), calls: calls }).then(function (r) {
      if (!r || !r.ok || !Array.isArray(r.results)) return;
      r.results.forEach(function (x, i) {
        if (!x || !x.ok) return;
        var c = calls[i], old = mem[keyOf(c.fn, c.args)];
        if (remember(c.fn, c.args, x.result) !== old && old !== undefined) redraw(c.fn);
      });
    }).catch(function () {});
  }
  window.addEventListener('load', function () { setTimeout(prefetch, 1500); });

  window.jarvisSignOut = function () {
    var t = token();
    clearToken();
    post({ action: 'logout', token: t }).catch(function () {}).then(function () { location.replace('./?out=1'); });
  };

  document.addEventListener('DOMContentLoaded', function () {
    var nav = document.getElementById('nav');
    if (!nav) return;
    var b = document.createElement('button');
    b.innerHTML = '<i>🚪</i><em>Sign out</em>';
    b.addEventListener('click', window.jarvisSignOut);
    nav.appendChild(b);
  });
})();
