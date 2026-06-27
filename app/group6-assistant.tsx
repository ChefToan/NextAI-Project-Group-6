"use client";

import { useMemo, useState } from "react";
import type { Group6Dashboard } from "@/lib/brm-group6";

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text?: string;
  verdict?: string;
  bullets?: Array<{ text: string; sourceLabel: string; sourceKey: string }>;
  confidence?: string;
  sources?: Array<{ label: string; key: string }>;
};

type AssistantResponse = {
  verdict: string;
  bullets: Array<{ text: string; sourceLabel: string; sourceKey: string }>;
  confidence: string;
  sources: Array<{ label: string; key: string }>;
};

function Avatar({ role }: { role: "user" | "assistant" }) {
  return (
    <div className={`chat-avatar ${role === "assistant" ? "assistant-avatar" : "user-avatar"}`} aria-hidden="true">
      {role === "assistant" ? <span className="ms">smart_toy</span> : "You"}
    </div>
  );
}

export function Group6Assistant({ data }: { data: Group6Dashboard }) {
  const prompts = useMemo(
    () => [
      "Compare Odyssey 3.0 and 3.5 on usage and revenue.",
      "When should we add serving capacity?",
      "Which products drive the most billed revenue?",
    ],
    [],
  );

  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      verdict: "Hi, I can help explain usage, revenue, plan mix, and model trends for this dashboard.",
      bullets: [],
    },
  ]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || isThinking) return;

    setInput("");
    setIsThinking(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: trimmed },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          dashboardContext: {
            rangeLabel: `Simulated now ${data.simulatedNowUtc} UTC`,
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

      const payload = (await response.json()) as AssistantResponse;
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          verdict: payload.verdict,
          bullets: payload.bullets,
          confidence: payload.confidence,
          sources: payload.sources,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          verdict: "I could not reach the assistant route.",
          bullets: [
            {
              text:
                error instanceof Error
                  ? error.message
                  : "Unknown assistant error",
              sourceLabel: "Client",
              sourceKey: "kpis",
            },
          ],
          confidence: "Error",
          sources: [{ label: "Client", key: "kpis" }],
        },
      ]);
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

      <div className="thread">
        {messages.map((message) => (
          <div className={`chat-row ${message.role === "user" ? "from-user" : "from-assistant"}`} key={message.id}>
            {message.role === "assistant" ? <Avatar role="assistant" /> : null}
            {message.role === "user" ? (
              <div className="message user-message">{message.text}</div>
            ) : (
              <div className="message assistant-message">
                <strong>{message.verdict}</strong>
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
                {message.confidence ? <div className="confidence">{message.confidence}</div> : null}
              </div>
            )}
            {message.role === "user" ? <Avatar role="user" /> : null}
          </div>
        ))}
        {isThinking ? (
          <div className="chat-row from-assistant">
            <Avatar role="assistant" />
            <div className="message assistant-message">
              <strong>Reviewing the dashboard metrics...</strong>
              <div className="confidence">Assistant</div>
            </div>
          </div>
        ) : null}
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
          placeholder="Ask about usage, revenue, products..."
        />
        <button type="submit" disabled={isThinking}>
          Ask
        </button>
      </form>
    </aside>
  );
}
