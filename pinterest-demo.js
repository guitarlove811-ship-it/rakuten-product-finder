const crypto = require("crypto");

const OAUTH_URL = "https://www.pinterest.com/oauth/";

const SCOPES =
  "boards:read,boards:write,pins:read,pins:write";

const BOARD_NAME =
  process.env.PINTEREST_DEMO_BOARD_NAME ||
  "Pinterest API Sandbox Demo";

const DEMO_LINK =
  process.env.PINTEREST_DEMO_LINK ||
  "https://guitarlove811-ship-it.github.io/rakuten-product-finder/";

const API_BASE =
  process.env.PINTEREST_API_ENV === "sandbox"
    ? "https://api-sandbox.pinterest.com/v5"
    : "https://api.pinterest.com/v5";

const states = new Map();
const sessions = new Map();

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getCookies(req) {
  const out = {};

  for (
    const part of
    (req.headers.cookie || "").split(";")
  ) {
    const i =
      part.indexOf("=");

    if (i > 0) {
      out[
        part
          .slice(0, i)
          .trim()
      ] =
        decodeURIComponent(
          part
            .slice(i + 1)
            .trim()
        );
    }
  }

  return out;
}

function getSessionId(
  req,
  res
) {
  let id =
    getCookies(req)
      .pinterest_demo_session;

  if (
    !id ||
    !/^[a-f0-9]{48}$/.test(id)
  ) {
    id =
      crypto
        .randomBytes(24)
        .toString("hex");

    res.setHeader(
      "Set-Cookie",
      `pinterest_demo_session=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`
    );
  }

  return id;
}

function cleanup() {
  const cutoff =
    Date.now() -
    60 * 60 * 1000;

  for (
    const [key, value]
    of states
  ) {
    if (
      value.at < cutoff
    ) {
      states.delete(key);
    }
  }

  for (
    const [key, value]
    of sessions
  ) {
    if (
      value.at < cutoff
    ) {
      sessions.delete(key);
    }
  }
}

function config() {
  return {
    appId:
      process.env
        .PINTEREST_APP_ID ||
      "",

    secret:
      process.env
        .PINTEREST_APP_SECRET ||
      "",

    redirectUri:
      process.env
        .PINTEREST_REDIRECT_URI ||
      "",
  };
}

function page(
  body,
  title =
    "Pinterest API Standard Access Demo"
) {
  return `
<!doctype html>

<html lang="en">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1"
>

<title>
  ${esc(title)}
</title>

<style>

body {
  font-family:
    system-ui,
    -apple-system,
    "Segoe UI",
    sans-serif;

  margin: 0;

  background:
    #f7f7f7;

  color:
    #202124;
}

main {
  max-width:
    820px;

  margin:
    40px auto;

  padding:
    0 20px 48px;
}

.card {
  background:
    #fff;

  border:
    1px solid #ddd;

  border-radius:
    14px;

  padding:
    24px;

  margin:
    16px 0;
}

h1 {
  font-size:
    28px;
}

.row {
  padding:
    8px 0;

  border-bottom:
    1px solid #eee;
}

.ok {
  color:
    #137333;

  font-weight:
    700;
}

.bad {
  color:
    #b3261e;

  font-weight:
    700;
}

.muted {
  color:
    #666;
}

.button,
button {
  display:
    inline-block;

  background:
    #111;

  color:
    #fff;

  border:
    0;

  border-radius:
    10px;

  padding:
    12px 18px;

  font-weight:
    700;

  text-decoration:
    none;

  cursor:
    pointer;
}

code {
  background:
    #f1f3f4;

  padding:
    2px 6px;

  border-radius:
    5px;
}

li,
p {
  line-height:
    1.55;
}

</style>

</head>

<body>

<main>

<h1>
  Pinterest API Standard Access Demo
</h1>

<p class="muted">

  Sweets Ranking Pin Tool · App ID

  ${
    esc(
      process.env
        .PINTEREST_APP_ID ||
      "not configured"
    )
  }

</p>

${body}

</main>

</body>

</html>
`;
}

function sendHtml(
  res,
  status,
  body
) {
  res.writeHead(
    status,
    {
      "Content-Type":
        "text/html; charset=utf-8",

      "Cache-Control":
        "no-store",

      "X-Content-Type-Options":
        "nosniff",
    }
  );

  res.end(body);
}

function redirect(
  res,
  location
) {
  res.writeHead(
    302,
    {
      Location:
        location,

      "Cache-Control":
        "no-store",
    }
  );

  res.end();
}

