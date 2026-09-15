import { wordlist } from "@scure/bip39/wordlists/english.js";

export type MnemonicChallenge = {
  answer: string;
  options: string[];
  position: number;
};

export function createMnemonicChallenges(
  mnemonic: string,
  count = 2,
  random: () => number = Math.random,
): MnemonicChallenge[] {
  const words = mnemonic.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) throw new Error("Mnemonic is empty");

  const positions = shuffled(
    words.map((_, index) => index),
    random,
  ).slice(0, Math.max(1, Math.min(count, words.length)));

  return positions.map((wordIndex) => createChallenge(words, wordIndex, random));
}

function createChallenge(
  words: string[],
  wordIndex: number,
  random: () => number,
): MnemonicChallenge {
  const answer = words[wordIndex]!;
  const phraseWords = new Set(words);
  const distractors = pickRandom(
    wordlist.filter((word) => !phraseWords.has(word)),
    2,
    random,
  );

  return {
    answer,
    options: shuffled([answer, ...distractors], random),
    position: wordIndex + 1,
  };
}

function pickRandom<T>(values: T[], count: number, random: () => number): T[] {
  const result = [...values];
  const picked = Math.min(count, result.length);
  for (let index = 0; index < picked; index += 1) {
    const swapIndex = index + randomIndex(result.length - index, random);
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result.slice(0, picked);
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, random);
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function randomIndex(length: number, random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) return 0;
  return Math.min(length - 1, Math.max(0, Math.floor(value * length)));
}
