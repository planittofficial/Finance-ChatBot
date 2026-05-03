'use strict';

/**
 * controllers/chatController.js
 * ──────────────────────────────
 * Orchestrates the full chatbot conversation lifecycle.
 * Handles all phases: collect → analyze → hook → advisor → freeform
 *
 * Each public method corresponds to an API route handler.
 */

const sessionStore    = require('../services/sessionStore');
const groqService     = require('../services/groq');
const financeService  = require('../services/finance');
const prompts         = require('../prompts/system');
const Lead            = require('../models/Lead');
const leadsController = require('./leadsController');

// -----------------------
// Conversational helpers
// -----------------------
function extractProfileFromMessage(text, existing) {
  const updated = Object.assign({}, existing || {});
  const t = String(text || '').toLowerCase();

  // Income patterns (rough)
  const incomeMatch = text.match(/(?:₹\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s*(lakh|lakhs|l|L|k|K|k\b))?(?:\s*(?:per month|\/month|a month|monthly))?/i);
  if (incomeMatch && !updated.income && !updated.monthly_income) {
    let val = parseFloat(incomeMatch[1].replace(/,/g, ''));
    const unit = (incomeMatch[2] || '').toLowerCase();
    if (unit.includes('l')) val *= 100000;
    else if (unit.includes('k')) val *= 1000;
    if (val > 1000 && val < 10000000) updated.monthly_income = Math.round(val);
  }

  // Age
  const ageMatch = text.match(/(\b\d{2}\b)\s*(?:years?|yrs?|yo|old)?/i);
  if (ageMatch && !updated.age) {
    const age = parseInt(ageMatch[1], 10);
    if (age >= 18 && age <= 80) updated.age = age;
  }

  // Savings
  const savingsMatch = text.match(/(?:savings|saved|have)[^\d]*(?:₹\s*)?(\d[\d,]*(?:\.\d+)?)(?:\s*(lakh|k|cr|crore))?/i);
  if (savingsMatch && !updated.savings && !updated.current_savings) {
    let val = parseFloat(savingsMatch[1].replace(/,/g, ''));
    const unit = (savingsMatch[2] || '').toLowerCase();
    if (unit.includes('l')) val *= 100000;
    else if (unit.includes('k')) val *= 1000;
    else if (unit.includes('cr') || unit.includes('crore')) val *= 10000000;
    if (val >= 0) updated.current_savings = Math.round(val);
  }

  // Risk appetite
  if (!updated.risk) {
    if (/low risk|conservative|safe|fd|fixed deposit/i.test(t)) updated.risk = 'conservative';
    else if (/aggressive|high risk|stocks|equity/i.test(t)) updated.risk = 'aggressive';
    else if (/balanced|moderate|sip|mutual fund/i.test(t)) updated.risk = 'moderate';
  }

  // Goal
  if (!updated.goal) {
    if (/retire|retirement/i.test(t)) updated.goal = 'retirement';
    else if (/house|home|property/i.test(t)) updated.goal = 'house';
    else if (/car|vehicle|bike|auto/i.test(t)) updated.goal = 'house';
    else if (/education|child|school|college/i.test(t)) updated.goal = 'education';
    else if (/wealth|crore|rich|invest more/i.test(t)) updated.goal = 'wealth';
  }

  // Time horizon (used for prompting and tone)
  if (!updated.time_horizon) {
    if (/short|next\s*5\s*years?|near\s*term|soon/i.test(t)) updated.time_horizon = 'short';
    else if (/long|long\s*term|later|future/i.test(t)) updated.time_horizon = 'long';
  }

  return updated;
}

function buildPeakInsight(profile) {
  const income = profile.monthly_income || profile.income || 0;
  const age = profile.age || 30;
  const savings = profile.current_savings || profile.savings || 0;
  const yearsToRetire = Math.max(10, 60 - age);
  const annualIncome = income * 12;
  const benchmark = Math.max(0, (age - 22) * annualIncome);
  const corpusGap = Math.max(0, benchmark - savings);

  if (income > 0 && corpusGap > 0) {
    const lacs = Math.round(corpusGap / 100000);
    return `At ${age}, with roughly ₹${Math.round(income).toLocaleString('en-IN')}/mo, the age benchmark suggests a corpus shortfall of about ₹${(lacs)}L. That's a meaningful gap.`;
  }

  if (income > 0) {
    return 'There appears to be an opportunity loss from not optimally allocating surplus — this can amount to several lakhs over 10 years.';
  }

  return 'There seems to be a significant wealth gap between trajectory and your likely goals.';
}

function advanceStage(session) {
  const s = session;
  const msgCount = s.message_count || 0;
  const hasIncome = !!(s.profile && (s.profile.monthly_income || s.profile.income));
  const hasAge = !!(s.profile && s.profile.age);
  const hasSavings = !!(s.profile && (s.profile.current_savings || s.profile.savings));

  if (s.phase === 'captured') return 'CAPTURED';
  if (s.stage === 'PITCH') return 'PITCH';

  if (hasIncome && hasAge && hasSavings && msgCount >= 4) return 'PEAK';
  if ((hasIncome && hasAge) && msgCount >= 3) return 'DEEPEN';
  if (msgCount <= 2) return 'OPEN';
  return 'DEEPEN';
}