async function pinterestApi(
  path,
  token,
  options = {}
) {
  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        ...options,

        headers: {
          Authorization:
            `Bearer ${token}`,

          ...(
            options.body
              ? {
                  "Content-Type":
                    "application/json",
                }
              : {}
          ),

          ...(
            options.headers ||
            {}
          ),
        },
      }
    );

  const text =
    await response.text();

  let data = {};

  try {
    data =
      text
        ? JSON.parse(text)
        : {};
  } catch {
    data = {
      raw:
        text,
    };
  }

  if (
    !response.ok
  ) {
    throw new Error(
      `Pinterest API HTTP ${response.status}: ${text}`
    );
  }

  return {
    status:
      response.status,

    data,
  };
}

async function exchangeCode(
  code
) {
  const c =
    config();

  const body =
    new URLSearchParams({
      grant_type:
        "authorization_code",

      code,

      redirect_uri:
        c.redirectUri,
    });

  const basic =
    Buffer
      .from(
        `${c.appId}:${c.secret}`
      )
      .toString(
        "base64"
      );

  const response =
    await fetch(
      `${API_BASE}/oauth/token`,
      {
        method:
          "POST",

        headers: {
          Authorization:
            `Basic ${basic}`,

          "Content-Type":
            "application/x-www-form-urlencoded",
        },

        body:
          body.toString(),
      }
    );

  const text =
    await response.text();

  let data = {};

  try {
    data =
      text
        ? JSON.parse(text)
        : {};
  } catch {
    data = {
      raw:
        text,
    };
  }

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw new Error(
      `Pinterest OAuth token exchange failed (${response.status}): ${text}`
    );
  }

  return {
    status:
      response.status,

    data,
  };
}

async function listSandboxBoards(
  token
) {
  const boards = [];

  let bookmark =
    null;

  let pages =
    0;

  do {
    const params =
      new URLSearchParams({
        page_size:
          "250",
      });

    if (
      bookmark
    ) {
      params.set(
        "bookmark",
        bookmark
      );
    }

    const result =
      await pinterestApi(
        `/boards?${params.toString()}`,
        token
      );

    pages += 1;

    if (
      Array.isArray(
        result.data.items
      )
    ) {
      boards.push(
        ...result.data.items
      );
    }

    bookmark =
      result.data.bookmark ||
      null;

  } while (
    bookmark &&
    pages < 20
  );

  return {
    boards,
    pages,
  };
}

async function ensureBoard(
  token
) {
  const listed =
    await listSandboxBoards(
      token
    );

  const existing =
    listed.boards.find(
      board =>
        board.name ===
        BOARD_NAME
    ) ||
    listed.boards[0];

  if (
    existing?.id
  ) {
    return {
      board:
        existing,

      created:
        false,

      listPages:
        listed.pages,

      listCount:
        listed.boards.length,

      createStatus:
        null,
    };
  }

  const created =
    await pinterestApi(
      "/boards",
      token,
      {
        method:
          "POST",

        body:
          JSON.stringify({
            name:
              BOARD_NAME,

            description:
              "Sandbox board created through the Pinterest API for Standard Access review.",

            privacy:
              "PUBLIC",
          }),
      }
    );

  if (
    !created.data?.id
  ) {
    throw new Error(
      "Board creation returned no board ID."
    );
  }

  return {
    board:
      created.data,

    created:
      true,

    listPages:
      listed.pages,

    listCount:
      listed.boards.length,

    createStatus:
      created.status,
  };
}

function home(
  session
) {
  const c =
    config();

  const ready =
    c.appId &&
    c.secret &&
    c.redirectUri;

  const authSection =
    session?.token

      ? `
        <p class="ok">
          OAuth complete.
          Access token received
          and stored server-side.
        </p>

        <p>
          Demo board ready:

          <strong>
            ${
              esc(
                session.board?.name ||
                session.board?.id ||
                "Yes"
              )
            }
          </strong>

        </p>

        <form
          method="post"
          action="/pinterest-demo/create-pin"
        >

          <button>
            Create demo Pin via Pinterest API
          </button>

        </form>
      `

      : `
        <a
          class="button"
          href="/auth/pinterest"
        >
          Connect Pinterest
        </a>
      `;

  return page(
    `
    <section class="card">

      <h2>
        1. Configuration
      </h2>

      ${
        ready

          ? `
            <p class="ok">
              Configuration ready
            </p>
          `

          : `
            <p class="bad">
              Pinterest environment variables are missing.
            </p>
          `
      }

      <div class="row">

        Scopes:

        <code>
          ${esc(SCOPES)}
        </code>

      </div>

      <div class="row">

        API:

        <code>
          ${esc(API_BASE)}
        </code>

      </div>

    </section>


    <section class="card">

      <h2>
        2. OAuth + API integration
      </h2>

      ${authSection}

    </section>
    `
  );
}

