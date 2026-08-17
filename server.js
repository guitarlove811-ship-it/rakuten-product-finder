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
  res.setHeader("Cache-Control", "public, max-age=300");
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

function calculateScore(item) {
  const affiliateRate = Number(item.affiliateRate || 0);
  const reviewAverage = Number(item.reviewAverage || 0);
  const reviewCount = Number(item.reviewCount || 0);
  const pointRate = Number(item.pointRate || 1);

  return (
    affiliateRate * 12 +
    reviewAverage * 12 +
    Math.log10(reviewCount + 1) * 15 +
    Math.min(pointRate * 2, 20) +
    (Number(item.postageFlag) === 0 ? 5 : 0)
  );
}

async function getRakutenProducts() {
  if (cache.data && Date.now() < cache.expiresAt) {
    return cache.data;
  }

  if (pendingRequest) {
    return pendingRequest;
  }

  pendingRequest = (async () => {
    const appId = process.env.RAKUTEN_APP_ID;
    const accessKey = process.env.RAKUTEN_ACCESS_KEY;
    const affiliateId = process.env.RAKUTEN_AFFILIATE_ID;

    if (!appId || !accessKey || !affiliateId) {
      throw new Error("Rakuten API credentials are not configured.");
    }

    const params = new URLSearchParams({
      applicationId: appId,
      accessKey,
      affiliateId,
      format: "json",
      formatVersion: "2",
      keyword: "スイーツ",
      hits: "30",
      imageFlag: "1",
      hasReviewFlag: "1",
      availability: "1",
      carrier: "2",
      sort: "-reviewCount",
      elements: [
        "itemName",
        "catchcopy",
        "itemPrice",
        "affiliateUrl",
        "mediumImageUrls",
        "reviewCount",
        "reviewAverage",
        "affiliateRate",
        "pointRate",
        "postageFlag",
        "startTime",
        "endTime",
        "shopName",
      ].join(","),
    });

    const response = await fetch(`${RAKUTEN_ENDPOINT}?${params.toString()}`);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Rakuten API error ${response.status}: ${text}`);
    }

    const raw = await response.json();

    if (raw.error) {
      throw new Error(raw.error_description || raw.error);
    }

    const products = (raw.items || [])
      .map((item) => ({
        name: item.itemName || "",
        catchcopy: item.catchcopy || "",
        price: Number(item.itemPrice || 0),
        url: item.affiliateUrl || "",
        image:
          Array.isArray(item.mediumImageUrls) &&
          item.mediumImageUrls.length > 0
            ? item.mediumImageUrls[0]
            : "",
        reviewCount: Number(item.reviewCount || 0),
        reviewAverage: Number(item.reviewAverage || 0),
        affiliateRate: Number(item.affiliateRate || 0),
        pointRate: Number(item.pointRate || 1),
        freeShipping: Number(item.postageFlag) === 0,
        startTime: item.startTime || "",
        endTime: item.endTime || "",
        shopName: item.shopName || "",
        score: calculateScore(item),
      }))
      .filter((item) => item.url && item.name)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((item, index) => ({
        ...item,
        rank: index + 1,
        score: Math.round(item.score),
      }));

    const result = {
      updatedAt: new Date().toISOString(),
      category: "スイーツ",
      products,
    };

    cache = {
      expiresAt: Date.now() + CACHE_MS,
      data: result,
    };

    return result;
  })();

  try {
    return await pendingRequest;
  } finally {
    pendingRequest = null;
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";

  if (req.method === "OPTIONS") {
    if (origin === ALLOWED_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    }
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health") {
    sendJson(res, 200, { status: "ok" }, origin);
    return;
  }

  if (req.url === "/api/products" && req.method === "GET") {
    if (origin && origin !== ALLOWED_ORIGIN) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    try {
      const data = await getRakutenProducts();
      sendJson(res, 200, data, origin);
    } catch (error) {
      console.error(error);
      sendJson(
        res,
        500,
        { error: "商品の取得に失敗しました。" },
        origin
      );
    }

    return;
  }

  sendJson(res, 404, { error: "Not found" }, origin);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
