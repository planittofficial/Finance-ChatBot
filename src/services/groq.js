'use strict';

/**
 * services/groq.js
 * ─────────────────
 * Thin wrapper around the Groq SDK.
 * All API calls go through this module — never call Groq directly elsewhere.
 */

const Groq = require('groq-sdk');

let _groqClient = null;

function getClient() {
  if (!_groqClient) {
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'gsk_your_api_key_here') {
      throw new Error('GROQ_API_KEY is not set in your .env file. Get a free key at https://console.groq.com');
    }
    _groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groqClient;
}

const DEFAULT_MODEL = () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

/**
 * Standard chat completion (non-streaming).
 * @param {Array}  messages        - OpenAI-format message array
 * @param {Object} [opts]          - Optional overrides
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxTokens]
 * @param {boolean}[opts.jsonMode]  - Forces JSON output mode
 * @returns {Promise<string>}       - The assistant's text response
 */
async function chat(messages, opts = {}) {
  const client = getClient();
  const {
    temperature = parseFloat(process.env.GROQ_CHAT_TEMPERATURE) || 0.65,
    maxTokens   = 512,
    jsonMode    = false,
  } = opts;

  const params = {
    model:       DEFAULT_MODEL(),
    messages,
    temperature,
    max_tokens:  maxTokens,
  };

  if (jsonMode) {
    params.response_format = { type: 'json_object' };
  }

  const completion = await client.chat.completions.create(params);
  return completion.choices[0].message.content.trim();
}

/**
 * Streaming chat completion — yields text chunks via async generator.
 * @param {Array}  messages
 * @param {Object} [opts]
 * @yields {string} chunk of text
 */
async function* chatStream(messages, opts = {}) {
  const client = getClient();
  const {
    temperature = parseFloat(process.env.GROQ_CHAT_TEMPERATURE) || 0.65,
    maxTokens   = 512,
  } = opts;

  const stream = await client.chat.completions.create({
    model:       DEFAULT_MODEL(),
    messages,
    temperature,
    max_tokens:  maxTokens,
    stream:      true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
}

/**
 * Structured JSON completion (used for financial analysis).
 * Automatically uses lower temperature and JSON mode.
 * Validates the response is parseable JSON before returning.
 * @param {Array}   messages
 * @param {Object}  [opts]
 * @returns {Promise<Object>} Parsed JSON object
 */
async function chatJSON(messages, opts = {}) {
  const {
    temperature = parseFloat(process.env.GROQ_ANALYSIS_TEMPERATURE) || 0.3,
    maxTokens   = 1200,
  } = opts;

  const raw = await chat(messages, { temperature, maxTokens, jsonMode: true });

  // Strip any accidental markdown fences
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Groq returned invalid JSON: ${e.message}\n\nRaw response (first 200 chars): ${cleaned.slice(0, 200)}`);
  }
}

module.exports = { chat, chatStream, chatJSON };
