// API から呼ばれる入口。操作名（action）ごとに service の処理へ振り分ける。

import * as service from "./service";
import type { Deps } from "./service";
import { V2Error, type SessionView } from "./types";

export const ACTIONS = [
  "start",
  "answer",
  "skip",
  "finish",
  "editItem",
  "removeItem",
  "confirmReview",
  "setOptions",
  "setReportSettings",
  "generateReport",
  "reset",
] as const;

export type Action = (typeof ACTIONS)[number];

export function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

export async function dispatch(
  deps: Deps,
  sid: string,
  body: Record<string, unknown>,
): Promise<SessionView | null> {
  const action = body.action;
  if (!isAction(action)) throw new V2Error("bad_action", "操作の指定が正しくありません。");
  switch (action) {
    case "start":
      return service.start(deps, sid);
    case "answer":
      return service.answer(deps, sid, body.text);
    case "skip":
      return service.skip(deps, sid);
    case "finish":
      return service.finishEarly(deps, sid);
    case "editItem":
      return service.editItem(deps, sid, body.itemId, body.text);
    case "removeItem":
      return service.removeItem(deps, sid, body.itemId);
    case "confirmReview":
      return service.confirmReview(deps, sid);
    case "setOptions":
      return service.setOptions(deps, sid, body.options);
    case "setReportSettings":
      return service.setReportSettings(deps, sid, body.consultant, body.selectedIds, body.purpose);
    case "generateReport":
      return service.generateReport(deps, sid);
    case "reset":
      return service.reset(deps, sid);
  }
}
