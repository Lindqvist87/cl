import test from "node:test";
import assert from "node:assert/strict";
import { RightsStatus } from "@prisma/client";
import {
  canUseForChunkContext,
  canUseForCorpusBenchmark,
  rightsStatusCounts
} from "../lib/corpus/rights";
import {
  aggregateUsageLogs,
  usageLogFromOpenAIUsage
} from "../lib/ai/usage";

test("corpus rights helpers separate benchmark profiles from chunk context", () => {
  assert.equal(
    canUseForCorpusBenchmark({
      rightsStatus: RightsStatus.PRIVATE_REFERENCE,
      allowedUses: { corpusBenchmarking: true }
    }),
    true
  );
  assert.equal(
    canUseForChunkContext({
      rightsStatus: RightsStatus.PRIVATE_REFERENCE,
      allowedUses: { corpusBenchmarking: true }
    }),
    false
  );
  assert.equal(
    canUseForCorpusBenchmark({
      rightsStatus: RightsStatus.PUBLIC_DOMAIN,
      allowedUses: { corpusBenchmarking: false }
    }),
    false
  );
  assert.deepEqual(
    rightsStatusCounts([
      { rightsStatus: RightsStatus.PUBLIC_DOMAIN },
      { rightsStatus: RightsStatus.PUBLIC_DOMAIN },
      { rightsStatus: RightsStatus.OPEN_LICENSE }
    ]),
    {
      PUBLIC_DOMAIN: 2,
      OPEN_LICENSE: 1
    }
  );
});

test("usage logs record tokens and aggregate costs defensively", () => {
  const usage = usageLogFromOpenAIUsage(
    {
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 140,
      prompt_tokens_details: { cached_tokens: 12 },
      completion_tokens_details: { reasoning_tokens: 8 }
    },
    "test-model"
  );

  assert.equal(usage?.promptTokens, 100);
  assert.equal(usage?.completionTokens, 40);
  assert.equal(usage?.totalTokens, 140);
  assert.equal(usage?.cachedPromptTokens, 12);
  assert.equal(usage?.reasoningTokens, 8);
  assert.equal(usage?.cost.currency, "USD");

  const aggregate = aggregateUsageLogs("combined", [usage]);
  assert.equal(aggregate?.totalTokens, 140);
  assert.equal(aggregate?.cost.estimatedUsd, null);
});
