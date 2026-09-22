const crypto = require("crypto");

const OAUTH_URL = "https://www.pinterest.com/oauth/";
const SCOPES = "boards:read,pins:read,pins:write";
const BOARD_NAME = process.env.PINTEREST_DEMO_BOARD_NAME || "楽天お取り寄せスイーツランキング";
const DEMO_LINK = process.env.PINTEREST_DEMO_LINK || "https://guitarlove811-ship-it.github.io/rakuten-product-finder/";
const API_BASE = process.env.PINTEREST_API_ENV === "sandbox"
  ? "https://api-sandbox.pinterest.com/v5"
  : "https://api.pinterest.com/v5";

const states = new Map();
const sessions = new Map();

function esc(v) {
  return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionId(req, res) {
  let id = cookies(req).pinterest_demo_session;
  if (!id || !/^[a-f0-9]{48}$/.test(id)) {
    id = crypto.randomBytes(24).toString("hex");
    res.setHeader("Set-Cookie", `pinterest_demo_session=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`);
  }
  return id;
}

function cleanup() {
  const cutoff = Date.now() - 3600000;
  for (const [k, v] of states) if (v.at < cutoff) states.delete(k);
  for (const [k, v] of sessions) if (v.at < cutoff) sessions.delete(k);
}

function config() {
  return {
    appId: process.env.PINTEREST_APP_ID || "",
    secret: process.env.PINTEREST_APP_SECRET || "",
    redirectUri: process.env.PINTEREST_REDIRECT_URI || "",
  };
}

function html(body, title = "Pinterest API Standard Access Demo") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:#f7f7f7;color:#202124}main{max-width:820px;margin:40px auto;padding:0 20px 48px}.card{background:#fff;border:1px solid #ddd;border-radius:14px;padding:24px;margin:16px 0}h1{font-size:28px}.row{padding:8px 0;border-bottom:1px solid #eee}.ok{color:#137333;font-weight:700}.bad{color:#b3261e;font-weight:700}.muted{color:#666}.button,button{display:inline-block;background:#111;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-weight:700;text-decoration:none;cursor:pointer}code{background:#f1f3f4;padding:2px 6px;border-radius:5px}li,p{line-height:1.55}
  </style></head><body><main><h1>Pinterest API Standard Access Demo</h1><p class="muted">Sweets Ranking Pin Tool · App ID ${esc(process.env.PINTEREST_APP_ID || "not configured")}</p>${body}</main></body></html>`;
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

function go(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

async function api(path, token, options = {}) {
  const r = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`Pinterest API HTTP ${r.status}: ${text}`);
  return { status: r.status, data };
}

async function exchange(code) {
  const c = config();
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: c.redirectUri });
  const auth = Buffer.from(`${c.appId}:${c.secret}`).toString("base64");
  const r = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok || !data.access_token) throw new Error(`Pinterest OAuth token exchange failed (${r.status}): ${text}`);
  return { status: r.status, data };
}

function home(session) {
  const c = config();
  const ready = c.appId && c.secret && c.redirectUri;
  const auth = session?.token
    ? `<p class="ok">OAuth complete. Access token received and stored server-side.</p><p>Boards returned: <strong>${esc(session.boards?.length || 0)}</strong></p><form method="post" action="/pinterest-demo/create-pin"><button>Create demo Pin via Pinterest API</button></form>`
    : `<a class="button" href="/auth/pinterest">Connect Pinterest</a>`;
  return html(`<section class="card"><h2>1. Configuration</h2>${ready ? '<p class="ok">Configuration ready</p>' : '<p class="bad">Set PINTEREST_APP_ID, PINTEREST_APP_SECRET and PINTEREST_REDIRECT_URI on Render.</p>'}<div class="row">Scopes: <code>${esc(SCOPES)}</code></div><div class="row">API: <code>${esc(API_BASE)}</code></div></section><section class="card"><h2>2. OAuth + API integration</h2>${auth}</section>`);
}

async function handlePinterestDemo(req, res, { getProducts }) {
  cleanup();
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  if (path === "/pinterest-demo" && req.method === "GET") {
    const id = sessionId(req, res);
    send(res, 200, home(sessions.get(id)));
    return true;
  }

  if (path === "/auth/pinterest" && req.method === "GET") {
    const c = config();
    if (!c.appId || !c.secret || !c.redirectUri) {
      send(res, 500, html('<section class="card"><h2>Configuration missing</h2><p class="bad">Pinterest environment variables are not configured.</p></section>'));
      return true;
    }
    const id = sessionId(req, res);
    const state = crypto.randomBytes(24).toString("hex");
    states.set(state, { id, at: Date.now() });
    const q = new URLSearchParams({ client_id: c.appId, redirect_uri: c.redirectUri, response_type: "code", scope: SCOPES, state });
    go(res, `${OAUTH_URL}?${q.toString()}`);
    return true;
  }

  if (path === "/auth/pinterest/callback" && req.method === "GET") {
    const id = sessionId(req, res);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expected = state ? states.get(state) : null;
    if (!code || !state || !expected || expected.id !== id) {
      send(res, 400, html('<section class="card"><h2>OAuth validation failed</h2><p class="bad">Missing or invalid authorization code/state.</p></section>'));
      return true;
    }
    states.delete(state);
    try {
      const token = await exchange(code);
      const boardsResult = await api("/boards?page_size=100", token.data.access_token);
      const boards = Array.isArray(boardsResult.data.items) ? boardsResult.data.items : [];
      sessions.set(id, { token: token.data.access_token, boards, at: Date.now() });
      const list = boards.slice(0, 10).map(b => `<li>${esc(b.name || "Unnamed board")} <span class="muted">(${esc(b.id || "")})</span></li>`).join("") || "<li>No boards returned.</li>";
      send(res, 200, html(`<section class="card"><h2>OAuth flow complete</h2><div class="row"><span class="ok">✓</span> Authorization code received</div><div class="row"><span class="ok">✓</span> OAuth state verified</div><div class="row"><span class="ok">✓</span> <code>POST /v5/oauth/token</code> → HTTP ${esc(token.status)}</div><div class="row"><span class="ok">✓</span> Access token received (hidden)</div></section><section class="card"><h2>Live Pinterest API integration</h2><div class="row"><span class="ok">✓</span> <code>GET /v5/boards</code> → HTTP ${esc(boardsResult.status)}</div><ul>${list}</ul><form method="post" action="/pinterest-demo/create-pin"><button>Create demo Pin via POST /v5/pins</button></form></section>`, "Pinterest OAuth complete"));
    } catch (e) {
      send(res, 500, html(`<section class="card"><h2>OAuth/API error</h2><p class="bad">${esc(e.message)}</p></section>`));
    }
    return true;
  }

  if (path === "/pinterest-demo/create-pin" && req.method === "POST") {
    const id = sessionId(req, res);
    const session = sessions.get(id);
    if (!session?.token) {
      send(res, 401, html('<section class="card"><h2>OAuth required</h2><a class="button" href="/pinterest-demo">Start demo</a></section>'));
      return true;
    }
    try {
      const board = session.boards.find(b => b.name === BOARD_NAME) || session.boards[0];
      if (!board?.id) throw new Error("No Pinterest board is available for the demo Pin.");
      const ranking = await getProducts();
      const product = ranking.products.find(p => p.image) || ranking.products[0];
      if (!product?.image) throw new Error("No Rakuten product image is available for the demo Pin.");
      const payload = {
        board_id: String(board.id),
        title: `楽天スイーツ API Demo | ${String(product.name).slice(0, 70)}`,
        description: "Created through the Pinterest API as a live integration demonstration for Standard Access review.",
        link: DEMO_LINK,
        media_source: { source_type: "image_url", url: product.image, is_standard: true },
      };
      const pin = await api("/pins", session.token, { method: "POST", body: JSON.stringify(payload) });
      session.at = Date.now();
      const pinId = pin.data.id || "";
      const pinUrl = pinId ? `https://www.pinterest.com/pin/${encodeURIComponent(pinId)}/` : "https://www.pinterest.com/";
      send(res, 201, html(`<section class="card"><h2>Live API action completed</h2><div class="row"><span class="ok">✓</span> <code>POST /v5/pins</code> → HTTP ${esc(pin.status)}</div><div class="row">Board: <strong>${esc(board.name || board.id)}</strong></div><div class="row">Created Pin ID: <code>${esc(pinId)}</code></div><p class="ok">The Pin was created through the Pinterest API.</p><a class="button" href="${esc(pinUrl)}" target="_blank" rel="noopener noreferrer">Open the resulting Pin on Pinterest</a></section>`, "Pinterest Pin created"));
    } catch (e) {
      send(res, 500, html(`<section class="card"><h2>Pin creation failed</h2><p class="bad">${esc(e.message)}</p></section>`));
    }
    return true;
  }

  return false;
}

module.exports = { handlePinterestDemo };
