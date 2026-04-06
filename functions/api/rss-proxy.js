export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const feedUrl = url.searchParams.get("url");

  if (!feedUrl) {
    return new Response(JSON.stringify({ error: "Missing url parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const response = await fetch(feedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PodcastBot/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
      },
    });

    const text = await response.text();
    return new Response(text, {
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
