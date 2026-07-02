"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Group6Dashboard } from "@/lib/brm-group6";
import type { DateRange } from "@/lib/range";

type AssistantBullet = { text: string; sourceLabel: string; sourceKey: string };
type AssistantSource = { label: string; key: string };
type AssistantAction = { label: string; kind: "report" | "raw_usage" | "none"; href?: string };

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  verdict?: string;
  bullets?: AssistantBullet[];
  confidence?: string;
  sources?: AssistantSource[];
  actions?: AssistantAction[];
  provider?: string;
  model?: string;
  warnings?: string[];
  errors?: string[];
  status?: string;
};

type AssistantResponse = {
  verdict: string;
  bullets: AssistantBullet[];
  confidence: string;
  sources: AssistantSource[];
  actions: AssistantAction[];
  configured: boolean;
  provider?: string;
  model?: string;
  warnings: string[];
  errors: string[];
};

type StreamEvent =
  | { type: "status"; message: string }
  | { type: "result"; payload: AssistantResponse }
  | { type: "error"; payload: AssistantResponse };

function Avatar({ role }: { role: "user" | "assistant" }) {
  return (
    <div className={`chat-avatar ${role === "assistant" ? "assistant-avatar" : "user-avatar"}`} aria-hidden="true">
      {role === "assistant" ? <span className="ms">smart_toy</span> : "You"}
    </div>
  );
}

function messageContent(message: AssistantMessage) {
  if (message.role === "user") return message.text || "";
  return [message.verdict, ...(message.bullets || []).map((bullet) => bullet.text)].filter(Boolean).join(" ");
}

function sourceClass(key: string) {
  if (key === "tax" || key === "exceptions") return "source-chip warn";
  if (key === "ar" || key === "pricing") return "source-chip neutral";
  return "source-chip";
}

