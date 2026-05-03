import { FinancialProfile } from "./leads-store";

// ─── Conversation Stages ─────────────────────────────────────────────────────
// OPEN      → casual, friendly, building trust (msgs 1-2)
// DEEPEN    → surfacing gaps, mild urgency (msgs 3-4)
// PEAK      → alarming insight, emotional high point (msg 5)
// PITCH     → advisor card, never give the solution (msg 6+)
// CAPTURED  → user said yes, collect contact

export type Stage = "OPEN" | "DEEPEN" | "PEAK" | "PITCH" | "CAPTURED";

export interface ChatState {
  stage: Stage;
  message_count: number;
  profile: FinancialProfile;
  peak_insight: string;
  conversation_summary: string;
  advisor_pitched: boolean;
}

export function initialState(): ChatState {
  return {
    stage: "OPEN",
    message_count: 0,
    profile: {},
    peak_insight: "",
    conversation_summary: "",
    advisor_pitched: false,
  };
}

// ─── System Prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(state: ChatState): string {
  const profileContext = Object.keys(state.profile).length > 0
    ? `\nKNOWN ABOUT USER SO FAR:\n${JSON.stringify(state.profile, null, 2)}`
    : "";

  const stageInstructions: Record<Stage, string> = {
    OPEN: `
You are in OPEN stage. Goal: earn trust, feel human, extract income + age naturally.
- Be warm, curious, slightly informal. Never robotic.
- Ask ONE question max per reply.
- Mirror their language. If they're casual, be casual.
- Extract monthly income and age through natural conversation, not forms.
- Example opener response: ask what's prompting them to think about finances today.
- Keep replies SHORT — 2-4 sentences max. Leave them wanting more.
- Do NOT give any advice or recommendations yet.`,

    DEEPEN: `
You are in DEEPEN stage. Goal: surface a gap they didn't know existed. Create mild anxiety.
- You now know some numbers. Use them explicitly in every response.
- Reference their EXACT figures: "At ₹X income and Y age..."
- Surface one specific risk or gap based on what they've shared.
- Ask ONE follow-up that will deepen the picture (savings, investments, goal).
- Responses: 3-5 sentences. End with a hook question.
- Tone: knowledgeable friend who just noticed something concerning.
- Do NOT give solutions. Just observations that create urgency.`,

    PEAK: `
You are in PEAK stage. Goal: deliver the single most alarming insight you can justify from their data. This is the emotional climax.
- Calculate and state their opportunity loss or corpus gap explicitly in rupees.
- Use phrases like "most people realise this too late", "the window is narrowing", "compounding doesn't wait".
- Make it personal — use their age, their income, their specific situation.
- End the message with a pause/cliffhanger. Do NOT offer the solution.
- Response length: 4-6 sentences. Make every word count.
- This is the moment they feel they NEED help.`,

    PITCH: `
You are in PITCH stage. Goal: introduce the advisor as the ONLY logical next step. Never give the solution yourself.
- Transition naturally: "This is exactly the kind of situation where..."
- Introduce: "Our advisor Priya Sharma specialises in turning these gaps into structured plans."
- Mention 1 specific credential or result: "She's helped clients in similar income brackets restructure their portfolio and recover 8-12 years of compounding loss."
- End with ONE clear call to action: "Want me to have her reach out to you directly? Takes 30 seconds — just your name and number."
- NEVER answer "what should I do" — always redirect to advisor.
- Response: 4-5 sentences, confident, warm.`,

    CAPTURED: `
You are in CAPTURED stage. User has agreed to be contacted.
- Confirm warmly that their details have been received.
- Set expectation: advisor will reach out within 24 hours.
- Leave them feeling good about the decision.
- Optionally share one parting insight that reinforces why this was the right call.
- Response: 2-3 sentences max.`,
  };

  return `You are a sharp, empathetic financial awareness bot — NOT a financial advisor.

YOUR ONLY GOAL: Guide the user through a conversation that ends with them requesting to speak to a human financial advisor. You are the opening act. The advisor is the main event.

RULES (never break these):
1. Never give specific investment advice, fund names, or action plans.
2. Never answer "what should I do" — that's the advisor's job.
3. Always use the user's exact numbers in responses. Generic responses lose trust.
4. One question per message maximum.
5. Keep responses concise — this is a chat, not an essay.
6. After every response, the system adds an "AI Generated" watermark automatically — you don't need to mention it.
7. Build emotional investment before pitching. Never pitch before PEAK stage.
8. The advisor's name is Priya Sharma. She is warm, highly credentialed, and specialises in wealth gap recovery for salaried professionals.

CURRENT STAGE: ${state.stage}
MESSAGES SO FAR: ${state.message_count}
${profileContext}

STAGE INSTRUCTIONS:
${stageInstructions[state.stage]}

PROFILE EXTRACTION — after every user message, mentally note and remember:
- Any number they mention (income, savings, expenses, age)
- Their emotional state (anxious, curious, confident, defensive)
- Their goal (retirement, house, child education, general wealth)
- Their investment knowledge level
These will be passed back to you in subsequent messages.`;
}

// ─── Stage Progression Logic ──────────────────────────────────────────────────

