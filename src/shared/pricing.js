const PRICING = {
  "claude-opus-4-6": {
    input: 15,
    output: 75,
    cacheRead: 1.5,
    cacheCreation: 18.75,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheRead: 0.3,
    cacheCreation: 3.75,
  },
  "claude-haiku-4-5": {
    input: 0.8,
    output: 4,
    cacheRead: 0.08,
    cacheCreation: 1.0,
  },
};

const DEFAULT_PRICING = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheCreation: 3.75,
};

function getModelPricing(model) {
  if (!model) return DEFAULT_PRICING;
  const key = Object.keys(PRICING).find((k) => model.includes(k));
  return key ? PRICING[key] : DEFAULT_PRICING;
}

function calculateCost(usage, model) {
  const pricing = getModelPricing(model);
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;

  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output +
    (cacheRead / 1_000_000) * pricing.cacheRead +
    (cacheCreation / 1_000_000) * pricing.cacheCreation
  );
}

module.exports = { PRICING, DEFAULT_PRICING, getModelPricing, calculateCost };
