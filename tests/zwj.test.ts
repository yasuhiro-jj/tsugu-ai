// 見えない書式文字の検査で ZWJ（U+200D）だけは許す（SEC-A03。lib/validation.ts）。
// 家族の絵文字などは通す。ZWJ だけ・先頭・末尾・連続は 400。
// 文字は String.fromCodePoint で作る（ソースに生の ZWJ を書かない）

import { describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/errors";
import { hasBadTextChars, validateText, ZWJ_MISUSE } from "@/lib/validation";
import { validateAdvisorText } from "@/lib/advisor";
import { validateAskQuestion } from "@/lib/learning-ask";

const ZWJ = String.fromCodePoint(0x200d);
const MAN = String.fromCodePoint(0x1f468);
const WOMAN = String.fromCodePoint(0x1f469);
const GIRL = String.fromCodePoint(0x1f467);
const FAMILY = [MAN, WOMAN, GIRL].join(ZWJ);

const rule = (allowNewline: boolean) => ({
  max: 100,
  allowNewline,
  emptyMessage: "EMPTY",
  tooLongMessage: "LONG",
  badCharMessage: "BAD",
});
const msgOf = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceError);
    expect((e as ServiceError).status).toBe(400);
    return (e as ServiceError).userMessage;
  }
};

describe("ZWJ（U+200D）の扱い", () => {
  it("正規表現は ZWJ をエスケープで持つ（生の文字に化けていない）", () => {
    const esc = "\\u" + "200d";
    expect(ZWJ_MISUSE.source).toBe(`^${esc}|${esc}$|${esc}${esc}`);
    expect(ZWJ_MISUSE.source).not.toContain(ZWJ);
  });

  it("家族の絵文字は通る（改行あり・なしの欄とも）", () => {
    expect(FAMILY).toHaveLength(8); // 絵文字3つ（サロゲートペア）＋ ZWJ 2つ
    for (const nl of [true, false]) {
      expect(validateText(`家族${FAMILY}で相談`, rule(nl))).toBe(`家族${FAMILY}で相談`);
      expect(validateText(FAMILY, rule(nl))).toBe(FAMILY);
    }
    expect(validateAdvisorText(`うちの${FAMILY}について`)).toBe(`うちの${FAMILY}について`);
    expect(validateAskQuestion(`${FAMILY}で読むには？`)).toBe(`${FAMILY}で読むには？`);
    expect(hasBadTextChars(FAMILY)).toBe(false);
  });

  it("ZWJ だけ・先頭・末尾・連続は 400", () => {
    const bad = [
      ZWJ,
      ZWJ + ZWJ,
      `${ZWJ}${MAN}`,
      `${MAN}${ZWJ}`,
      `${MAN}${ZWJ}${ZWJ}${WOMAN}`,
      `  ${ZWJ}あい`, // 前後の空白を除くと先頭
      `あい${ZWJ}  `, // 前後の空白を除くと末尾
    ];
    for (const nl of [true, false]) {
      for (const t of bad) expect(msgOf(() => validateText(t, rule(nl))), JSON.stringify(t)).toBe("BAD");
    }
    expect(msgOf(() => validateAdvisorText(`${MAN}${ZWJ}${ZWJ}${WOMAN}`))).not.toBeNull();
    expect(msgOf(() => validateAskQuestion(ZWJ))).not.toBeNull();
  });

  it("ZWJ 以外の見えない書式文字は今までどおり 400（ZWJ と並んでいても）", () => {
    for (const c of [0x200b, 0x200c, 0x200e, 0x202e, 0x2066, 0xfeff, 0x061c]) {
      const ch = String.fromCodePoint(c);
      expect(msgOf(() => validateText(`あ${ch}い`, rule(true)))).toBe("BAD");
      expect(msgOf(() => validateText(`${MAN}${ZWJ}${ch}${WOMAN}`, rule(true)))).toBe("BAD");
    }
  });
});