function parseAmountINR(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (/not much|none|zero|no savings|nothing/i.test(t)) return 0;

  const m = t.match(/(\d[\d,]*(?:\.\d+)?)(?:\s*(k|l|lakh|lakhs|cr|crore))?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'k') n *= 1000;
  if (unit === 'l' || unit === 'lakh' || unit === 'lakhs') n *= 100000;
  if (unit === 'cr' || unit === 'crore') n *= 10000000;
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/**
 * Extract a simple contact (name + phone) from a free-form message.
 * Returns { name, phone } or null.
 */
function extractContactFromMessage(text) {
  if (!text) return null;
  const t = String(text).trim();

  // Phone: look for 10-digit Indian numbers (with optional +91 or 0)
  const phoneMatch = t.match(/(?:\+91[\-\s]?|0)?([6-9]\d{9})/);
  if (!phoneMatch) return null;
  const phone = phoneMatch[1];

  // Try to extract a nearby name. Look left of phone for 1-3 word name.
  const left = t.slice(0, phoneMatch.index).trim();
  let name = '';
  if (left) {
    // Take last 3 words from left part that look like a name
    const tokens = left.split(/\s+/).filter(Boolean);
    const candidates = tokens.slice(-3).join(' ');
    // simple cleanup: remove labels like 'name' or 'my'
    name = candidates.replace(/^(name[:\-\s]*|my\s+)/i, '').trim();
  }

  // If no left-side name, try phrasing like 'I'm John Doe' or 'I am John'
  if (!name) {
    const m = t.match(/(?:i\s+am|i'm|this is|name is)\s+([A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){0,2})/i);
    if (m) name = m[1].trim();
  }

  // Basic validation: ensure name has at least one alphabetic token
  if (!name || !/[A-Za-z]/.test(name)) return { name: '', phone };
  return { name, phone };
}


// ─── Collection Steps Definition ─────────────────────────────────────────────
const COLLECTION_STEPS = [
  {
    field:       'age',
    question:    "👋 Welcome! I'm FinanceAI — your personal wealth intelligence assistant.\n\nLet's start building your financial snapshot. **How old are you?**",
    reprompt:    "Just your age — a number between 18 and 80.",
    type:        'number',
    validate:    v => financeService.validateProfileField('age', v),
    parse:       v => parseFloat(v.replace(/[^\d.]/g, '')),
    hint:        'Enter your age (18–80)',
  },
  {
    field:       'income',
    question:    "💼 Got it! And what is your **monthly take-home income**? _(in ₹)_",
    reprompt:    "Your net monthly salary or business income in ₹ — e.g. 75000",
    type:        'number',
    validate:    v => financeService.validateProfileField('income', v),
    parse:       v => parseFloat(v.replace(/[^\d.]/g, '')),
    hint:        'Monthly income in ₹',
  },
  {
    field:       'expenses',
    question:    "🏠 Now your **monthly expenses** — rent, food, EMIs, subscriptions, bills — everything. _(in ₹)_",
    reprompt:    "Total monthly outgoings in ₹ — include all regular expenses.",
    type:        'number',
    validate:    v => financeService.validateProfileField('expenses', v),
    parse:       v => parseFloat(v.replace(/[^\d.]/g, '')),
    hint:        'Monthly expenses in ₹',
  },
  {
    field:       'savings',
    question:    "🏦 What are your **total current savings**? _(bank balance, FDs, liquid funds — in ₹)_",
    reprompt:    "Total liquid savings in ₹ — this can be 0 if you're starting fresh.",
    type:        'number',
    validate:    v => financeService.validateProfileField('savings', v),
    parse:       v => parseFloat(v.replace(/[^\d.]/g, '')),
    hint:        'Total savings in ₹',
  },
  {
    field:       'risk',
    question:    "📊 How would you describe your **investment risk appetite**?",
    reprompt:    "Please choose one: conservative, moderate, or aggressive.",
    type:        'choice',
    choices:     ['conservative', 'moderate', 'aggressive'],
    validate:    v => financeService.validateProfileField('risk', v),
    parse:       v => v.trim().toLowerCase(),
    hint:        'conservative / moderate / aggressive',
    display:     { conservative: '🛡️ Conservative', moderate: '⚖️ Moderate', aggressive: '🚀 Aggressive' },
  },
  {
    field:       'goal',
    question:    "🎯 Last one — what is your **primary financial goal**?",
    reprompt:    "Choose one: retirement, house, wealth, or education.",
    type:        'choice',
    choices:     ['retirement', 'house', 'wealth', 'education'],
    validate:    v => financeService.validateProfileField('goal', v),
    parse:       v => v.trim().toLowerCase(),
    hint:        'retirement / house / wealth / education',
    display:     { retirement: '🏖️ Early Retirement', house: '🏠 Buy a House', wealth: '📈 Grow Wealth', education: '🎓 Child\'s Education' },
  },
];

// ─── Utility: format a profile field's value for display ─────────────────────
function displayValue(step, parsed) {
  if (step.display) return step.display[parsed] || parsed;
  if (step.field === 'age') return `${parsed} years old`;
  if (['income', 'expenses', 'savings'].includes(step.field)) return `₹${financeService.formatINR(parsed)}/month`;
  return String(parsed);
}

// ─── Off-topic detection ──────────────────────────────────────────────────────
async function isOffTopic(message, phase) {
  // Only run classifier in collect phase — other phases are more forgiving
  if (phase !== 'collect') return false;

  // Quick string heuristics first (fast path, no API call)
  const lower = message.toLowerCase();
  const financeKeywords = [
    'income','salary','expense','saving','invest','sip','mutual','fund','stock','tax','emi',
    'loan','retire','wealth','budget','asset','debt','insurance','fd','ppf','nps','elss','mf','portfolio',
    'conservative','moderate','aggressive','education','house'
  ];
  if (financeKeywords.some(kw => lower.includes(kw))) return false;

  // Only call Groq classifier for ambiguous messages over 5 chars
  if (message.trim().length <= 5) return false;

  try {
    const raw = await groqService.chat([
      { role: 'system', content: prompts.OFFTOPIC_CLASSIFIER },
      { role: 'user', content: message },
    ], { temperature: 0.1, maxTokens: 100, jsonMode: true });

    const result = JSON.parse(raw);
    return result.is_financial === false;
  } catch {
    return false; // On error, assume it's financial (don't block users)
  }
}

// ─── POST /api/chat/start ─────────────────────────────────────────────────────
async function startSession(req, res) {
  try {
    const { userId, name } = req.body;
    const session = sessionStore.createNewSession(userId, name);

    // Conversational opener — friendly, human tone
    const firstQuestion = "Hey — what's got you thinking about money today?";
    sessionStore.addMessage(session.id, 'assistant', firstQuestion);

    return res.json({
      sessionId: session.id,
      message:   firstQuestion,
      phase:     'collect',
      step:      null,
      progress:  0,
      insight:   generateSimpleInsight(session, { message: firstQuestion, phase: 'collect' }),
      suggestedQuestions: generateSuggestedQuestions(session),
      visual:    makeVisualData(session, { message: firstQuestion, phase: 'collect' }),
      summaryLine: buildProfileSummaryLine(session),
      hookLine: buildHookLine(session, { message: firstQuestion, phase: 'collect' }),
    });
  } catch (err) {
    console.error('[startSession]', err);
    return res.status(500).json({ error: 'Failed to start session. Please try again.' });
  }
}

// ─── POST /api/chat/message ───────────────────────────────────────────────────
async function handleMessage(req, res) {
  const { sessionId, message } = req.body;

  // ── Validation ─────────────────────────────────────────────────────────────
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'sessionId is required.' });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message cannot be empty.' });
  }

  const session = sessionStore.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session expired or not found. Please start a new conversation.', code: 'SESSION_EXPIRED' });
  }

  const userMessage = message.trim();
  sessionStore.addMessage(sessionId, 'user', userMessage);

  try {
    let response;

    switch (session.phase) {
      case 'collect':
        response = await handleCollectPhase(session, userMessage);
        break;
      case 'analyze':
        response = { message: "⏳ Still generating your analysis — hang tight!", phase: 'analyze' };
        break;
      case 'hook':
      case 'freeform':
      case 'advisor':
        response = await handleFreeformPhase(session, userMessage);
        break;
      default:
        response = { message: "I'm ready to help with your financial questions. What would you like to know?", phase: session.phase };
    }

    // Enrich response with simple insight, suggested questions, and a small visual payload
    try {
      response.insight = generateSimpleInsight(session, response);
      response.suggestedQuestions = generateSuggestedQuestions(session);
      response.visual = makeVisualData(session, response);
      response.summaryLine = buildProfileSummaryLine(session);
      response.hookLine = buildHookLine(session, response);
    } catch (e) {
      console.warn('[response-enrich]', e && e.message);
    }

    sessionStore.addMessage(sessionId, 'assistant', response.message);
    return res.json({ sessionId, ...response });

  } catch (err) {
    console.error('[handleMessage]', err.message);
    const fallback = "I'm having a brief connectivity issue. Could you please repeat that?";
    return res.json({ sessionId, message: fallback, phase: session.phase, error: true });
  }
}

