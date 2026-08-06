import assert from "node:assert/strict";
import test from "node:test";
import { ESTIMATED_IMAGE_TOKENS, estimateInputTokens } from "./token-estimate";

test("estimates text using the observed character ratio", () => {
  assert.equal(estimateInputTokens({ textChars: 9, imageCount: 0 }, 4), 3);
});

test("uses a bounded estimate per image instead of encoded byte length", () => {
  assert.equal(
    estimateInputTokens({ textChars: 0, imageCount: 1 }, 4),
    ESTIMATED_IMAGE_TOKENS,
  );
  assert.equal(
    estimateInputTokens({ textChars: 8, imageCount: 2 }, 4),
    ESTIMATED_IMAGE_TOKENS * 2 + 2,
  );
});
