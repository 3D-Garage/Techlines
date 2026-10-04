import { createServer } from "node:http";

const page = `<!doctype html><html lang="hu"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PayPal Sandbox teszt</title><style>body{font:18px system-ui;max-width:650px;margin:80px auto;padding:24px}h1{font-size:28px}.success{color:#16703c}.error{color:#b32323}</style>
<h1>PayPal Sandbox teszt</h1><p id="status" role="status">A tesztfizetés ellenőrzése folyamatban…</p>
<p>Ez egy elkülönített tesztvásárlás. Az alkalmazás adatbázisát nem használja.</p>
<script>
async function check() {
  const text = document.getElementById('status');
  try {
    const response = await fetch('status', {cache:'no-store'});
    if (!response.ok) throw new Error('unavailable');
    const result = await response.json();
    if (result.status === 'COMPLETED') {
      text.textContent = 'Sikeres Sandbox tesztfizetés: 2 490 HUF. A levonás és a tesztrendelés ellenőrizve.';
      text.className = 'success';
      await fetch('receipt', {method:'POST'}).catch(() => {});
      return;
    }
    if (['FAILED', 'EXPIRED', 'REVIEW'].includes(result.status)) {
      text.textContent = 'A tesztfizetés nem fejeződött be igazolt sikerrel. Állapot: ' + result.status;
      text.className = 'error';
      return;
    }
  } catch (_) { text.textContent = 'Az ellenőrzés átmenetileg nem érhető el. Újrapróbálás…'; }
  setTimeout(check, 1500);
}
check();
</script></html>`;

// Receipt server belongs to the explicit, temporary Sandbox test, never production.
export async function startSandboxReceiptServer({ readStatus, onReceipt }) {
  let verified = false;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const path = new URL(req.url, "http://127.0.0.1").pathname;
      if (req.method === "GET" && path === "/sandbox/return") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.end(page);
      }
      if (req.method === "GET" && path === "/sandbox/cancel") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.end('<!doctype html><html lang="hu"><meta charset="utf-8"><title>Sandbox teszt</title><h1>A PayPal jóváhagyás megszakítva.</h1><p>A tesztprogram külön ellenőrzi a szolgáltatói állapotot.</p></html>');
      }
      if (req.method === "GET" && path === "/sandbox/status") {
        const status = await readStatus();
        verified = status === "COMPLETED";
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ status }));
      }
      if (req.method === "POST" && path === "/sandbox/receipt" && verified) {
        onReceipt();
        res.statusCode = 204;
        return res.end();
      }
      res.statusCode = 404;
      res.end();
    } catch (_error) { res.statusCode = 503; res.end(); }
  });
  server.listen(0, "127.0.0.1");
  await new Promise((done, reject) => { server.once("listening", done); server.once("error", reject); });
  const base = `http://127.0.0.1:${server.address().port}/sandbox`;
  return {
    returnUrl: `${base}/return`, cancelUrl: `${base}/cancel`,
    async close() { server.closeAllConnections(); await new Promise((done) => server.close(done)); },
  };
}
