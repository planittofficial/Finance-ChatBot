import { NextRequest, NextResponse } from "next/server";
import {
  buildSystemPrompt,
  advanceStage,
  extractProfileFromMessage,
  buildPeakInsight,
  initialState,
  ChatState,
} from "@/lib/chat-engine";

export async function POST(req: NextRequest) {
  let body: {
    message: string;
    state: ChatState;
    history: { role: "user" | "assistant"; content: string }[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message, history = [] } = body;
  let state: ChatState = body.state || initialState();

  if (!message?.trim()) {
    return NextResponse.json({ error: "Message required" }, { status: 400 });
  }

  // 1. Extract profile data silently from user message
  state.profile = extractProfileFromMessage(message, state.profile);
  state.message_count += 1;

  // 2. Build peak insight when we have enough data
  if (!state.peak_insight && state.profile.monthly_income) {
    state.peak_insight = buildPeakInsight(state.profile);
  }

  // 3. Advance stage based on data collected
  state.stage = advanceStage(state, message);

  // 4. Build system prompt for this stage
  const systemPrompt = buildSystemPrompt(state);

  // 5. Call Claude API
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user" as const, content: message },
  ];

  let botReply = "";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 400,
        system: systemPrompt,
        messages,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Claude API error");
    botReply = data.content?.[0]?.text || "";
  } catch (err) {
    console.error("[/api/chat] Claude error:", err);
    return NextResponse.json({ error: "AI service error" }, { status: 502 });
  }

  // 6. Detect if advisor pitch should be appended
  const isPitchStage = state.stage === "PITCH";

  // 7. Update conversation summary
  if (state.message_count <= 1) {
    state.conversation_summary = `User initiated conversation about financial planning.`;
  } else if (state.profile.financial_goal) {
    state.conversation_summary = `Goal: ${state.profile.financial_goal}. ${state.peak_insight || "Profile being built."}`;
  }

  return NextResponse.json({
    reply: botReply,
    state,
    show_advisor_card: isPitchStage && !state.advisor_pitched,
    stage: state.stage,
  });
}
