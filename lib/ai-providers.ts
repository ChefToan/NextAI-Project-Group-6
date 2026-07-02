import "server-only";

// Shared LLM provider plumbing used by both the grounded chat assistant and the
// AI report drafter. Providers return raw text; callers parse/validate.

export type ProviderName = "gemini" | "openrouter";
export type ProviderResult = { provider: ProviderName; model: string; text: string };

const AI_TIMEOUT_MS = 18_000;
const AI_PROVIDER_ATTEMPTS = 2;

export function configured(value: string | undefined): value is string {
  return Boolean(value && value.trim() && !value.includes("your_") && !value.includes("your-"));
}

export function anyProviderConfigured(): boolean {
  return configured(process.env.GEMINI_API_KEY) || configured(process.env.OPENROUTER_API_KEY);
}

export function providerOrder(): ProviderName[] {
  const raw = process.env.AI_PROVIDER_ORDER || process.env.AI_PRIMARY_PROVIDER || "gemini,openrouter";
  const order = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is ProviderName => item === "gemini" || item === "openrouter");
  return order.length ? [...new Set(order)] : ["gemini", "openrouter"];
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = AI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function retryAttempts() {
  const raw = Number(process.env.AI_PROVIDER_ATTEMPTS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 4) : AI_PROVIDER_ATTEMPTS;
}

function isTransientProviderError(message: string) {
  return /429|500|502|503|504|abort|timeout|temporar|unavailable|high demand|fetch failed|did not include/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callGemini(prompt: string): Promise<ProviderResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!configured(apiKey)) throw new Error("GEMINI_API_KEY is missing.");

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${detail.slice(0, 500)}`);
  }

  const json = await response.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini response did not include text content.");
  return { provider: "gemini", model, text };
}

export async function callOpenRouter(prompt: string): Promise<ProviderResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!configured(apiKey)) throw new Error("OPENROUTER_API_KEY is missing.");

  const model = process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-ultra-550b-a55b:free";
  const allowPaid = process.env.OPENROUTER_ALLOW_PAID === "true";
  if (!allowPaid && !model.endsWith(":free")) {
    throw new Error(`OpenRouter model "${model}" is blocked because it is not a :free model. Set OPENROUTER_MODEL to a :free slug or explicitly set OPENROUTER_ALLOW_PAID=true.`);
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  if (process.env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  if (process.env.OPENROUTER_APP_TITLE) headers["X-Title"] = process.env.OPENROUTER_APP_TITLE;

  const response = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${detail.slice(0, 500)}`);
  }

  const json = await response.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter response did not include message content.");
  return { provider: "openrouter", model, text };
}

// Try providers in configured order; return the first success or throw the
// combined error. onStatus/onError let callers surface progress and warnings.
export async function callAiJson(
  prompt: string,
  hooks: { onStatus?: (message: string) => void; onError?: (message: string) => void } = {},
): Promise<ProviderResult> {
  const errors: string[] = [];
  const attempts = retryAttempts();
  for (const provider of providerOrder()) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const suffix = attempt > 1 ? ` (retry ${attempt}/${attempts})` : "";
        hooks.onStatus?.(`Calling ${provider === "gemini" ? "Google AI Studio" : "OpenRouter"}${suffix}...`);
        return provider === "gemini" ? await callGemini(prompt) : await callOpenRouter(prompt);
      } catch (error) {
        const message = error instanceof Error ? error.message : `${provider} failed.`;
        errors.push(`${provider} attempt ${attempt}: ${message}`);
        hooks.onError?.(message);
        if (attempt >= attempts || !isTransientProviderError(message)) break;
        await sleep(300 * attempt);
      }
    }
  }
  throw new Error(errors.join(" | ") || "No AI provider is configured.");
}

// Extract a JSON object from a model response that may be fenced in ```json.
export function parseJsonBlock(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}
