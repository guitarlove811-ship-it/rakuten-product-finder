const http = require("http");

const PORT = process.env.PORT || 10000;

const ALLOWED_ORIGIN =
  "https://guitarlove811-ship-it.github.io";

const RAKUTEN_RANKING_ENDPOINT =
  "https://openapi.rakuten.co.jp/ichibaranking/api/IchibaItem/Ranking/20220601";

const SWEETS_GENRE_ID = "551167";

const CACHE_MS = 15 * 60 * 1000;

let cache = {
  expiresAt: 0,
  data: null,
};

let pendingRequest = null;

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

function unwrapItem(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  return (
    value.item ||
    value.Item ||
    value
  );
}

function extractItems(raw) {
  const candidates = [
    raw.Items,
    raw.items,
    raw.Item,
    raw.item,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (Array.isArray(candidate)) {
      return candidate
        .map(unwrapItem)
        .filter(Boolean);
    }

    if (typeof candidate === "object") {
      return Object
        .values(candidate)
        .map(unwrapItem)
        .filter(Boolean);
    }
  }

  return [];
}

function getImageUrl(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    return (
      value.imageUrl ||
      value.url ||
      ""
    );
  }

  return "";
}

async function fetchRakutenRanking() {
  if (
    cache.data &&
    Date.now() < cache.expiresAt
  ) {
    return cache.data;
  }

  if (pendingRequest) {
    return pendingRequest;
  }

  pendingRequest = (async () => {
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

    const requestUrl =
      `${RAKUTEN_RANKING_ENDPOINT}?${params.toString()}`;

    console.log(
      "Requesting Rakuten Ranking API..."
    );

    const response =
      await fetch(
        requestUrl,
        {
          method: "GET",

          headers: {
            accessKey:
              accessKey,
          },
        }
      );

    const responseText =
      await response.text();

    console.log(
      "Rakuten Ranking HTTP status:",
      response.status
    );

    if (!response.ok) {
      throw new Error(
        `Rakuten Ranking API HTTP ${response.status}: ${responseText}`
      );
    }

    let raw;

    try {
      raw =
        JSON.parse(
          responseText
        );
    } catch {
      throw new Error(
        "Rakuten Ranking API returned invalid JSON."
      );
    }

    if (raw.error) {
      throw new Error(
        raw.error_description ||
        raw.error
      );
    }

    const rawItems =
      extractItems(raw);

    console.log(
      `Ranking items: ${rawItems.length}`
    );

    const products =
      rawItems
        .filter((item) => {
          if (!item) {
            return false;
          }

          if (
            Number(item.availability) === 0
          ) {
            return false;
          }

          return (
            item.itemName &&
            (
              item.affiliateUrl ||
              item.itemUrl
            )
          );
        })

        .slice(
          0,
          12
        )

        .map(
          (item, index) => {
            const images =
              Array.isArray(
                item.mediumImageUrls
              )
                ? item.mediumImageUrls
                : [];

            return {
              rank:
                Number(
                  item.rank ||
                  index + 1
                ),

              name:
                item.itemName ||
                "",

              catchcopy:
                item.catchcopy ||
                "",

              price:
                Number(
                  item.itemPrice ||
                  0
                ),

              url:
                item.affiliateUrl ||
                item.itemUrl ||
                "",

              image:
                images.length
                  ? getImageUrl(
                      images[0]
                    )
                  : "",

              reviewCount:
                Number(
                  item.reviewCount ||
                  0
                ),

              reviewAverage:
                Number(
                  item.reviewAverage ||
                  0
                ),

              affiliateRate:
                Number(
                  item.affiliateRate ||
                  0
                ),

              pointRate:
                Number(
                  item.pointRate ||
                  1
                ),

              freeShipping:
                Number(
                  item.postageFlag
                ) === 0,

              shopName:
                item.shopName ||
                "",
            };
          }
        );

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
        raw.title ||
        "",

      rankingUpdatedAt:
        raw.lastBuildDate ||
        "",

      rawItemCount:
        rawItems.length,

      selectedCount:
        products.length,

      products:
        products,
    };

    cache = {
      expiresAt:
        Date.now() +
        CACHE_MS,

      data:
        result,
    };

    return result;
  })();

  try {
    return await pendingRequest;
  } finally {
    pendingRequest = null;
  }
}

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      const origin =
        req.headers.origin ||
        "";

      if (
        req.method ===
        "OPTIONS"
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
        req.url ===
        "/health"
      ) {
        sendJson(
          res,
          200,
          {
            status:
              "ok",

            service:
              "rakuten-product-finder-api",
          },
          origin
        );

        return;
      }

      if (
        req.url ===
          "/api/products" &&
        req.method ===
          "GET"
      ) {
        if (
          origin &&
          origin !==
            ALLOWED_ORIGIN
        ) {
          sendJson(
            res,
            403,
            {
              error:
                "Forbidden",
            }
          );

          return;
        }

        try {
          const data =
            await fetchRakutenRanking();

          sendJson(
            res,
            200,
            data,
            origin
          );
        } catch (
          error
        ) {
          console.error(
            error
          );

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
          error:
            "Not found",
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
