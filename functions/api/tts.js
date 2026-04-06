export async function onRequestPost(context) {
  const apiKey = context.env.GCP_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { message: "GCP_API_KEY not configured" } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await context.request.text();

    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }
    );

    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: e.message } }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
