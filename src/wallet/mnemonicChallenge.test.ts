import { describe, expect, it } from "vitest";

import { createMnemonicChallenges } from "./mnemonicChallenge";

const mnemonic =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("mnemonic backup challenge", () => {
  it("asks two different randomly selected word positions", () => {
    const challenges = createMnemonicChallenges(mnemonic, 2, () => 0.99);
    const words = mnemonic.split(" ");

    expect(challenges).toHaveLength(2);
    expect(challenges[0]!.position).not.toBe(challenges[1]!.position);
    for (const challenge of challenges) {
      expect(challenge.answer).toBe(words[challenge.position - 1]);
      expect(challenge.options).toContain(challenge.answer);
    }
  });

  it("always provides three distinct choices even when words repeat", () => {
    const [challenge] = createMnemonicChallenges(mnemonic, 2, () => 0);
    const phraseWords = new Set(mnemonic.split(" "));

    expect(challenge!.options).toHaveLength(3);
    expect(new Set(challenge!.options)).toHaveLength(3);
    expect(challenge!.options).toContain(challenge!.answer);
    expect(
      challenge!.options
        .filter((option) => option !== challenge!.answer)
        .every((option) => !phraseWords.has(option)),
    ).toBe(true);
  });
});
