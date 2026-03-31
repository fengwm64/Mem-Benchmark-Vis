function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

function stripCodeFence(value) {
  const text = String(value || "").trim();
  if (text.startsWith("```")) {
    return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return text;
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(stripCodeFence(text));
  } catch {
    return null;
  }
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {})
    }
  });
}

async function handleTranslationConfig(env) {
  return json({
    baseUrl: env.BASE_URL || "",
    model: env.MODEL || "",
    hasApiKey: Boolean(env.API_KEY)
  });
}

async function handleTranslate(request, env) {
  if (!env.BASE_URL || !env.MODEL) {
    return json(
      {
        error: "Missing BASE_URL or MODEL in worker vars."
      },
      { status: 500 }
    );
  }

  if (!env.API_KEY) {
    return json(
      {
        error: "Missing API_KEY secret."
      },
      { status: 500 }
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const texts = Array.isArray(body?.texts) ? body.texts.map((item) => String(item)) : [];
  const targetLanguage = String(body?.targetLanguage || "简体中文");

  if (!texts.length) {
    return json({ error: "Missing texts." }, { status: 400 });
  }

  const response = await fetch(`${normalizeBaseUrl(env.BASE_URL)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.API_KEY}`
    },
    body: JSON.stringify({
      model: env.MODEL,
      temperature: 0.2,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content:
            "You are a translation engine. Translate every input string faithfully and naturally. Return strict JSON with a single key named translations whose value is an array of strings."
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              target_language: targetLanguage,
              rules: [
                "Return an object like {\"translations\": [\"...\"]}.",
                "The translations array length must exactly match the input length.",
                "Do not add commentary.",
                "Preserve identifiers such as D1:3, URLs, and code-like tokens."
              ],
              input: texts
            },
            null,
            2
          )
        }
      ]
    })
  });

  if (!response.ok) {
    return json(
      {
        error: `Upstream translation request failed with status ${response.status}.`,
        details: await response.text()
      },
      { status: 502 }
    );
  }

  const upstream = await response.json();
  const content = upstream?.choices?.[0]?.message?.content;
  const parsed = parseJsonSafely(content);
  const translations = parsed?.translations;

  if (!Array.isArray(translations) || translations.length !== texts.length) {
    return json(
      {
        error: "Invalid translation payload returned by upstream model."
      },
      { status: 502 }
    );
  }

  return json({
    translations: translations.map((item) => String(item)),
    model: env.MODEL
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/translation-config" && request.method === "GET") {
      return handleTranslationConfig(env);
    }

    if (url.pathname === "/api/translate" && request.method === "POST") {
      return handleTranslate(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