export function Group6Assistant({
  data,
  range,
  rangeLabel,
}: {
  data: Group6Dashboard;
  range?: DateRange;
  rangeLabel?: string;
}) {
  const prompts = useMemo(
    () => [
      "Compare Odyssey 3.0 and 3.5 for the selected usage period.",
      "Explain revenue, tax, AR, and unpaid bill risks.",
      "What CSV report should I generate for usage revenue by model?",
      "Which products, plans, and usage buckets need attention?",
    ],
    [],
  );

  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      verdict: "Hi, I can answer grounded questions about Group 6 usage, billing, model mix, tax, AR, pricing, and data quality.",
      bullets: [],
      sources: [],
    },
  ]);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  async function readStream(response: Response, assistantId: string) {
    const reader = response.body?.getReader();
    if (!reader) {
      const payload = (await response.json()) as AssistantResponse;
      setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, ...payload, status: undefined } : message)));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as StreamEvent;
        if (event.type === "status") {
          setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, status: event.message } : message)));
        } else {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    ...event.payload,
                    status: undefined,
                  }
                : message,
            ),
          );
        }
      }
    }
  }

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isThinking) return;

    const assistantId = crypto.randomUUID();
    const userMessage: AssistantMessage = { id: crypto.randomUUID(), role: "user", text: trimmed };
    const history = messages
      .filter((message) => message.id !== "welcome")
      .slice(-8)
      .map((message) => ({
        role: message.role,
        content: messageContent(message),
      }))
      .filter((message) => message.content);

    setInput("");
    setIsThinking(true);
    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        verdict: "Preparing a grounded answer...",
        bullets: [],
        sources: [],
        status: "Reading dashboard context...",
      },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          range,
          history,
          dashboardContext: {
            rangeLabel: rangeLabel || `Simulated now ${data.simulatedNowUtc} UTC`,
            processor: "Oracle BRM PIN schema",
            segment: data.serviceType,
            updatedText: `Fetched ${data.generatedAt}`,
            kpis: {
              group6Users: data.metrics.group6_user_total,
              activeUsers: data.metrics.group6_active_users,
              purchasedProducts: data.metrics.group6_purchased_product_total,
              productCatalog: data.metrics.group6_product_catalog_total,
              planCatalog: data.metrics.group6_plan_catalog_total,
            },
            group6: data,
          },
        }),
      });

      if (!response.ok) throw new Error(`Assistant route returned ${response.status}.`);
      await readStream(response, assistantId);
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                verdict: "I could not reach the assistant route.",
                bullets: [
                  {
                    text: error instanceof Error ? error.message : "Unknown assistant error",
                    sourceLabel: "Client",
                    sourceKey: "kpis",
                  },
                ],
                confidence: "Error",
                sources: [{ label: "Client", key: "kpis" }],
                errors: [error instanceof Error ? error.message : "Unknown assistant error"],
                status: undefined,
              }
            : message,
        ),
      );
    } finally {
      setIsThinking(false);
    }
  }

  return (
    <aside className="assistant-panel" aria-label="NextAI assistant">
      <div className="assistant-header">
        <div className="assistant-title-row">
          <Avatar role="assistant" />
          <div>
            <div className="eyebrow">AI assistant</div>
            <h2>Dashboard analyst</h2>
          </div>
        </div>
      </div>

      <div className="prompt-list">
        <div className="prompt-list-label">Try asking</div>
        {prompts.map((prompt) => (
          <button key={prompt} type="button" className="prompt-card" onClick={() => ask(prompt)}>
            <span className="ms" aria-hidden="true">north_east</span>
            <span>{prompt}</span>
          </button>
        ))}
      </div>

      <div className="thread" ref={threadRef}>
        {messages.map((message) => (
          <div className={`chat-row ${message.role === "user" ? "from-user" : "from-assistant"}`} key={message.id}>
            {message.role === "assistant" ? <Avatar role="assistant" /> : null}
            {message.role === "user" ? (
              <div className="message user-message">{message.text}</div>
            ) : (
              <div className={`message assistant-message${message.errors?.length ? " has-error" : ""}`}>
                <strong>{message.verdict}</strong>
                {message.status ? <div className="assistant-status"><span className="ms">progress_activity</span>{message.status}</div> : null}
                {message.bullets && message.bullets.length > 0 ? (
                  <ul>
                    {message.bullets.map((bullet) => (
                      <li key={`${message.id}-${bullet.text}`}>
                        {bullet.text}
                        <span>{bullet.sourceLabel}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {message.warnings && message.warnings.length > 0 ? (
                  <div className="assistant-notes warn">
                    {message.warnings.map((warning) => <span key={warning}>{warning}</span>)}
                  </div>
                ) : null}
                {message.errors && message.errors.length > 0 ? (
                  <div className="assistant-notes error">
                    {message.errors.map((error) => <span key={error}>{error}</span>)}
                  </div>
                ) : null}
                {message.sources && message.sources.length > 0 ? (
                  <div className="assistant-sources" aria-label="Sources">
                    {message.sources.map((source) => <span className={sourceClass(source.key)} key={`${message.id}-${source.key}-${source.label}`}>{source.label}</span>)}
                  </div>
                ) : null}
                {message.actions && message.actions.length > 0 ? (
                  <div className="assistant-actions">
                    {message.actions.map((action) => action.href ? (
                      <a key={`${message.id}-${action.label}`} href={action.href} className="assistant-action">
                        <span className="ms">open_in_new</span>{action.label}
                      </a>
                    ) : (
                      <button key={`${message.id}-${action.label}`} type="button" className="assistant-action" disabled>{action.label}</button>
                    ))}
                  </div>
                ) : null}
                {message.confidence ? <div className="confidence">{message.confidence}</div> : null}
                {message.provider ? <div className="provider-line">{message.provider}{message.model ? ` · ${message.model}` : ""}</div> : null}
              </div>
            )}
            {message.role === "user" ? <Avatar role="user" /> : null}
          </div>
        ))}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          ask(input);
        }}
      >
        <input
          aria-label="Ask the dashboard assistant"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about any Group 6 metric..."
          disabled={isThinking}
        />
        <button type="submit" disabled={isThinking}>
          Ask
        </button>
      </form>
    </aside>
  );
}