async function handlePinterestDemo(
  req,
  res,
  {
    getProducts,
  }
) {
  cleanup();

  const url =
    new URL(
      req.url,
      `https://${req.headers.host || "localhost"}`
    );

  const path =
    url.pathname;


  if (
    path ===
      "/pinterest-demo" &&
    req.method ===
      "GET"
  ) {
    const id =
      getSessionId(
        req,
        res
      );

    sendHtml(
      res,
      200,
      home(
        sessions.get(id)
      )
    );

    return true;
  }


  if (
    path ===
      "/auth/pinterest" &&
    req.method ===
      "GET"
  ) {
    const c =
      config();

    if (
      !c.appId ||
      !c.secret ||
      !c.redirectUri
    ) {
      sendHtml(
        res,
        500,
        page(
          `
          <section class="card">

            <h2>
              Configuration missing
            </h2>

            <p class="bad">
              Pinterest environment variables
              are not configured.
            </p>

          </section>
          `
        )
      );

      return true;
    }

    const id =
      getSessionId(
        req,
        res
      );

    const state =
      crypto
        .randomBytes(24)
        .toString("hex");

    states.set(
      state,
      {
        id,
        at:
          Date.now(),
      }
    );

    const params =
      new URLSearchParams({
        client_id:
          c.appId,

        redirect_uri:
          c.redirectUri,

        response_type:
          "code",

        scope:
          SCOPES,

        state,
      });

    redirect(
      res,
      `${OAUTH_URL}?${params.toString()}`
    );

    return true;
  }


  if (
    path ===
      "/auth/pinterest/callback" &&
    req.method ===
      "GET"
  ) {
    const id =
      getSessionId(
        req,
        res
      );

    const code =
      url.searchParams.get(
        "code"
      );

    const state =
      url.searchParams.get(
        "state"
      );

    const expected =
      state
        ? states.get(state)
        : null;

    if (
      !code ||
      !state ||
      !expected ||
      expected.id !== id
    ) {
      sendHtml(
        res,
        400,
        page(
          `
          <section class="card">

            <h2>
              OAuth validation failed
            </h2>

            <p class="bad">
              Missing or invalid
              authorization code/state.
            </p>

          </section>
          `
        )
      );

      return true;
    }

    states.delete(
      state
    );

    try {
      const tokenResult =
        await exchangeCode(
          code
        );

      const boardResult =
        await ensureBoard(
          tokenResult
            .data
            .access_token
        );

      sessions.set(
        id,
        {
          token:
            tokenResult
              .data
              .access_token,

          board:
            boardResult.board,

          at:
            Date.now(),
        }
      );

      const boardStep =
        boardResult.created

          ? `
            <div class="row">

              <span class="ok">
                ✓
              </span>

              <code>
                POST /v5/boards
              </code>

              → HTTP
              ${
                esc(
                  boardResult
                    .createStatus
                )
              }

            </div>

            <div class="row">

              Sandbox demo board created:

              <strong>
                ${
                  esc(
                    boardResult
                      .board
                      .name ||
                    boardResult
                      .board
                      .id
                  )
                }
              </strong>

            </div>
          `

          : `
            <div class="row">

              <span class="ok">
                ✓
              </span>

              Sandbox board found after
              ${
                esc(
                  boardResult
                    .listPages
                )
              }
              page(s)

            </div>

            <div class="row">

              Board:

              <strong>
                ${
                  esc(
                    boardResult
                      .board
                      .name ||
                    boardResult
                      .board
                      .id
                  )
                }
              </strong>

            </div>
          `;

      sendHtml(
        res,
        200,
        page(
          `
          <section class="card">

            <h2>
              OAuth flow complete
            </h2>

            <div class="row">

              <span class="ok">
                ✓
              </span>

              Authorization code received

            </div>

            <div class="row">

              <span class="ok">
                ✓
              </span>

              OAuth state verified

            </div>

            <div class="row">

              <span class="ok">
                ✓
              </span>

              <code>
                POST /v5/oauth/token
              </code>

              → HTTP
              ${
                esc(
                  tokenResult.status
                )
              }

            </div>

            <div class="row">

              <span class="ok">
                ✓
              </span>

              Access token received
              (hidden)

            </div>

          </section>


          <section class="card">

            <h2>
              Live Pinterest API integration
            </h2>

            <div class="row">

              <span class="ok">
                ✓
              </span>

              <code>
                GET /v5/boards
              </code>

              → searched
              ${
                esc(
                  boardResult
                    .listPages
                )
              }
              page(s)

            </div>

            ${boardStep}

            <form
              method="post"
              action="/pinterest-demo/create-pin"
            >

              <button>
                Create demo Pin via POST /v5/pins
              </button>

            </form>

          </section>
          `,
          "Pinterest OAuth complete"
        )
      );
    } catch (
      error
    ) {
      sendHtml(
        res,
        500,
        page(
          `
          <section class="card">

            <h2>
              OAuth/API error
            </h2>

            <p class="bad">
              ${
                esc(
                  error.message
                )
              }
            </p>

          </section>
          `
        )
      );
    }

    return true;
  }


  if (
    path ===
      "/pinterest-demo/create-pin" &&
    req.method ===
      "POST"
  ) {
    const id =
      getSessionId(
        req,
        res
      );

    const session =
      sessions.get(id);

    if (
      !session?.token
    ) {
      sendHtml(
        res,
        401,
        page(
          `
          <section class="card">

            <h2>
              OAuth required
            </h2>

            <a
              class="button"
              href="/pinterest-demo"
            >
              Start demo
            </a>

          </section>
          `
        )
      );

      return true;
    }

    try {
      let board =
        session.board;

      if (
        !board?.id
      ) {
        const boardResult =
          await ensureBoard(
            session.token
          );

        board =
          boardResult.board;

        session.board =
          board;
      }

      const ranking =
        await getProducts();

      const product =
        ranking
          .products
          .find(
            product =>
              product.image
          ) ||
        ranking
          .products[0];

      if (
        !product?.image
      ) {
        throw new Error(
          "No Rakuten product image is available for the demo Pin."
        );
      }

      const payload = {
        board_id:
          String(
            board.id
          ),

        title:
          `楽天スイーツ API Demo | ${
            String(
              product.name
            ).slice(
              0,
              70
            )
          }`,

        description:
          "Created through the Pinterest API as a live integration demonstration for Standard Access review.",

        link:
          DEMO_LINK,

        media_source: {
          source_type:
            "image_url",

          url:
            product.image,

          is_standard:
            true,
        },
      };

      const pinResult =
        await pinterestApi(
          "/pins",
          session.token,
          {
            method:
              "POST",

            body:
              JSON.stringify(
                payload
              ),
          }
        );

      session.at =
        Date.now();

      const pinId =
        pinResult
          .data
          .id ||
        "";

      const pinUrl =
        pinId

          ? `https://www.pinterest.com/pin/${encodeURIComponent(pinId)}/`

          : "https://www.pinterest.com/";

      sendHtml(
        res,
        201,
        page(
          `
          <section class="card">

            <h2>
              Live API action completed
            </h2>

            <div class="row">

              <span class="ok">
                ✓
              </span>

              <code>
                POST /v5/pins
              </code>

              → HTTP
              ${
                esc(
                  pinResult.status
                )
              }

            </div>

            <div class="row">

              Board:

              <strong>
                ${
                  esc(
                    board.name ||
                    board.id
                  )
                }
              </strong>

            </div>

            <div class="row">

              Created Pin ID:

              <code>
                ${esc(pinId)}
              </code>

            </div>

            <p class="ok">

              The Pin was created
              through the Pinterest API.

            </p>

            <a
              class="button"
              href="${esc(pinUrl)}"
              target="_blank"
              rel="noopener noreferrer"
            >

              Open the resulting Pin on Pinterest

            </a>

          </section>
          `,
          "Pinterest Pin created"
        )
      );

    } catch (
      error
    ) {
      sendHtml(
        res,
        500,
        page(
          `
          <section class="card">

            <h2>
              Pin creation failed
            </h2>

            <p class="bad">
              ${
                esc(
                  error.message
                )
              }
            </p>

          </section>
          `
        )
      );
    }

    return true;
  }

  return false;
}

module.exports = {
  handlePinterestDemo,
};
