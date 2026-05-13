const GITHUB_PAGE = "https://ir-netlify.github.io/NETLIFY/";

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "forwarded",
  "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
  "x-forwarded-for", "x-real-ip", "x-host"
]);

export const config = {
  path: "/*",
  cache: "manual"
  // Rate Limit فعلاً خاموش شد تا قطع و وصل کمتر بشه
};

export default async function handler(request, context) {
  try {
    const url = new URL(request.url);
    const method = request.method;
    const upgrade = request.headers.get("upgrade")?.toLowerCase();

    let targetHost = request.headers.get("x-host") || Netlify.env.get("TARGET_DOMAIN");

    // لندینگ پیج
    if (url.pathname === "/" && !targetHost && method === "GET" && upgrade !== "websocket") {
      const githubResponse = await fetch(GITHUB_PAGE);
      const githubContent = await githubResponse.text();
      return new Response(githubContent, {
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "cache-control": "public, max-age=3600"
        }
      });
    }

    if (!targetHost) {
      return new Response("Error: x-host or TARGET_DOMAIN missing", { 
        status: 400,
        headers: { "cache-control": "no-store" }
      });
    }

    // ساخت Target URL
    let targetUrl;
    if (targetHost.startsWith('http://') || targetHost.startsWith('https://')) {
      targetUrl = `${targetHost}${url.pathname}${url.search}`;
    } else {
      const isSecure = !targetHost.includes(':') || 
                      targetHost.includes(':443') || 
                      /^s\d+\./.test(targetHost);
      const protocol = isSecure ? 'https://' : 'http://';
      targetUrl = `${protocol}${targetHost}${url.pathname}${url.search}`;
    }

    // هدرها
    const headers = new Headers();
    let clientIp = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for");

    for (const [key, value] of request.headers) {
      const k = key.toLowerCase();
      if (STRIP_HEADERS.has(k) || k.startsWith("x-nf-") || k.startsWith("x-netlify-")) continue;
      headers.set(k, value);
    }

    if (clientIp) headers.set("x-forwarded-for", clientIp);

    const fetchOptions = {
      method,
      headers,
      redirect: "manual",
      body: (method !== "GET" && method !== "HEAD") ? request.body : undefined,
    };

    const upstream = await fetch(targetUrl, fetchOptions);

    const responseHeaders = new Headers();
    for (const [key, value] of upstream.headers) {
      if (key.toLowerCase() === "transfer-encoding") continue;
      responseHeaders.set(key, value);
    }

    // Cache Policy — برای XHTTP خیلی محدود
    if (method === "GET" && !upgrade && upstream.ok) {
      responseHeaders.set("Cache-Control", "public, max-age=15, s-maxage=30");
    } else {
      responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
    }

    responseHeaders.set("Vary", "x-host, accept-encoding");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error("Relay Error:", error.message);
    return new Response("Bad Gateway", { 
      status: 502,
      headers: { "cache-control": "no-store" }
    });
  }
}
