// Block private/internal IP ranges to prevent SSRF attacks.
// Even though this endpoint sits behind Cloudflare Access, defense in depth.
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase();

  // localhost + IPv6 loopback
  if (h === "localhost" || h === "::1" || h === "[::1]" || h === "0.0.0.0") return true;

  // IPv4 private/reserved ranges
  if (/^127\./.test(h)) return true;              // loopback
  if (/^10\./.test(h)) return true;               // private
  if (/^192\.168\./.test(h)) return true;         // private
  if (/^169\.254\./.test(h)) return true;         // link-local / cloud metadata
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true; // private
  if (/^0\./.test(h)) return true;                // reserved

  // Internal TLDs
  if (/\.(internal|local|localhost)$/.test(h)) return true;

  return false;
}

function validateFeedUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "Only http(s) protocols allowed" };
  }

  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, reason: "Host not allowed" };
  }

  return { ok: true, url: parsed.toString() };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const feedUrl = url.searchParams.get("url");

  if (!feedUrl) {
    return new Response(JSON.stringify({ error: { message: "Missing url parameter" } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const validated = validateFeedUrl(feedUrl);
  if (!validated.ok) {
    return new Response(JSON.stringify({ error: { message: validated.reason } }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const response = await fetch(validated.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PodcastBot/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
      },
      redirect: "follow",
    });

    const text = await response.text();
    return new Response(text, {
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: e.message } }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
