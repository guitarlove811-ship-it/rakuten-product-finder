const http = require("http");

const PORT = process.env.PORT || 10000;
const ALLOWED_ORIGIN = "https://guitarlove811-ship-it.github.io";

const RAKUTEN_ENDPOINT =
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";

const CACHE_MS = 15 * 60 * 1000;

let cache = {
  expiresAt: 0,
  data: null,
};

let pendingRequest = null;

function sendJson(res, status, data, origin = "") {
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function getImageUrl(value) {
  if (!value) return "";

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

function calculateScore(item) {
  const affiliateRate =
    Number(item.affiliateRate || 0);

  const reviewAverage =
    Number(item.reviewAverage || 0);

  const reviewCount =
    Number(item.reviewCount || 0);

  const pointRate =
    Number(item.pointRate || 1);

  let score = 0;

  score += affiliateRate * 15;
  score += reviewAverage * 12;
  score += Math.log10(reviewCount + 1) * 15;
  score += Math.min(pointRate * 2, 20);

  if (Number(item.postageFlag) === 0) {
    score += 5;
  }

  return score;
}

async function fetchRakutenProducts() {
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

        keyword: "スイーツ",

        hits: "30",

        field: "0",

        availability: "1",

        imageFlag: "1",

        hasReviewFlag: "1",

        carrier: "2",

        sort: "-reviewCount",
      });

    const url =
      `${RAKUTEN_ENDPOINT}?${params.toString()}`;

    console.log(
      "Requesting Rakuten Ichiba API..."
    );

    const response =
      await fetch(url, {
        method: "GET",

        headers: {
          accessKey: accessKey,
        },
      });

    const responseText =
      await response.text();

    if (!response.ok) {
      throw new Error(
        `Rakuten API HTTP ${response.status}: ${responseText}`
      );
    }

    let raw;

    try {
      raw = JSON.parse(responseText);
    } catch {
      throw new Error(
        "Rakuten API returned invalid JSON."
      );
    }

    if (raw.error) {
      throw new Error(
        raw.error_description ||
        raw.error
      );
    }

    const rawItems =
      Array.isArray(raw.items)
        ? raw.items
        : [];

    console.log(
      `Rakuten returned ${rawItems.length} items`
    );

    const products =
      rawItems
        .map((item) => {
          const images =
            Array.isArray(
              item.mediumImageUrls
            )
              ? item.mediumImageUrls
              : [];

          const image =
            images.length > 0
              ? getImageUrl(
                  images[0]
                )
              : "";

          const url =
            item.affiliateUrl ||
            item.itemUrl ||
            "";

          return {
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

            url,

            image,

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

            score:
              calculateScore(
                item
              ),
          };
        })

        .filter((item) => {
          return (
            item.name &&
            item.url
          );
        })

        .sort(
          (a, b) =>
            b.score -
            a.score
        )

        .slice(0, 12)

        .map(
          (item, index) => ({
            ...item,

            rank:
              index + 1,

            score:
              Math.round(
                item.score
              ),
          })
        );

    const result = {
      updatedAt:
        new Date().toISOString(),

      category:
        "スイーツ",

      sourceCount:
        Number(
          raw.count ||
            0
        ),

      rawItemCount:
        rawItems.length,

      selectedCount:
        products.length,

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
            await fetchRakutenProducts();

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
                "商品の取得に失敗しました。",

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