// ─── Response enrichment helpers ───────────────────────────────────────────
function generateSimpleInsight(session, responseObj) {
  try {
    const profile = session.profile || {};
    const income = profile.monthly_income || profile.income || 0;
    const expenses = profile.expenses;

    // Prefer server-provided analysis if present; avoid computing projections on incomplete profiles.
    const analysis = responseObj.analysis || session.analysis || null;
    const investable = (analysis && Number.isFinite(analysis.investable_amount)) ? analysis.investable_amount : null;

    if (income && investable !== null) {
      return `Quick insight: with ₹${financeService.formatINR(income)}/mo you could invest about ₹${financeService.formatINR(investable)}/mo.`;
    }
    if (income && Number.isFinite(expenses)) {
      const surplus = Math.max(0, Math.round(income - expenses));
      return `Quick insight: your rough monthly surplus looks like ~₹${financeService.formatINR(surplus)} (income − expenses).`;
    }
    if (income) {
      return `Quick insight: once I know your expenses, I can estimate how much of your ₹${financeService.formatINR(income)}/mo can be invested.`;
    }
    return 'Quick insight: share just one number (income) and I’ll show a quick baseline instantly.';
  } catch (e) {
    return 'Quick insight: saving and investing a bit more each month compounds significantly over years.';
  }
}

