/* Jarvis website bridge: the dashboard page talks to your Jarvis API with your session key.
   No data is stored here; the session key lives only in this browser tab (sessionStorage). */
(function () {
  var API_URL = 'https://script.google.com/macros/s/AKfycbx7FeaoVlZbw-2nv_ouBJdag0gqMo2LtIA8lRCBBLMD2Xe4L_j1XgDWMdDppEYFoZR8/exec';
  var KEY = 'jarvis_session';

  function token() { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } }
  function clearToken() { try { sessionStorage.removeItem(KEY); } catch (e) {} }
  if (!token()) { location.replace('./'); return; }

  function post(body) {
    return fetch(API_URL, { method: 'POST', body: JSON.stringify(body), redirect: 'follow', cache: 'no-store' })
      .then(function (r) { return r.json(); });
  }

  /* Same shape as Google's google.script.run, so the dashboard code works unchanged. */
  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (t, name) {
        if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
        if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
        if (name === 'withUserObject') return function () { return runner(ok, fail); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          post({ action: 'call', token: token(), fn: String(name), args: args }).then(function (r) {
            if (r && r.ok) { if (ok) ok(r.result); return; }
            if (r && r.signedOut) { clearToken(); location.replace('./?expired=1'); return; }
            if (fail) fail(new Error((r && r.error) || 'Something went wrong.'));
          }).catch(function (e) {
            if (fail) fail(new Error('Network problem - check your internet and try again.'));
          });
        };
      }
    });
  }
  window.google = { script: { run: runner(null, null) } };

  window.jarvisSignOut = function () {
    var t = token();
    clearToken();
    post({ action: 'logout', token: t }).catch(function () {}).then(function () { location.replace('./?out=1'); });
  };

  document.addEventListener('DOMContentLoaded', function () {
    var nav = document.getElementById('nav');
    if (!nav) return;
    var b = document.createElement('button');
    b.textContent = 'Sign out';
    b.addEventListener('click', window.jarvisSignOut);
    nav.appendChild(b);
  });
})();
