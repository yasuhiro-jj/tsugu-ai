import { describe, expect, it } from "vitest";
import { correctTranscript } from "@/components/voice/corrections";
import { appendWithinLimit } from "@/components/voice/append";

describe("音声入力の聞き間違いの置き換え", () => {
  it("オーナーの実例：仙台・洗剤が先代に直る", () => {
    const heard = "いつもお客さんは仙台の方見てありがとうございました いつも 洗剤と話ばっかりしていて";
    expect(correctTranscript(heard)).toBe(
      "いつもお客さんは先代の方見てありがとうございました いつも 先代と話ばっかりしていて",
    );
  });

  it("ひらがなの「せんだい」と「先代さん」も先代にそろえる", () => {
    expect(correctTranscript("せんだいに聞いた")).toBe("先代に聞いた");
    expect(correctTranscript("先代さんの味")).toBe("先代の味");
    expect(correctTranscript("仙台さんの味")).toBe("先代の味");
  });

  it("ひらがなの「こうけいしゃ」は後継者に直す", () => {
    expect(correctTranscript("こうけいしゃとして")).toBe("後継者として");
  });

  it("同じ語が何度出ても全部直し、関係ない文は変えない", () => {
    expect(correctTranscript("仙台と洗剤と仙台")).toBe("先代と先代と先代");
    expect(correctTranscript("資金繰りが心配です")).toBe("資金繰りが心配です");
    expect(correctTranscript("")).toBe("");
  });
});

describe("入力欄の後ろに足す（appendWithinLimit）", () => {
  it("今の文の後ろに半角スペースを挟んで足す", () => {
    expect(appendWithinLimit("店の今後", "資金繰り", { max: 100 })).toEqual({ text: "店の今後 資金繰り", truncated: false });
  });

  it("1行入力では改行を半角スペースにし、上限で切る", () => {
    expect(appendWithinLimit("", "a\nb", { max: 100, singleLine: true }).text).toBe("a b");
    expect(appendWithinLimit("ab", "cdef", { max: 5 })).toEqual({ text: "ab cd", truncated: true });
  });
});