function generateSuggestedQuestions(session) {
  const profile = session.profile || {};
  const goal = profile.goal || 'wealth';
  const income = profile.monthly_income || profile.income;
  const suggestions = [
    'Show my quick snapshot',
    'Show a 5-year projection',
    'How much can I invest monthly?',
    `Give me 3 quick wins for ${goal}`,
    'What should I do this month?',
    'Connect me with advisor Piyush',
  ];

  // If user hasn’t shared income yet, add a prompt that still “works” (asks for baseline)
  if (!income) {
    suggestions.unshift('I earn 50k/month — show my baseline');
  }

  // Keep it short to reduce UI space
  return Array.from(new Set(suggestions)).slice(0, 5);
}

function buildProfileSummaryLine(session) {
  const p = (session && session.profile) ? session.profile : {};
  const parts = [];
  if (p.age) parts.push(`${p.age}y`);
  const income = p.monthly_income || p.income;
  if (income) parts.push(`₹${financeService.formatINR(income)}/mo`);
  if (p.goal) parts.push(`goal: ${p.goal}`);
  if (p.risk) parts.push(`risk: ${p.risk}`);
  return parts.length ? `You: ${parts.join(' • ')}` : 'You: add income to see your potential.';
}

function buildHookLine(session, responseObj) {
  const profile = session.profile || {};
  const income = profile.monthly_income || profile.income || 0;
  const analysis = responseObj.analysis || session.analysis || null;

  if (analysis && analysis.projections && Number.isFinite(analysis.projections.optimized_5yr) && Number.isFinite(analysis.investable_amount)) {
    return `Hook: a 30‑min plan with Piyush can help you turn ~₹${financeService.formatINR(analysis.investable_amount)}/mo into ${financeService.formatCrLakh(analysis.projections.optimized_5yr)} in 5 years.`;
  }
  if (income) {
    return 'Hook: share expenses + savings and I’ll quantify your 5‑year wealth potential (then Piyush can validate the plan).';
  }
  return 'Hook: share your monthly income to see a baseline instantly.';
}

function makeVisualData(session, responseObj) {
  const profile = session.profile || {};
  const income = profile.monthly_income || profile.income || 0;
  const expenses = profile.expenses || 0;
  const savings = profile.current_savings || profile.savings || 0;

  // Only compute projections when we at least have income; otherwise keep it simple.
  let analysis = responseObj.analysis || session.analysis || null;
  if (!analysis && income) {
    try {
      const safeProfile = {
        age: profile.age || 30,
        income: income,
        expenses: profile.expenses || Math.round(income * 0.7),
        savings: profile.current_savings || profile.savings || 0,
        risk: profile.risk || 'moderate',
        goal: profile.goal || 'wealth',
      };
      analysis = financeService.generateProjections(safeProfile);
    } catch (e) {
      analysis = null;
    }
  }

  const investable = (analysis && Number.isFinite(analysis.investable_amount))
    ? analysis.investable_amount
    : Math.max(0, Math.round((income || 0) - (expenses || 0)));

  const projection = (analysis && analysis.projections && Number.isFinite(analysis.projections.current_5yr) && Number.isFinite(analysis.projections.optimized_5yr))
    ? {
        labels: ['Current (5y)', 'Optimized (5y)'],
        values: [analysis.projections.current_5yr, analysis.projections.optimized_5yr],
        formatted: {
          'Current (5y)': financeService.formatCrLakh(analysis.projections.current_5yr),
          'Optimized (5y)': financeService.formatCrLakh(analysis.projections.optimized_5yr),
        }
      }
    : null;

  return {
    kind: 'simple_bar', // UI can interpret this
    labels: ['Income', 'Expenses', 'Savings', 'Investable'],
    values: [income, expenses, savings, investable],
    formatted: {
      Income: `₹${financeService.formatINR(income)}`,
      Expenses: `₹${financeService.formatINR(expenses)}`,
      Savings: `₹${financeService.formatINR(savings)}`,
      Investable: `₹${financeService.formatINR(investable)}`,
    },
    projection,
  };
}

