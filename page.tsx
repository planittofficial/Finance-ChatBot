"use client";

import { useState, useRef, useEffect } from "react";
import { ChatState } from "@/lib/chat-engine";

interface Message {
  role: "user" | "bot";
  content: string;
  ts: string;
  show_advisor_card?: boolean;
  is_captured?: boolean;
}

const STARTERS = [
  "I want to understand if I'm on the right financial track",
  "I've been thinking about my retirement corpus",
  "I'm not sure if my savings are enough",
  "I want to know where I stand financially",
];

function fmt(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<ChatState | null>(null);
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactForm, setContactForm] = useState({ name: "", phone: "", email: "" });
  const [captured, setCaptured] = useState(false);
  const [advisorPitched, setAdvisorPitched] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Opening bot message
  useEffect(() => {
    setTimeout(() => {
      setMessages([{
        role: "bot",
        content: "Hey! I'm your financial awareness companion — not an advisor, but I can help you see your financial picture more clearly.\n\nWhat's on your mind today? Are you thinking about savings, investments, retirement, or something else entirely?",
        ts: new Date().toISOString(),
      }]);
    }, 400);
  }, []);

  async function send(text?: string) {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput("");

    const userMsg: Message = { role: "user", content: msg, ts: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, state, history }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error);

      const botMsg: Message = {
        role: "bot",
        content: data.reply,
        ts: new Date().toISOString(),
        show_advisor_card: data.show_advisor_card && !advisorPitched,
      };

      setMessages((prev) => [...prev, botMsg]);
      setState(data.state);
      setHistory((prev) => [
        ...prev,
        { role: "user", content: msg },
        { role: "assistant", content: data.reply },
      ]);

      if (data.show_advisor_card && !advisorPitched) {
        setAdvisorPitched(true);
      }
    } catch {
      setMessages((prev) => [...prev, {
        role: "bot",
        content: "I seem to be having a moment. Could you try again?",
        ts: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  async function submitContact() {
    if (!contactForm.name || !contactForm.phone) return;
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...contactForm,
          financial_profile: state?.profile || {},
          conversation_summary: state?.conversation_summary || "",
          peak_insight: state?.peak_insight || "",
          chat_transcript: messages.map((m) => ({
            role: m.role,
            content: m.content,
            ts: m.ts,
          })),
        }),
      });

      setCaptured(true);
      setShowContactForm(false);
      setMessages((prev) => [...prev, {
        role: "bot",
        content: `Perfect, ${contactForm.name.split(" ")[0]}! Priya has your details and will reach out within 24 hours. She'll come prepared with a view of everything we've discussed today — so you won't need to repeat yourself.\n\nYou've taken the hardest step. Most people just keep wondering.`,
        ts: new Date().toISOString(),
        is_captured: true,
      }]);
    } catch {
      alert("Something went wrong. Please try again.");
    }
  }

  const profileItems = state?.profile ? Object.entries({
    ...(state.profile.age ? { "Age": `${state.profile.age}` } : {}),
    ...(state.profile.monthly_income ? { "Income": fmt(state.profile.monthly_income) + "/mo" } : {}),
    ...(state.profile.current_savings ? { "Savings": fmt(state.profile.current_savings) } : {}),
    ...(state.profile.financial_goal ? { "Goal": state.profile.financial_goal } : {}),
  }) : [];

  return (
    <div style={s.page}>
      {/* Sidebar */}
      <aside style={s.sidebar}>
        <div style={s.sideTop}>
          <div style={s.logo}>◈ FPA</div>
          <div style={s.logoSub}>Financial Awareness</div>
        </div>

        {profileItems.length > 0 && (
          <div style={s.profileCard}>
            <div style={s.profileLabel}>YOUR PROFILE</div>
            {profileItems.map(([k, v]) => (
              <div key={k} style={s.profileRow}>
                <span style={s.profileKey}>{k}</span>
                <span style={s.profileVal}>{v}</span>
              </div>
            ))}
            {state?.peak_insight && (
              <div style={s.insightPill}>⚡ {state.peak_insight}</div>
            )}
          </div>
        )}

        <div style={s.sideBottom}>
          <div style={s.disclaimer}>
            This is an AI awareness tool, not financial advice. All insights are illustrative.
          </div>
        </div>
      </aside>

      {/* Chat */}
      <main style={s.chat}>
        {/* Header */}
        <div style={s.chatHeader}>
          <div style={s.advisorAvatar}>P</div>
          <div>
            <div style={s.advisorName}>Financial Awareness Bot</div>
            <div style={s.advisorStatus}>
              <span style={s.statusDot} />
              Online · Powered by AI
            </div>
          </div>
          {!captured && (
            <a href="/admin" style={s.adminLink}>Admin ↗</a>
          )}
        </div>

        {/* Messages */}
        <div style={s.messages}>
          {/* Starters */}
          {messages.length <= 1 && !loading && (
            <div style={s.starters}>
              {STARTERS.map((s) => (
                <button key={s} style={styles.starterBtn} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i}>
              <div style={{ ...s.msgRow, justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                {msg.role === "bot" && <div style={s.botAvatar}>◈</div>}
                <div style={{
                  ...s.bubble,
                  ...(msg.role === "user" ? s.userBubble : s.botBubble),
                }}>
                  {msg.content.split("\n").map((line, j) => (
                    <p key={j} style={{ margin: j > 0 ? "8px 0 0" : "0" }}>{line}</p>
                  ))}

                  {/* Watermark — every bot message */}
                  {msg.role === "bot" && (
                    <div style={s.watermark}>
                      <span style={s.watermarkIcon}>✦</span>
                      AI Generated · FPA Financial Awareness
                    </div>
                  )}
                </div>
              </div>

              {/* Advisor Card */}
              {msg.show_advisor_card && !captured && (
                <div style={s.advisorCard}>
                  <div style={s.advisorCardTop}>
                    <div style={s.advisorCardAvatar}>PS</div>
                    <div>
                      <div style={s.advisorCardName}>Priya Sharma</div>
                      <div style={s.advisorCardTitle}>Senior Financial Advisor · 12 years exp.</div>
                      <div style={s.advisorCardCred}>SEBI Registered · CFP Certified</div>
                    </div>
                  </div>
                  <div style={s.advisorCardBody}>
                    Priya specialises in wealth gap recovery for salaried professionals. She'll review your profile and come prepared with a personalised plan — not a generic pitch.
                  </div>
                  {!showContactForm ? (
                    <button style={s.connectBtn} onClick={() => setShowContactForm(true)}>
                      Yes, have Priya reach out →
                    </button>
                  ) : (
                    <div style={s.contactForm}>
                      <input
                        style={s.contactInput}
                        placeholder="Your name"
                        value={contactForm.name}
                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                      />
                      <input
                        style={s.contactInput}
                        placeholder="Phone number"
                        value={contactForm.phone}
                        onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                      />
                      <input
                        style={s.contactInput}
                        placeholder="Email (optional)"
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                      />
                      <button
                        style={s.submitBtn}
                        onClick={submitContact}
                        disabled={!contactForm.name || !contactForm.phone}
                      >
                        Connect me with Priya
                      </button>
                    </div>
                  )}
                </div>
              )}

              {msg.is_captured && (
                <div style={s.capturedBadge}>
                  ✓ You're all set — Priya will reach out within 24 hours
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{ ...s.msgRow, justifyContent: "flex-start" }}>
              <div style={s.botAvatar}>◈</div>
              <div style={{ ...s.bubble, ...s.botBubble, ...s.typingBubble }}>
                <span style={s.dot} />
                <span style={{ ...s.dot, animationDelay: "0.2s" }} />
                <span style={{ ...s.dot, animationDelay: "0.4s" }} />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        {!captured && (
          <div style={s.inputRow}>
            <input
              ref={inputRef}
              style={s.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Type your message..."
              disabled={loading}
            />
            <button style={s.sendBtn} onClick={() => send()} disabled={loading || !input.trim()}>
              →
            </button>
          </div>
        )}
      </main>

      <style>{`
        @keyframes bounce {
          0%,80%,100%{transform:translateY(0)}
          40%{transform:translateY(-6px)}
        }
        @keyframes fadein {
          from{opacity:0;transform:translateY(8px)}
          to{opacity:1;transform:none}
        }
      `}</style>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: { display: "flex", height: "100vh", background: "#09090b", fontFamily: "var(--sans, DM Sans, sans-serif)", overflow: "hidden" },

  sidebar: { width: 260, borderRight: "1px solid #1f1f27", display: "flex", flexDirection: "column", background: "#0d0d11", flexShrink: 0 },
  sideTop: { padding: "24px 20px 20px" },
  logo: { fontFamily: "monospace", fontSize: 16, fontWeight: 700, letterSpacing: 3, color: "#7effd4" },
  logoSub: { fontSize: 11, color: "#3d3d55", marginTop: 4, letterSpacing: 1 },
  profileCard: { margin: "0 12px", background: "#111116", border: "1px solid #1f1f2a", borderRadius: 12, padding: 14 },
  profileLabel: { fontSize: 9, letterSpacing: 2, color: "#3d3d55", marginBottom: 10, fontFamily: "monospace" },
  profileRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  profileKey: { fontSize: 11, color: "#6e6e88" },
  profileVal: { fontSize: 12, fontFamily: "monospace", color: "#e8e8f0", fontWeight: 600 },
  insightPill: { marginTop: 12, fontSize: 10, color: "#ff9f43", background: "rgba(255,159,67,0.08)", border: "1px solid rgba(255,159,67,0.2)", borderRadius: 8, padding: "6px 8px", lineHeight: 1.5 },
  sideBottom: { marginTop: "auto", padding: "16px 16px 20px" },
  disclaimer: { fontSize: 10, color: "#2a2a38", lineHeight: 1.6 },

  chat: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  chatHeader: { display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid #1f1f27", background: "#0d0d11" },
  advisorAvatar: { width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#7effd4,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#000", fontSize: 14 },
  advisorName: { fontSize: 14, fontWeight: 600, color: "#e8e8f0" },
  advisorStatus: { fontSize: 11, color: "#6e6e88", display: "flex", alignItems: "center", gap: 5, marginTop: 2 },
  statusDot: { width: 6, height: 6, borderRadius: "50%", background: "#7effd4", display: "inline-block" },
  adminLink: { marginLeft: "auto", fontSize: 11, color: "#3d3d55", textDecoration: "none", fontFamily: "monospace" },

  messages: { flex: 1, overflowY: "auto", padding: "20px 20px 8px", display: "flex", flexDirection: "column", gap: 16 },

  starters: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 },

  msgRow: { display: "flex", gap: 10, alignItems: "flex-end", animation: "fadein 0.3s ease" },
  botAvatar: { width: 28, height: 28, borderRadius: "50%", background: "#1a1a24", border: "1px solid #2a2a38", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#7effd4", flexShrink: 0 },

  bubble: { maxWidth: "72%", padding: "12px 15px", borderRadius: 16, fontSize: 14, lineHeight: 1.65, position: "relative" },
  botBubble: { background: "#13131a", border: "1px solid #1f1f2a", color: "#d8d8e8", borderBottomLeftRadius: 4 },
  userBubble: { background: "#7effd4", color: "#040a07", borderBottomRightRadius: 4, fontWeight: 500 },
  typingBubble: { display: "flex", gap: 5, alignItems: "center", padding: "14px 18px" },

  watermark: { display: "flex", alignItems: "center", gap: 5, marginTop: 10, paddingTop: 8, borderTop: "1px solid #1f1f2a", fontSize: 9, color: "#2d2d42", fontFamily: "monospace", letterSpacing: 0.5 },
  watermarkIcon: { color: "#3d3d55", fontSize: 8 },

  dot: { width: 6, height: 6, borderRadius: "50%", background: "#4a4a60", display: "inline-block", animation: "bounce 1.2s infinite" },

  advisorCard: { margin: "8px 0 0 38px", background: "#0f1a15", border: "1px solid #1a3326", borderRadius: 16, padding: 18, maxWidth: 380, animation: "fadein 0.4s ease" },
  advisorCardTop: { display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 },
  advisorCardAvatar: { width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg,#7effd4,#06d6a0)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#040a07", fontSize: 14, flexShrink: 0 },
  advisorCardName: { fontSize: 15, fontWeight: 700, color: "#7effd4" },
  advisorCardTitle: { fontSize: 11, color: "#4a7a65", marginTop: 2 },
  advisorCardCred: { fontSize: 10, color: "#2d5a45", marginTop: 3, fontFamily: "monospace" },
  advisorCardBody: { fontSize: 13, color: "#8a9e95", lineHeight: 1.6, marginBottom: 14 },

  connectBtn: { width: "100%", padding: "11px", background: "#7effd4", color: "#040a07", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" },

  contactForm: { display: "flex", flexDirection: "column", gap: 8 },
  contactInput: { padding: "10px 12px", background: "#0a1510", border: "1px solid #1a3326", borderRadius: 10, color: "#e8e8f0", fontSize: 13, fontFamily: "inherit", outline: "none" },
  submitBtn: { padding: "11px", background: "#7effd4", color: "#040a07", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer", marginTop: 2 },

  capturedBadge: { margin: "8px 0 0 38px", fontSize: 12, color: "#7effd4", background: "rgba(126,255,212,0.06)", border: "1px solid rgba(126,255,212,0.15)", borderRadius: 8, padding: "8px 12px", display: "inline-block" },

  inputRow: { display: "flex", gap: 10, padding: "12px 20px 20px", borderTop: "1px solid #1f1f27", background: "#0d0d11" },
  input: { flex: 1, padding: "12px 16px", background: "#111116", border: "1px solid #1f1f2a", borderRadius: 12, color: "#e8e8f0", fontSize: 14, fontFamily: "inherit", outline: "none" },
  sendBtn: { width: 44, height: 44, background: "#7effd4", color: "#040a07", border: "none", borderRadius: 12, fontSize: 18, fontWeight: 700, cursor: "pointer" },
};

const styles = {
  starterBtn: {
    background: "#111116",
    border: "1px solid #1f1f2a",
    borderRadius: 10,
    padding: "10px 14px",
    color: "#6e6e88",
    fontSize: 13,
    cursor: "pointer",
    textAlign: "left" as const,
    fontFamily: "inherit",
    transition: "border-color 0.15s",
  },
};
