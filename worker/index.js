const rateLimitStore = new Map();

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

function readInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getAllowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRequestOrigin(request) {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin;
  }

  const referer = request.headers.get("referer");
  if (!referer) {
    return "";
  }

  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

function getClientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown"
  );
}

function cleanupRateLimitStore(now, windowMs) {
  for (const [key, value] of rateLimitStore.entries()) {
    if (now - value.windowStart >= windowMs) {
      rateLimitStore.delete(key);
    }
  }
}

function checkRateLimit(request, env) {
  const limit = readInt(env.TRANSLATE_RATE_LIMIT, 12);
  const windowSec = readInt(env.TRANSLATE_RATE_WINDOW_SEC, 60);
  const windowMs = windowSec * 1000;
  const ip = getClientIp(request);
  const now = Date.now();

  cleanupRateLimitStore(now, windowMs);

  const current = rateLimitStore.get(ip);
  if (!current || now - current.windowStart >= windowMs) {
    rateLimitStore.set(ip, {
      count: 1,
      windowStart: now
    });
    return null;
  }

  if (current.count >= limit) {
    return {
      retryAfter: Math.max(1, Math.ceil((current.windowStart + windowMs - now) / 1000))
    };
  }

  current.count += 1;
  rateLimitStore.set(ip, current);
  return null;
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });
}

function validateOrigin(request, env) {
  const allowedOrigins = getAllowedOrigins(env);
  if (!allowedOrigins.length) {
    return null;
  }

  const origin = getRequestOrigin(request);
  if (origin && allowedOrigins.includes(origin)) {
    return null;
  }

  return json(
    {
      error: "Origin not allowed."
    },
    { status: 403 }
  );
}

function validateContentLength(request, env) {
  const maxBodyBytes = readInt(env.TRANSLATE_MAX_BODY_BYTES, 20000);
  const contentLength = readInt(request.headers.get("content-length"), 0);

  if (contentLength && contentLength > maxBodyBytes) {
    return json(
      {
        error: "Request body too large."
      },
      { status: 413 }
    );
  }

  return null;
}

function validateTranslatePayload(body, env) {
  const maxTexts = readInt(env.TRANSLATE_MAX_TEXTS, 20);
  const maxTotalChars = readInt(env.TRANSLATE_MAX_TOTAL_CHARS, 6000);
  const texts = Array.isArray(body?.texts) ? body.texts.map((item) => String(item)) : [];
  const targetLanguage = String(body?.targetLanguage || "简体中文").trim().slice(0, 64);

  if (!texts.length) {
    return {
      error: json({ error: "Missing texts." }, { status: 400 })
    };
  }

  if (texts.length > maxTexts) {
    return {
      error: json(
        { error: `Too many text entries. Max allowed: ${maxTexts}.` },
        { status: 400 }
      )
    };
  }

  let totalChars = 0;
  for (const text of texts) {
    if (!text.trim()) {
      return {
        error: json({ error: "Text entries cannot be empty." }, { status: 400 })
      };
    }

    totalChars += text.length;
  }

  if (totalChars > maxTotalChars) {
    return {
      error: json(
        { error: `Total text length exceeds the max allowed ${maxTotalChars}.` },
        { status: 400 }
      )
    };
  }

  return {
    texts,
    targetLanguage
  };
}

async function handleTranslationConfig(env) {
  return json({
    baseUrl: env.BASE_URL || "",
    model: env.MODEL || "",
    hasApiKey: Boolean(env.API_KEY),
    limits: {
      rateLimit: readInt(env.TRANSLATE_RATE_LIMIT, 12),
      rateWindowSec: readInt(env.TRANSLATE_RATE_WINDOW_SEC, 60),
      maxTexts: readInt(env.TRANSLATE_MAX_TEXTS, 20),
      maxTotalChars: readInt(env.TRANSLATE_MAX_TOTAL_CHARS, 6000)
    }
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

  const originError = validateOrigin(request, env);
  if (originError) {
    return originError;
  }

  const bodySizeError = validateContentLength(request, env);
  if (bodySizeError) {
    return bodySizeError;
  }

  const rateLimitError = checkRateLimit(request, env);
  if (rateLimitError) {
    return json(
      {
        error: "Too many translation requests. Please try again later."
      },
      {
        status: 429,
        headers: {
          "retry-after": String(rateLimitError.retryAfter)
        }
      }
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const payload = validateTranslatePayload(body, env);
  if (payload.error) {
    return payload.error;
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
              target_language: payload.targetLanguage,
              rules: [
                "Return an object like {\"translations\": [\"...\"]}.",
                "The translations array length must exactly match the input length.",
                "Do not add commentary.",
                "Preserve identifiers such as D1:3, URLs, and code-like tokens."
              ],
              input: payload.texts
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
        error: `Upstream translation request failed with status ${response.status}.`
      },
      { status: 502 }
    );
  }

  const upstream = await response.json();
  const content = upstream?.choices?.[0]?.message?.content;
  const parsed = parseJsonSafely(content);
  const translations = parsed?.translations;

  if (!Array.isArray(translations) || translations.length !== payload.texts.length) {
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
