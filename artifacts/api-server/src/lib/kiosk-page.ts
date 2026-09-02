/**
 * Entrance kiosk page.
 *
 * A self-contained HTML document with no external requests: the QR is fetched
 * as JSON from our own API and drawn client-side into an SVG that this module
 * builds server-side on each poll. Everything is inline so the page works on a
 * display with no internet access beyond the local network.
 *
 * This is a test fixture and a genuinely useful entrance display; it is not the
 * admin dashboard.
 */

type KioskOptions = {
  workplaceId: string;
  workplaceName: string;
  rotationSeconds: number;
  isStatic: boolean;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderKioskPage(options: KioskOptions): string {
  const { workplaceId, workplaceName, rotationSeconds, isStatic } = options;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(workplaceName)} — Attendance QR</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f4f8f7;
    --fg: #12202a;
    --muted: #6b7c78;
    --card: #ffffff;
    --primary: #0f8f6b;
    --border: #d7e5e0;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d1512; --fg:#e8f0ee; --muted:#8fa39d; --card:#152420; --border:#22352f; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--fg);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    display: grid; place-items: center; padding: 24px;
  }
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 24px;
    padding: 32px; max-width: 460px; width: 100%; text-align: center;
    box-shadow: 0 12px 40px rgba(0,0,0,.06);
  }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: -.3px; }
  .sub { margin: 0 0 24px; color: var(--muted); font-size: 14px; }
  .qr { background:#fff; border-radius:16px; padding:16px; display:inline-block; min-height:352px; }
  .qr svg { display: block; width: 320px; height: 320px; }
  .timer {
    margin-top: 20px; font-size: 15px; color: var(--muted);
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .bar { height: 4px; background: var(--border); border-radius: 99px; overflow: hidden; margin-top: 12px; }
  .bar > i { display:block; height:100%; background: var(--primary); transition: width .95s linear; }
  .pill {
    display:inline-block; margin-top:18px; padding:6px 12px; border-radius:99px;
    background: var(--primary); color:#fff; font-size:12px; font-weight:600; letter-spacing:.4px;
  }
  .error { color:#d45151; font-size:14px; margin-top:16px; min-height:20px; }
</style>
</head>
<body>
  <main class="card">
    <h1>${escapeHtml(workplaceName)}</h1>
    <p class="sub">Scan this code with the Attendance app to check in</p>
    <div class="qr" id="qr" aria-live="polite" aria-label="Workplace check-in QR code"></div>
    ${
      isStatic
        ? `<div class="pill">STATIC CODE</div>`
        : `<div class="timer"><span id="countdown">—</span></div>
           <div class="bar"><i id="bar" style="width:100%"></i></div>`
    }
    <p class="error" id="error"></p>
  </main>
<script>
(function () {
  var WORKPLACE_ID = ${JSON.stringify(workplaceId)};
  var ROTATION = ${rotationSeconds};
  var IS_STATIC = ${isStatic ? "true" : "false"};
  var qrEl = document.getElementById('qr');
  var errEl = document.getElementById('error');
  var countdownEl = document.getElementById('countdown');
  var barEl = document.getElementById('bar');
  var remaining = ROTATION;

  function fetchToken() {
    fetch('/api/workplaces/' + WORKPLACE_ID + '/qr-token', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        // The server renders the SVG so the page needs no QR library.
        return fetch('/api/workplaces/' + WORKPLACE_ID + '/qr.svg?t=' + encodeURIComponent(data.token))
          .then(function (r) { return r.text(); })
          .then(function (svg) {
            qrEl.innerHTML = svg;
            errEl.textContent = '';
            remaining = data.expiresInSeconds || ROTATION;
          });
      })
      .catch(function (e) {
        errEl.textContent = 'Cannot reach the attendance server. Retrying…';
      });
  }

  function tick() {
    if (IS_STATIC) return;
    remaining -= 1;
    if (remaining <= 0) {
      fetchToken();
      remaining = ROTATION;
    }
    if (countdownEl) {
      countdownEl.textContent = 'New code in ' + remaining + 's';
    }
    if (barEl) {
      barEl.style.width = Math.max(0, (remaining / ROTATION) * 100) + '%';
    }
  }

  fetchToken();
  if (!IS_STATIC) setInterval(tick, 1000);
  // Refresh on wake — a kiosk display that slept would otherwise show a stale code.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) fetchToken();
  });
})();
</script>
</body>
</html>`;
}
