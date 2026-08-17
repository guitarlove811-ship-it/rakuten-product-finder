const http = require("http");

const PORT = process.env.PORT || 10000;

const ALLOWED_ORIGIN =
  "https://guitarlove811-ship-it.github.io";

const RAKUTEN_ENDPOINT =
  "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701";

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
    raw.items,
    raw.Items,
    raw.item,
    raw.Item,
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
  score +=
    Math.log10(reviewCount + 1) * 15;
  score +=
    Math.min(pointRate * 2, 20);

  if (
    Number(item.postageFlag) === 0
  ) {
    score += 5;
  }

  return score;
}

async function callRakuten() {
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

  const elements = [
    "itemName",
    "catchcopy",
    "itemPrice",
    "itemUrl",
    "affiliateUrl",
    "mediumImageUrls",
    "reviewCount",
    "reviewAverage",
    "affiliateRate",
    "pointRate",
    "postageFlag",
    "shopName",
  ].join(",");

  const params =
    new URLSearchParams({
      applicationId: appId,
      affiliateId: affiliateId,

      format: "json",
      formatVersion: "2",

      keyword: "スイーツ",

      hits: "30",

      sort: "-reviewCount",

      elements: elements,
    });

  const requestUrl =
    `${RAKUTEN_ENDPOINT}?${params.toString()}`;

  console.log(
    "Requesting Rakuten API..."
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
    "Rakuten HTTP status:",
    response.status
  );

  if (!response.ok) {
    throw new Error(
      `Rakuten API HTTP ${response.status}: ${responseText}`
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
      "Rakuten API returned invalid JSON."
    );
  }

  if (raw.error) {
    throw new Error(
      raw.error_description ||
      raw.error
    );
  }

  return raw;
}

async function getProducts() {
  const raw =
    await callRakuten();

  const rawItems =
    extractItems(raw);

  const firstItem =
    rawItems.length
      ? rawItems[0]
      : null;

  console.log(
    "Top level keys:",
    Object.keys(raw)
  );

  console.log(
    "Extracted items:",
    rawItems.length
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
          images.length
            ? getImageUrl(
                images[0]
              )
            : "";

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

          url:
            item.affiliateUrl ||
            item.itemUrl ||
            "",

          image:
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

      .filter(
        (item) =>
          item.name &&
          item.url
      )

      .sort(
        (a, b) =>
          b.score -
          a.score
      )

      .slice(
        0,
        12
      )

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

  return {
    updatedAt:
      new Date().toISOString(),

    category:
      "スイーツ",

    sourceCount:
      Number(
        raw.count ||
        0
      ),

    hits:
      Number(
        raw.hits ||
        0
      ),

    responseKeys:
      Object.keys(raw),

    itemsType:
      raw.items === null
        ? "null"
        : Array.isArray(
            raw.items
          )
        ? "array"
        : typeof raw.items,

    itemsExists:
      Boolean(
        raw.items
      ),

    rawItemCount:
      rawItems.length,

    firstItemKeys:
      firstItem &&
      typeof firstItem ===
        "object"
        ? Object.keys(
            firstItem
          )
        : [],

    selectedCount:
      products.length,

    products:
      products,
  };
}

async function getDebugData() {
  const raw =
    await callRakuten();

  const rawItems =
    extractItems(raw);

  const first =
    rawItems.length
      ? rawItems[0]
      : null;

  return {
    topLevelKeys:
      Object.keys(raw),

    count:
      raw.count,

    hits:
      raw.hits,

    page:
      raw.page,

    first:
      raw.first,

    last:
      raw.last,

    itemsExists:
      Boolean(
        raw.items
      ),

    itemsIsArray:
      Array.isArray(
        raw.items
      ),

    itemsType:
      raw.items === null
        ? "null"
        : typeof raw.items,

    extractedItemCount:
      rawItems.length,

    firstItemKeys:
      first &&
      typeof first ===
        "object"
        ? Object.keys(
            first
          )
        : [],
  };
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
        "/api/debug"
      ) {
        try {
          const data =
            await getDebugData();

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
                "Debug failed",

              detail:
                error.message,
            },
            origin
          );
        }

        return;
      }

      if (
        req.url ===
          "/api/products" &&
        req.method ===
          "GET"
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