// ─── Collection Phase Logic ───────────────────────────────────────────────────
async function handleCollectPhase(session, userMessage) {
  // Increment message counter
  session.message_count = (session.message_count || 0) + 1;

  // Skip off-topic detection while waiting for short factual replies
  const skipOfftopic = ['awaiting_expenses_or_savings','awaiting_savings_value','awaiting_expenses_value','awaiting_age_and_goal','awaiting_investments'].includes(session.flowStage);
  const offTopic = skipOfftopic ? false : await isOffTopic(userMessage, session.phase);
  if (offTopic) {
    return {
      message: `That's a bit outside my lane! 😊 I'm focused on helping you with your finances right now.\n\nCan you tell me a bit about your money concern?`,
      phase: 'collect',
      step: null,
      progress: Math.round((Object.keys(session.profile || {}).length / 5) * 100),
    };
  }

  // Silently extract structured data from user's natural message
  session.profile = extractProfileFromMessage(userMessage, session.profile || {});
  if (session.profile.monthly_income && !session.profile.income) session.profile.income = session.profile.monthly_income;
  if (session.profile.current_savings !== undefined && session.profile.current_savings !== null && (session.profile.savings === null || session.profile.savings === undefined)) {
    session.profile.savings = session.profile.current_savings;
  }
  sessionStore.updateSession(session.id, { profile: session.profile, message_count: session.message_count });

  // Decide stage
  const stage = advanceStage(session);

  // Progress indicator (simple ratio of extracted fields)
  const keys = ['age','monthly_income','current_savings','risk','goal'];
  const found = keys.reduce((n,k) => n + (session.profile && (session.profile[k] || session.profile[k] === 0) ? 1 : 0), 0);
  const progress = Math.round((found / keys.length) * 100);

  // OPEN: friendly, human follow-up (asks about duration/emotion)
  // Handle inverted 'income-first' flow using flowStage
  // If no flow started and we just received income, provide immediate partial analysis
  if (!session.flowStage) {
    const incomeVal = session.profile.income || session.profile.monthly_income;
    if (incomeVal && !session.baselineShown) {
      // initialize profile for calculation with sensible defaults
      const income = Math.round(incomeVal);
      const partialProfile = {
        age:    session.profile.age || 30,
        income: income,
        expenses: Math.round(income * 0.7),
        savings: session.profile.current_savings || session.profile.savings || 0,
        risk: session.profile.risk || 'moderate',
        goal: session.profile.goal || 'wealth',
      };
      const analysis = financeService.generateProjections(partialProfile);
      sessionStore.updateSession(session.id, { profile: Object.assign({}, session.profile, { income }), flowStage: 'awaiting_expenses_or_savings', baselineShown: true });

      const msg = `Based on ₹${financeService.formatINR(income)}/month, here's a quick baseline:\n` +
        `• Investable today: ₹${financeService.formatINR(analysis.investable_amount)}/month\n` +
        `• Optimized (5yr): ${financeService.formatCrLakh(analysis.projections.optimized_5yr)}\n` +
        `• Estimated gap: ${financeService.formatCrLakh(analysis.wealth_gap)}\n\n` +
        `3 gaps detected — answer these to sharpen the picture:\n` +
        `1) Expenses or savings? (reply with a number or say 'expenses' / 'savings')\n` +
        `2) Your age + time-horizon (short vs long)\n` +
        `3) What's already working for you (investments)\n\n` +
        `Which would you like to tell me first?\n` +
        `Examples: "expenses 20k", "saved 1.2L", "age 24, long term"`;

      return { message: msg, phase: 'collect', step: null, progress: Math.min(20, progress) };
    }
  }

  // If we're in a flow, branch by flowStage
  if (session.flowStage === 'awaiting_expenses_or_savings') {
    const text = userMessage.toLowerCase();
    const amount = parseAmountINR(userMessage);
    // If user said 'savings' ask for amount
    if (/save|savings|saved/.test(text) && amount === null) {
      sessionStore.updateSession(session.id, { flowStage: 'awaiting_savings_value' });
      return { message: "Great — roughly how much have you saved so far? (₹)\nExamples: '1.2L', '80000', 'not much'", phase: 'collect', step: null, progress };
    }
    // If user said 'expenses' ask for amount
    if (/expense|expenses|spend|spent/.test(text) && amount === null) {
      sessionStore.updateSession(session.id, { flowStage: 'awaiting_expenses_value' });
      return { message: "Okay — what's your total monthly expenses (rent, EMIs, bills)? (₹)\nExamples: '20k', '35000'", phase: 'collect', step: null, progress };
    }
    // If user provided a number, assume it's expenses (common path)
    if (amount !== null) {
      const val = amount;
      // Heuristic: if number is > income treat as savings? but usually expenses <= income
      session.profile.expenses = val;
      sessionStore.updateSession(session.id, { profile: session.profile, flowStage: 'awaiting_age_and_goal' });

      // Recalculate partial analysis
      const income = session.profile.monthly_income || session.profile.income || 0;
      const p = {
        age: session.profile.age || 30,
        income: income,
        expenses: session.profile.expenses,
        savings: session.profile.current_savings || session.profile.savings || 0,
        risk: session.profile.risk || 'moderate',
        goal: session.profile.goal || 'wealth',
      };
      const analysis = financeService.generateProjections(p);
      const msg = `Nice — recorded monthly expenses of ₹${financeService.formatINR(val)}. Updated snapshot:\n` +
        `• Investable now: ₹${financeService.formatINR(analysis.investable_amount)}/month\n` +
        `• Optimized (5yr): ${financeService.formatCrLakh(analysis.projections.optimized_5yr)}\n` +
        `Next: tell me your age and your focus (short-term vs long-term).\n` +
        `Examples: "22 short term", "age 30 long term"`;
      return { message: msg, phase: 'collect', step: null, progress: Math.min(50, progress) };
    }
  }

  if (session.flowStage === 'awaiting_savings_value' || session.flowStage === 'awaiting_expenses_value') {
    const amount = parseAmountINR(userMessage);
    if (amount !== null) {
      const val = amount;
      if (session.flowStage === 'awaiting_savings_value') session.profile.current_savings = val;
      else session.profile.expenses = val;
      if (session.profile.current_savings !== undefined && session.profile.current_savings !== null) session.profile.savings = session.profile.current_savings;
      sessionStore.updateSession(session.id, { profile: session.profile, flowStage: 'awaiting_age_and_goal' });

      const income = session.profile.monthly_income || session.profile.income || 0;
      const p = {
        age: session.profile.age || 30,
        income: income,
        expenses: session.profile.expenses || Math.round(income * 0.7),
        savings: session.profile.current_savings || session.profile.savings || 0,
        risk: session.profile.risk || 'moderate',
        goal: session.profile.goal || 'wealth',
      };
      const analysis = financeService.generateProjections(p);
      const msg = `Thanks — updated. Here's the improved view:\n` +
        `• Investable: ₹${financeService.formatINR(analysis.investable_amount)}/month\n` +
        `• Optimized (5yr): ${financeService.formatCrLakh(analysis.projections.optimized_5yr)}\n` +
        `Next: tell me your age and your focus (short-term vs long-term).\n` +
        `Examples: "22 short term", "age 30 long term"`;
      return { message: msg, phase: 'collect', step: null, progress: Math.min(60, progress) };
    }
    return { message: "Share a number (e.g. 1.2L, 120000, or 'not much').", phase: 'collect', step: null, progress };
  }

  if (session.flowStage === 'awaiting_age_and_goal') {
    // try to extract age and goal from message
    session.profile = extractProfileFromMessage(userMessage, session.profile || {});
    sessionStore.updateSession(session.id, { profile: session.profile });

    const hasAge = !!session.profile.age;
    const hasGoal = !!session.profile.goal;
    const hasHorizon = !!session.profile.time_horizon;

    // Ask only what is missing to avoid loops
    if (!hasAge && (!hasGoal || !hasHorizon)) {
      return { message: "Got it. I still need 2 quick bits: your age and whether this is short-term or long-term.\nExamples: '22 short term', '35 long term retirement'", phase: 'collect', step: null, progress: Math.min(70, progress) };
    }
    if (!hasAge) {
      return { message: "Got your goal. What's your age?\nExamples: '22', 'age 34'", phase: 'collect', step: null, progress: Math.min(70, progress) };
    }
    if (!hasGoal) {
      return { message: "Got your age. What's the primary goal right now?\nExamples: 'wealth creation', 'buy house', 'car in 3 years', 'retirement'", phase: 'collect', step: null, progress: Math.min(70, progress) };
    }
    if (!hasHorizon) {
      return { message: "And is this a short-term target (next 5 years) or a longer game?\nExamples: 'short term', 'long term'", phase: 'collect', step: null, progress: Math.min(75, progress) };
    }

    // Move to investments probe
    sessionStore.updateSession(session.id, { flowStage: 'awaiting_investments' });
    const income = session.profile.monthly_income || session.profile.income || 0;
    const p = {
      age: session.profile.age,
      income: income,
      expenses: session.profile.expenses || Math.round(income * 0.7),
      savings: session.profile.current_savings || session.profile.savings || 0,
      risk: session.profile.risk || 'moderate',
      goal: session.profile.goal || 'wealth',
    };
    const analysis = financeService.generateProjections(p);
    const msg = `Great — at ${session.profile.age}, here's the updated picture:\n` +
      `• Investable: ₹${financeService.formatINR(analysis.investable_amount)}/month\n` +
      `• Optimized (5yr): ${financeService.formatCrLakh(analysis.projections.optimized_5yr)}\n` +
      `What's already working for you? (Any SIPs, FDs, PPF, stocks — just a short note)\n` +
      `Examples: 'SIP 5k + PPF', 'FD only', 'nothing yet'`;
    return { message: msg, phase: 'collect', step: null, progress: 80 };
  }

  if (session.flowStage === 'awaiting_investments') {
    // Save freeform investments text
    session.profile.existing_investments_text = userMessage;
    sessionStore.updateSession(session.id, { profile: session.profile });

    // Finalise analysis and move to 'hook'
    const income = session.profile.monthly_income || session.profile.income || 0;
    const p = {
      age: session.profile.age || 30,
      income: income,
      expenses: session.profile.expenses || Math.round(income * 0.7),
      savings: session.profile.current_savings || session.profile.savings || 0,
      risk: session.profile.risk || 'moderate',
      goal: session.profile.goal || 'wealth',
    };
    const analysis = financeService.generateProjections(p);
    sessionStore.updateSession(session.id, { analysis, phase: 'hook' });
    const peak = buildPeakInsight(p);
    session.peak_insight = peak;

    const msg = `All set — here's your personalised snapshot:\n` +
      `• Investable: ₹${financeService.formatINR(analysis.investable_amount)}/month\n` +
      `• Optimized (5yr): ${financeService.formatCrLakh(analysis.projections.optimized_5yr)}\n` +
      `\n${peak}\n\nI can connect you with Piyush Tembhekar who can build a plan for this. Want me to have him reach out?`;
    return { message: msg, phase: 'hook', step: null, progress: 100, show_advisor_card: true };
  }

  // Deterministic non-repetitive fallback prompts
  if (!session.profile.income) {
    return { message: 'Let me personalise this instantly — what is your monthly take-home income?\nExamples: "50k", "80000"', phase: 'collect', step: null, progress };
  }
  if (!session.profile.expenses && session.profile.expenses !== 0) {
    sessionStore.updateSession(session.id, { flowStage: 'awaiting_expenses_value' });
    return { message: "Quick one: what's your monthly expenses total?\nExamples: '20k', '35000'", phase: 'collect', step: null, progress };
  }
  if (!session.profile.age) {
    return { message: 'And your age?\nExamples: "22", "age 31"', phase: 'collect', step: null, progress };
  }
  if (!session.profile.goal) {
    return { message: 'Primary goal: wealth, retirement, house, or education?\nExamples: "wealth creation", "car in 3 years", "retirement"', phase: 'collect', step: null, progress };
  }
  sessionStore.updateSession(session.id, { flowStage: 'awaiting_investments' });
  return { message: "What’s already working for you right now (SIP, FD, PPF, stocks)?\nExamples: 'SIP 5k', 'FD only', 'nothing yet'", phase: 'collect', step: null, progress };
}

