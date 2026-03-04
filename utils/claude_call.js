"use strict";
/**
 * utils/claude_call.js
 * Rate-limit-aware wrapper for Anthropic API calls.
 * Automatically retries on 429 with the correct wait time.
 */

const Anthropic = require("@anthropic-ai/sdk");
const client = new Anthropic();

const MAX_RETRIES = 5;

/**
 * Call Claude with automatic 429 retry + exponential backoff.
 * Drop-in replacement for client.messages.create().
 */
async function claudeCall(params, context) {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      const status = err.status || err.response?.status;

      if (status === 429) {
        attempt++;

        // Try to parse the wait time from the error message
        const waitSec = parseWaitTime(err.message) || Math.min(60 * attempt, 300);
        const label   = context ? ` [${context}]` : "";

        console.log(
          `\n      ⏳  Rate limit hit${label} — waiting ${waitSec}s before retry ` +
          `(attempt ${attempt}/${MAX_RETRIES})...`
        );
        await sleep(waitSec * 1000);
        continue;
      }

      // Not a rate limit error — rethrow immediately
      throw err;
    }
  }

  throw new Error(
    `Claude API rate limit — exceeded ${MAX_RETRIES} retries. ` +
    "Try increasing RATE_LIMIT_MS in your .env (e.g. RATE_LIMIT_MS=30000) " +
    "or upgrade your Anthropic plan at console.anthropic.com."
  );
}

/**
 * Parse the suggested wait time from a 429 error message.
 * Anthropic messages often say "try again in Xs" or "resets at <timestamp>".
 */
function parseWaitTime(message) {
  if (!message) return null;

  // "try again in 45 seconds"
  const secMatch = message.match(/try again in (\d+)\s*s/i);
  if (secMatch) return parseInt(secMatch[1], 10) + 2; // add 2s buffer

  // "resets in 30s" style
  const resetsMatch = message.match(/resets? in (\d+)/i);
  if (resetsMatch) return parseInt(resetsMatch[1], 10) + 2;

  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = claudeCall;
