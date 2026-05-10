const GITHUB_PAGE = "https://ir-netlify.github.io/NETLIFY/";

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "forwarded",
  "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
  "x-forwarded-for", "x-real-ip", "x-host"
]);

// Rate Limiting در حافظه (برای کاهش شدید invocation)
const RATE_LIMIT = {
  windowMs: 60 * 1000,        // ۱ دقیقه
  maxRequests: 180,           // حداکثر ۱۸۰ درخواست در دقیقه برای هر IP (برای تلگرام تنظیم شد)
  blockTime: 2 * 60 * 1000    // ۲ دقیقه بلاک اگر بیشتر شد
};

const ipRequests = new Map();

export const config = {
  path: "/*",
  cache: "manual",
  rateLimit: {                // Rate Limit آماده نتلیفای
    windowLimit: 300,
    windowSize: 60,
    aggregateBy: ["ip"]
  }
};

export default async function handler(request, context) {
  const url = new URL(request.url);
  const method = request.method;
  const upgrade = request.headers.get("upgrade")?.toLowerCase();
  const clientIP = context.ip || request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "unknown";

  // ==================== Rate Limiting قوی ====================
  if (!checkRateLimit(clientIP)) {
    return new Response("Too Many Requests (Rate Limited)", { 
      status: 429,
      headers: { "cache-control": "no-store" }
    });
  }

  let targetHost = request.headers.get("x-host") || Netlify.env.get("TARGET_DOMAIN");

  // لندینگ پیج
  if (url.pathname === "/" && !targetHost && method === "GET" && upgrade !== "websocket") {
    const resp = await fetch(GITHUB_PAGE);
    return new Response(await resp.text(), {
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "cache-control": "public, max-age=7200, s-maxage=86400"
      }
    });
  }

  if (!targetHost) {
    return new Response("Missing target", { status: 400, headers: { "cache-control": "no-store" } });
  }

  // ==================== ساخت URL و Fetch ====================
  let targetUrl = targetHost.startsWith('http') 
    ? `${targetHost}${url.pathname}${url.search}`
    : `https://${targetHost}${url.pathname}${url.search}`;

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const k = key.toLowerCase();
    if (STRIP_HEADERS.has(k) || k.startsWith("x-nf-") || k.startsWith("x-netlify-")) continue;
    headers.set(k, value);
  }

  const fetchOptions = {
    method,
    headers,
    redirect: "manual",
    body: (method !== "GET" && method !== "HEAD") ? request.body : undefined,
  };

  const upstream = await fetch(targetUrl, fetchOptions);

  const responseHeaders = new Headers(upstream.headers);
  if (key.toLowerCase() === "transfer-encoding") responseHeaders.delete(key);

  // Cache Policy هوشمند
  if (method === "GET" && !upgrade && upstream.ok) {
    responseHeaders.set("Cache-Control", "public, max-age=30, s-maxage=60");
  } else {
    responseHeaders.set("Cache-Control", "no-store, no-cache");
  }

  responseHeaders.set("Vary", "x-host, accept-encoding");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders
  });
}

// تابع Rate Limiting
function checkRateLimit(ip) {
  const now = Date.now();
  if (!ipRequests.has(ip)) {
    ipRequests.set(ip, { count: 0, resetTime: now + RATE_LIMIT.windowMs, blockedUntil: 0 });
  }

  const data = ipRequests.get(ip);

  if (data.blockedUntil > now) return false;

  if (now > data.resetTime) {
    data.count = 0;
    data.resetTime = now + RATE_LIMIT.windowMs;
  }

  data.count++;
  if (data.count > RATE_LIMIT.maxRequests) {
    data.blockedUntil = now + RATE_LIMIT.blockTime;
    return false;
  }
  return true;
}