// ─── Trigger Analysis ─────────────────────────────────────────────────────────
async function triggerAnalysis(session) {
  // Set phase to analyzing
  sessionStore.updateSession(session.id, { phase: 'analyze' });

  // Run Groq analysis (or fallback)
  let analysis;
  try {
    const messages = [
      { role: 'system', content: prompts.ANALYSIS_PROMPT },
      { role: 'user', content: prompts.buildAnalysisUserMessage(session.profile) },
    ];
    analysis = await groqService.chatJSON(messages, {
      temperature: parseFloat(process.env.GROQ_ANALYSIS_TEMPERATURE) || 0.3,
      maxTokens:   1400,
    });
    console.log(`[Analysis] Groq analysis generated for session ${session.id}`);
  } catch (err) {
    console.warn(`[Analysis] Groq failed (${err.message}), using local calculations`);
    analysis = financeService.generateProjections(session.profile);
  }

  // Validate and sanitise the analysis
  analysis = sanitiseAnalysis(analysis, session.profile);

  // Store analysis, update phase
  sessionStore.updateSession(session.id, { analysis, phase: 'hook' });

  // Save to MongoDB
  try {
    if (process.env.MONGODB_URI) {
      await Lead.create({
        sessionId: session.id,
        userId: session.userId,
        name: session.name,
        profile: session.profile,
        analysis: analysis,
        status: 'completed',
      });
      console.log(`[Database] Lead saved for session ${session.id}`);
    }
  } catch (dbErr) {
    console.error(`[Database ERROR] Failed to save lead for session ${session.id}:`, dbErr.message);
  }

  const profileContext = prompts.buildProfileContext(session.profile);
  console.log(`[Analysis] Session ${session.id} → phase: hook`);

  return {
    message:  `✅ Analysis complete! I've mapped out your complete financial picture, ${session.profile.age}-year-old powerhouse. Here's what the numbers say:`,
    phase:    'hook',
    analysis,
    profile:  session.profile,
    progress: 100,
  };
}

