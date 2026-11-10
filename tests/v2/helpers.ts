// 2.0 試作のテスト用の道具。外部の AI・DB は使わない（メモリの保存先とモックだけ）。

import { mockInterviewAi, mockReportGenerator } from "@/lib/v2/mock";
import * as service from "@/lib/v2/service";
import type { Deps } from "@/lib/v2/service";
import { createMemoryStore } from "@/lib/v2/store";
import type { ReportInput, SessionView } from "@/lib/v2/types";

export const SID_A = "A".repeat(43);
export const SID_B = "B".repeat(43);

export type TestDeps = Deps & { generatorInputs: ReportInput[] };

export function createDeps(overrides: Partial<Deps> = {}): TestDeps {
  let n = 0;
  const generatorInputs: ReportInput[] = [];
  const deps: TestDeps = {
    store: createMemoryStore(),
    ai: mockInterviewAi,
    // 資料生成に何が渡されたかを記録する（選ばなかった項目が渡っていないかを確かめるため）
    generator: async (input) => {
      generatorInputs.push(structuredClone(input));
      return mockReportGenerator(input);
    },
    now: () => "2026-11-10T00:00:00.000Z",
    newId: () => `item-${++n}`,
    generatorInputs,
    ...overrides,
  };
  return deps;
}

/** 7テーマすべてに「答え→聞き返しへの答え」で答えて、面談を終える */
export async function completeInterview(
  deps: Deps,
  sid: string,
  answerFor: (theme: string, round: number) => string = (theme, round) => `${theme}の答え${round}`,
): Promise<SessionView> {
  let view = await service.start(deps, sid);
  while (view.phase === "interview" && view.currentTheme) {
    const theme = view.currentTheme;
    const round = view.themes[theme].answers.length + 1;
    view = await service.answer(deps, sid, answerFor(theme, round));
  }
  return view;
}
