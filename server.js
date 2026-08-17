const http = require("http");

const PORT = process.env.PORT || 10000;

const ALLOWED_ORIGIN =
  "https://guitarlove811-ship-it.github.io";

const RAKUTEN_ENDPOINT =
  "https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601";

const SWEETS_GENRE_ID = "551167";
const CACHE_MS = 15 * 60 * 1000;

let cacheData = null;
let cacheUntil = 0;

function sendJson(res, status, data, origin = "") {
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      ALLOWED_ORIGIN
    );
  }

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function imageUrl(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value;
  }

  return value.imageUrl || value.url || "";
}

async function getProducts() {
  if (
    cacheData &&
    Date.now() < cacheUntil
  ) {
    return cacheData;
  }

  const appId =
    process.env.RAKUTEN_APP_ID;

  const accessKey =
    process.env.RAKUTEN_ACCESS_KEY;

  const affiliateId =
    process.env.RAKUTEN_AFFILIATE_ID;

  if (
    !appId ||
    !accessKey ||
    !affiliateId
  ) {
    throw new Error(
      "Rakuten API credentials are missing."
    );
  }

  const params =
    new URLSearchParams({
      applicationId: appId,
      affiliateId: affiliateId,
      format: "json",
      formatVersion: "2",
      genreId: SWEETS_GENRE_ID,
      period: "realtime",
      page: "1",
    });

  const response =
    await fetch(
      `${RAKUTEN_ENDPOINT}?${params.toString()}`,
      {
        headers: {
          accessKey: accessKey,
        },
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Rakuten API HTTP ${response.status}: ${text}`
    );
  }

  const raw =
    JSON.parse(text);

  if (raw.error) {
    throw new Error(
      raw.error_description ||
      raw.error
    );
  }

  const items =
    Array.isArray(raw.Items)
      ? raw.Items
      : [];

  const products =
    items
      .filter(
        item =>
          item &&
          item.itemName &&
          (
            item.affiliateUrl ||
            item.itemUrl
          )
      )

      // ★ここでランキング順に並べ直す
      .sort(
        (a, b) =>
          Number(a.rank || 999) -
          Number(b.rank || 999)
      )

      // ★1位～12位だけ取得
      .slice(0, 12)

      .map(item => {
        const images =
          Array.isArray(
            item.mediumImageUrls
          )
            ? item.mediumImageUrls
            : [];

        return {
          rank:
            Number(item.rank || 0),

          name:
            item.itemName || "",

          catchcopy:
            item.catchcopy || "",

          price:
            Number(
              item.itemPrice || 0
            ),

          url:
            item.affiliateUrl ||
            item.itemUrl ||
            "",

          image:
            images.length
              ? imageUrl(images[0])
              : "",

          reviewCount:
            Number(
              item.reviewCount || 0
            ),

          reviewAverage:
            Number(
              item.reviewAverage || 0
            ),

          affiliateRate:
            Number(
              item.affiliateRate || 0
            ),

          pointRate:
            Number(
              item.pointRate || 1
            ),

          freeShipping:
            Number(
              item.postageFlag
            ) === 0,

          shopName:
            item.shopName || "",
        };
      });

  const result = {
    updatedAt:
      new Date().toISOString(),

    source:
      "Rakuten Ichiba Ranking API",

    category:
      "スイーツ・お菓子",

    genreId:
      SWEETS_GENRE_ID,

    rankingPeriod:
      "realtime",

    rankingTitle:
      raw.title || "",

    rankingUpdatedAt:
      raw.lastBuildDate || "",

    rawItemCount:
      items.length,

    selectedCount:
      products.length,

    products:
      products,
  };

  cacheData = result;
  cacheUntil =
    Date.now() + CACHE_MS;

  return result;
}

const server =
  http.createServer(
    async (req, res) => {
      const origin =
        req.headers.origin || "";

      if (
        req.method === "OPTIONS"
      ) {
        if (
          origin ===
          ALLOWED_ORIGIN
        ) {
          res.setHeader(
            "Access-Control-Allow-Origin",
            ALLOWED_ORIGIN
          );

          res.setHeader(
            "Access-Control-Allow-Methods",
            "GET, OPTIONS"
          );
        }

        res.writeHead(204);
        res.end();
        return;
      }

      if (
        req.url === "/health"
      ) {
        sendJson(
          res,
          200,
          {
            status: "ok",
          },
          origin
        );

        return;
      }

      if (
        req.url ===
          "/api/products" &&
        req.method === "GET"
      ) {
        try {
          const data =
            await getProducts();

          sendJson(
            res,
            200,
            data,
            origin
          );
        } catch (error) {
          console.error(error);

          sendJson(
            res,
            500,
            {
              error:
                "ランキング取得に失敗しました。",

              detail:
                error.message,
            },
            origin
          );
        }

        return;
      }

      sendJson(
        res,
        404,
        {
          error: "Not found",
        },
        origin
      );
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Server running on port ${PORT}`
    );
  }
);