// ─── Freeform Phase Logic ─────────────────────────────────────────────────────
async function handleFreeformPhase(session, userMessage) {
  const profileContext = prompts.buildProfileContext(session.profile);
  const systemPrompt = prompts.CHAT_PROMPT
    .replace('{{PROFILE_CONTEXT}}', profileContext)
    .replace('{{GOAL}}', session.profile.goal || 'wealth');

  // Off-topic check for freeform too
  const offTopic = await isOffTopic(userMessage, 'freeform');
  if (offTopic) {
    return {
      message: `Ha, I appreciate the curiosity! But I'm at my best when talking about your money. 💰\n\nWas there something specific about your financial plan you wanted to explore?`,
      phase:   session.phase,
    };
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...session.history.slice(-12), // Last 12 messages for context
  ];

  let botMessage;
  try {
    botMessage = await groqService.chat(messages, {
      temperature: parseFloat(process.env.GROQ_CHAT_TEMPERATURE) || 0.65,
      maxTokens:   320,
    });
  } catch (err) {
    console.error('[freeform]', err.message);
    botMessage = "I had a brief connectivity issue. Based on your profile, I'd strongly recommend scheduling a session with your financial advisor to discuss this in detail.";
  }

  // If the user provided name + phone in freeform text, save the lead immediately
  try {
    const contact = extractContactFromMessage(userMessage);
    if (contact && contact.phone) {
      // If name is empty, try to use session name or fallback
      const leadName = contact.name || session.name || '';
      const leadObj = {
        name: leadName,
        phone: contact.phone,
        financial_profile: session.profile || {},
        conversation_summary: session.conversation_summary || '',
        peak_insight: session.peak_insight || '',
        chat_transcript: session.history || [],
      };

      const saved = leadsController.saveLeadObject(leadObj);
      // Also persist to MongoDB if configured
      if (process.env.MONGODB_URI) {
        try {
          await Lead.create({
            sessionId: session.id,
            userId: session.userId,
            name: saved.name,
            profile: saved.financial_profile,
            analysis: session.analysis || null,
            status: 'captured',
          });
        } catch (e) { /* ignore db errors */ }
      }

      // Mark session captured
      sessionStore.updateSession(session.id, { phase: 'captured' });
      const conf = `✅ Done — thanks ${saved.name || ''}! Piyush will reach out within 24 hours. He already has everything we discussed.`;
      return { message: conf, phase: 'captured' };
    }
  } catch (e) {
    console.error('[lead-save]', e && e.message);
  }

  // Update phase to advisor if user accepted the plan
  const acceptPhrases = ['yes', 'show me', 'connect me', 'book', 'yes please', 'absolutely', 'sure', 'let\'s do it', 'sign me up'];
  if (session.phase === 'hook' && acceptPhrases.some(p => userMessage.toLowerCase().includes(p))) {
    sessionStore.updateSession(session.id, { phase: 'advisor' });
    
    // Update Lead status in DB to indicate strong intent
    try {
      if (process.env.MONGODB_URI) {
        await Lead.updateOne({ sessionId: session.id }, { status: 'advisor_requested' });
      }
    } catch (e) {}
  }

  return {
    message: botMessage,
    phase:   session.phase,
  };
}