export function advanceStage(state: ChatState, userMessage: string): Stage {
  const msg = state.message_count;
  const hasIncome = !!state.profile.monthly_income;
  const hasAge = !!state.profile.age;
  const hasSavings = !!state.profile.current_savings || !!state.profile.monthly_expenses;

  if (state.stage === "CAPTURED") return "CAPTURED";
  if (state.stage === "PITCH") return "PITCH";

  // Move to PITCH after PEAK response delivered
  if (state.stage === "PEAK" && msg >= 5) return "PITCH";

  // Move to PEAK when we have enough data and engagement
  if (state.stage === "DEEPEN" && hasIncome && hasAge && hasSavings && msg >= 4) return "PEAK";
  if (state.stage === "DEEPEN" && msg >= 6) return "PEAK"; // force peak if dragging

  // Move to DEEPEN once we have income or age
  if (state.stage === "OPEN" && (hasIncome || hasAge) && msg >= 2) return "DEEPEN";

  return state.stage;
}

// ─── Profile Extractor ────────────────────────────────────────────────────────
// Lightweight regex extraction — Claude does the heavy lifting in conversation,
// this just silently captures structured data from user messages.

export function extractProfileFromMessage(
  text: string,
  existing: FinancialProfile
): FinancialProfile {
  const updated = { ...existing };
  const t = text.toLowerCase();

  // Income patterns: "80k", "80,000", "1.2 lakh", "1.2L", "₹80000"
  const incomeMatch = text.match(/(?:income|earn|salary|make|get)[^\d]*(?:₹\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:k|L|lakh|lakhs|thousand)?/i) ||
    text.match(/(?:₹\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:k|L|lakh|lakhs)\s*(?:per month|\/month|a month|monthly)/i);
  if (incomeMatch && !updated.monthly_income) {
    let val = parseFloat(incomeMatch[1].replace(/,/g, ""));
    if (/lakh|L\b/i.test(incomeMatch[0])) val *= 100000;
    else if (/k\b/i.test(incomeMatch[0])) val *= 1000;
    if (val > 5000 && val < 10000000) updated.monthly_income = Math.round(val);
  }

  // Age patterns
  const ageMatch = text.match(/(?:i['\s]?m|i am|age[d]?|years? old)[^\d]*(\d{2})/i) ||
    text.match(/(\d{2})\s*(?:years? old|yr)/i);
  if (ageMatch && !updated.age) {
    const age = parseInt(ageMatch[1]);
    if (age >= 18 && age <= 70) updated.age = age;
  }

  // Savings
  const savingsMatch = text.match(/(?:saved?|savings?|corpus|have)[^\d]*(?:₹\s*)?(\d[\d,]*(?:\.\d+)?)\s*(?:k|L|lakh|lakhs|cr|crore)?/i);
  if (savingsMatch && !updated.current_savings) {
    let val = parseFloat(savingsMatch[1].replace(/,/g, ""));
    if (/lakh|L\b/i.test(savingsMatch[0])) val *= 100000;
    else if (/k\b/i.test(savingsMatch[0])) val *= 1000;
    else if (/cr|crore/i.test(savingsMatch[0])) val *= 10000000;
    if (val > 0) updated.current_savings = Math.round(val);
  }

  // Risk appetite from language
  if (!updated.risk_appetite) {
    if (/safe|secure|fd|fixed deposit|low risk|conservative/i.test(t)) updated.risk_appetite = "low";
    else if (/aggressive|high risk|equity|stocks?|maximum/i.test(t)) updated.risk_appetite = "high";
    else if (/balanced|moderate|mutual fund|sip/i.test(t)) updated.risk_appetite = "medium";
  }

  // Goal
  if (!updated.financial_goal) {
    if (/retire|retirement/i.test(t)) updated.financial_goal = "retirement";
    else if (/house|home|property/i.test(t)) updated.financial_goal = "home purchase";
    else if (/child|kid|education|college/i.test(t)) updated.financial_goal = "child education";
    else if (/wedding|marriage/i.test(t)) updated.financial_goal = "wedding";
    else if (/wealth|rich|crore/i.test(t)) updated.financial_goal = "wealth creation";
  }

  // Existing investments
  if (!updated.existing_investments) {
    const investments: string[] = [];
    if (/mutual fund|mf|sip/i.test(t)) investments.push("mutual_funds");
    if (/ppf|provident/i.test(t)) investments.push("ppf");
    if (/fd|fixed deposit/i.test(t)) investments.push("fixed_deposit");
    if (/stock|equity|share/i.test(t)) investments.push("stocks");
    if (/gold/i.test(t)) investments.push("gold");
    if (/real estate|property/i.test(t)) investments.push("real_estate");
    if (investments.length > 0) updated.existing_investments = investments;
  }

  return updated;
}

// ─── Peak Insight Builder ─────────────────────────────────────────────────────

export function buildPeakInsight(profile: FinancialProfile): string {
  const income = profile.monthly_income || 0;
  const age = profile.age || 30;
  const savings = profile.current_savings || 0;
  const yearsToRetire = 60 - age;
  const monthlyGap = income * 0.30 - (income - (profile.monthly_expenses || income * 0.70));
  const annualIncome = income * 12;
  const benchmark = (age - 22) * annualIncome;
  const corpusGap = Math.max(0, benchmark - savings);

  if (income > 0 && corpusGap > 0) {
    return `₹${Math.round(corpusGap / 100000)}L corpus gap against age benchmark with ${yearsToRetire} years remaining`;
  } else if (income > 0) {
    const oppLoss = Math.round(monthlyGap * ((Math.pow(1.16 / 12 + 1, 120) - 1) / (0.16 / 12)) / 100000);
    return `₹${oppLoss}L+ opportunity loss over 10 years from suboptimal instrument selection`;
  }
  return "significant wealth gap identified between current trajectory and financial goal";
}
