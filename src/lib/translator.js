function stripCodeFence(value) {
  const text = String(value || "").trim();
  if (text.startsWith("```")) {
    return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return text;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(stripCodeFence(text));
  } catch {
    return null;
  }
}

export async function fetchTranslationRuntimeConfig() {
  const response = await fetch("/api/translation-config");

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load translation config: ${response.status} ${errorText}`);
  }

  return response.json();
}

export async function translateTexts({ targetLanguage, texts }) {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      targetLanguage,
      texts
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Translation request failed: ${response.status} ${errorText}`);
  }

  const json = await response.json();
  const translations = json?.translations;

  if (!Array.isArray(translations) || translations.length !== texts.length) {
    throw new Error("Translation response format is invalid.");
  }

  return translations.map((item) => String(item));
}

export function chunkTexts(texts, chunkSize = 20) {
  const chunks = [];

  for (let index = 0; index < texts.length; index += chunkSize) {
    chunks.push(texts.slice(index, index + chunkSize));
  }

  return chunks;
}

export function buildCacheKey(targetLanguage, text) {
  return `${targetLanguage}::${text}`;
}

export function parseModelJsonContent(content) {
  return safeJsonParse(content);
}