// ─── POST /api/chat/analyze ───────────────────────────────────────────────────
/** Direct endpoint to force analysis (useful for testing and UI skip-to-result). */
async function forceAnalyze(req, res) {
  const { sessionId } = req.body;
  const session = sessionStore.getSession(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (!financeService.isProfileComplete(session.profile)) {
    return res.status(400).json({ error: 'Profile incomplete', missingFields: getMissingFields(session.profile) });
  }

  try {
    const result = await triggerAnalysis(session);
    return res.json({ sessionId, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ─── GET /api/chat/session/:id ────────────────────────────────────────────────
function getSessionState(req, res) {
  const session = sessionStore.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });

  return res.json({
    sessionId: session.id,
    phase:     session.phase,
    profile:   session.profile,
    analysis:  session.analysis,
    step:      session.currentStep < COLLECTION_STEPS.length ? buildStepMeta(session.currentStep) : null,
    progress:  Math.round((session.currentStep / COLLECTION_STEPS.length) * 100),
    history:   session.history,
  });
}

// ─── DELETE /api/chat/session/:id ────────────────────────────────────────────
function deleteSessionHandler(req, res) {
  sessionStore.deleteSession(req.params.id);
  return res.json({ success: true });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildStepMeta(stepIndex) {
  const step = COLLECTION_STEPS[stepIndex];
  if (!step) return null;
  return {
    index:   stepIndex,
    total:   COLLECTION_STEPS.length,
    field:   step.field,
    hint:    step.hint,
    type:    step.type,
    choices: step.choices || null,
    display: step.display || null,
  };
}

function getMissingFields(profile) {
  return ['age', 'income', 'expenses', 'savings', 'risk', 'goal'].filter(f => !profile[f]);
}

/** Sanitise Groq analysis output — ensure all numbers are positive and present. */
function sanitiseAnalysis(analysis, profile) {
  // Run local calculations as a reference
  const local = financeService.generateProjections(profile);

  // Ensure projections exist and are positive numbers
  if (!analysis.projections || typeof analysis.projections !== 'object') {
    analysis.projections = local.projections;
  } else {
    for (const key of Object.keys(local.projections)) {
      const v = analysis.projections[key];
      if (!Number.isFinite(v) || v < 0) {
        analysis.projections[key] = local.projections[key];
      }
    }
  }

  // Ensure all top-level fields
  const defaults = {
    wealth_gap:           local.wealth_gap,
    hook_line:            local.hook_line,
    monthly_surplus:      local.monthly_surplus,
    investable_amount:    local.investable_amount,
    retirement_shortfall: local.retirement_shortfall,
    goal_timeline_years:  local.goal_timeline_years,
    key_risk:             local.key_risk,
    quick_wins:           local.quick_wins,
  };

  for (const [key, fallback] of Object.entries(defaults)) {
    if (!analysis[key] || (typeof analysis[key] === 'number' && !Number.isFinite(analysis[key]))) {
      analysis[key] = fallback;
    }
  }

  // Ensure insights array has 3 valid entries
  if (!Array.isArray(analysis.insights) || analysis.insights.length < 3) {
    analysis.insights = local.insights;
  }

  // Ensure quick_wins is an array
  if (!Array.isArray(analysis.quick_wins)) {
    analysis.quick_wins = local.quick_wins;
  }

  return analysis;
}

module.exports = {
  startSession,
  handleMessage,
  forceAnalyze,
  getSessionState,
  deleteSessionHandler,
};
