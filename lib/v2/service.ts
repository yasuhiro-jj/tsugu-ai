// 2.0 試作の中心の処理：一人面談 → 本人確認 → 選択肢 → 資料設定 → 資料の下書き。
//
// 守っていること
// - 外部の AI・DB につながない（AI と資料生成は差し替え部品として受け取る。既定はモック）
// - 資料生成に渡すのは、本人が選んだ項目だけ（buildReportInput）。選ばなかった項目は渡さない
// - 「載せる」の初期値はすべて false
// - 処理に失敗したら何も保存せず、内容を勝手に補わない
// - 回答・資料の本文をログに出さない

import {
  CONSULTANT_KEYS,
  CONSULTANTS,
  FIXED_UNCONFIRMED,
  INTRO,
  MAX_TEXT,
  OPTION_KEYS,
  OPTIONS,
  THEME_KEYS,
  themeDef,
} from "./content";
import type { V2Store } from "./store";
import {
  V2Error,
  type ConsultantKey,
  type InterviewAi,
  type Item,
  type OptionKey,
  type ReportGenerator,
  type ReportInput,
  type Session,
  type SessionView,
  type ThemeKey,
  type ThemeState,
} from "./types";

export type Deps = {
  store: V2Store;
  ai: InterviewAi;
  generator: ReportGenerator;
  now: () => string;
  newId: () => string;
};

const RETRY_HINT = "入力した内容は保存されていません。少し待って、もう一度お試しください。";

// 同じ人の操作が重なっても順番に処理する
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(sid: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(sid) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  locks.set(sid, run);
  try {
    return await run;
  } finally {
    if (locks.get(sid) === run) locks.delete(sid);
  }
}

function toView(session: Session): SessionView {
  const { id: _id, ...view } = session;
  return view;
}

/** 入力の文字を整える（制御文字を除き、前後の空白を取る）。空・長すぎはエラー */
export function cleanText(value: unknown): string {
  if (typeof value !== "string") throw new V2Error("bad_input", "文字を入力してください。");
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (text === "") throw new V2Error("bad_input", "文字を入力してください。");
  if (text.length > MAX_TEXT) throw new V2Error("bad_input", `${MAX_TEXT}文字以内で入力してください。`);
  return text;
}

function load(deps: Deps, sid: string): Session {
  const session = deps.store.get(sid);
  if (!session) throw new V2Error("no_session", "面談がまだ始まっていません。最初の画面から始めてください。", 409);
  return session;
}

function save(deps: Deps, session: Session): SessionView {
  session.updatedAt = deps.now();
  deps.store.put(session);
  return toView(session);
}

function nextTheme(session: Session): ThemeKey | null {
  return THEME_KEYS.find((k) => session.themes[k].status === "not_started") ?? null;
}

/** 次のテーマの質問を出す。残りがなければ本人確認用の整理案を作って面談を終える */
function advance(deps: Deps, session: Session, prefix: string) {
  const next = nextTheme(session);
  if (next) {
    session.currentTheme = next;
    session.themes[next].status = "in_progress";
    session.log.push({ who: "ai", theme: next, text: `${prefix}${themeDef(next).question}` });
    return;
  }
  session.currentTheme = null;
  session.phase = "review";
  session.items = buildReviewItems(session.themes, deps.newId);
}

/**
 * 本人確認用の整理案を作る（決まった処理。AI は使わない）。
 * - 本人の発言：入力した文章をそのまま
 * - AI の整理案：答えたテーマごとの決まり文句（可能性として書く）
 * - 未確認：飛ばしたテーマと、資料で確かめていない事柄。ゼロや「問題なし」には変えない
 */
export function buildReviewItems(themes: Record<ThemeKey, ThemeState>, newId: () => string): Item[] {
  const items: Item[] = [];
  const add = (kind: Item["kind"], theme: ThemeKey | null, text: string) =>
    items.push({ id: newId(), kind, theme, text, edited: false, selected: false });

  for (const key of THEME_KEYS) {
    const state = themes[key];
    const def = themeDef(key);
    if (state.answers.length > 0) {
      for (const answer of state.answers) add("statement", key, answer);
      add("ai_note", key, def.aiNote);
    } else {
      add("unconfirmed", key, `「${def.label}」については、面談で答えていません。`);
    }
  }
  // テーマには結びつけない（これを選んでも、ほかのテーマの質問が資料に足されないように）
  for (const text of FIXED_UNCONFIRMED) add("unconfirmed", null, text);
  return items;
}

/** 資料生成に渡す入力を作る。本人が「載せる」を選んだ項目だけを取り出す */
export function buildReportInput(session: Session): ReportInput {
  const consultant = CONSULTANTS.find((c) => c.key === session.consultant);
  if (!consultant) throw new V2Error("no_consultant", "相談先を選んでください。");
  return {
    consultantLabel: consultant.label,
    items: session.items
      .filter((i) => i.selected === true)
      .map((i) => ({ kind: i.kind, theme: i.theme, text: i.text })),
  };
}

export function getView(deps: Deps, sid: string): SessionView | null {
  const session = deps.store.get(sid);
  return session ? toView(session) : null;
}

/** 面談を始める。すでに始めていれば続きから（中断しても同じ場所に戻れる） */
export function start(deps: Deps, sid: string): Promise<SessionView> {
  return withLock(sid, async () => {
    const existing = deps.store.get(sid);
    if (existing) return toView(existing);
    const now = deps.now();
    const themes = Object.fromEntries(
      THEME_KEYS.map((k) => [k, { status: "not_started", answers: [], followupAsked: false }]),
    ) as unknown as Record<ThemeKey, ThemeState>;
    const session: Session = {
      id: sid,
      createdAt: now,
      updatedAt: now,
      phase: "interview",
      currentTheme: null,
      themes,
      log: [],
      items: [],
      reviewConfirmed: false,
      options: [],
      consultant: null,
      report: null,
    };
    advance(deps, session, `${INTRO}\n\n`);
    return save(deps, session);
  });
}

export function answer(deps: Deps, sid: string, rawText: unknown): Promise<SessionView> {
  return withLock(sid, async () => {
    const text = cleanText(rawText);
    const session = load(deps, sid);
    const key = session.currentTheme;
    if (session.phase !== "interview" || !key) {
      throw new V2Error("not_in_interview", "面談はすでに終わっています。", 409);
    }
    const state = session.themes[key];
    const answers = [...state.answers, text];

    let reply;
    try {
      reply = await deps.ai({ theme: key, answers, followupAsked: state.followupAsked });
    } catch {
      // 失敗したら何も保存しない。AI の返事を作り足さない
      throw new V2Error("ai_failed", `うまく処理できませんでした。${RETRY_HINT}`, 503);
    }
    if (!reply || typeof reply.reply !== "string" || reply.reply.trim() === "") {
      throw new V2Error("ai_failed", `うまく処理できませんでした。${RETRY_HINT}`, 503);
    }

    state.answers = answers;
    session.log.push({ who: "me", theme: key, text });
    // 聞き返しは1テーマ1回まで（AI の返事にかかわらず、ここで止める）
    if (reply.action === "followup" && !state.followupAsked) {
      state.followupAsked = true;
      session.log.push({ who: "ai", theme: key, text: reply.reply.trim() });
    } else {
      state.status = "answered";
      advance(deps, session, "ありがとうございます。次の質問です。\n\n");
    }
    return save(deps, session);
  });
}

/** 今の質問を飛ばす。答えていないテーマは「未確認」として残る */
export function skip(deps: Deps, sid: string): Promise<SessionView> {
  return withLock(sid, async () => {
    const session = load(deps, sid);
    const key = session.currentTheme;
    if (session.phase !== "interview" || !key) {
      throw new V2Error("not_in_interview", "面談はすでに終わっています。", 409);
    }
    const state = session.themes[key];
    state.status = state.answers.length > 0 ? "answered" : "skipped";
    advance(deps, session, "この質問は飛ばしました。次の質問です。\n\n");
    return save(deps, session);
  });
}

/** 残りの質問をすべて飛ばして、本人確認へ進む */
export function finishEarly(deps: Deps, sid: string): Promise<SessionView> {
  return withLock(sid, async () => {
    const session = load(deps, sid);
    if (session.phase !== "interview") throw new V2Error("not_in_interview", "面談はすでに終わっています。", 409);
    for (const key of THEME_KEYS) {
      const state = session.themes[key];
      if (state.status === "not_started" || state.status === "in_progress") {
        state.status = state.answers.length > 0 ? "answered" : "skipped";
      }
    }
    advance(deps, session, "");
    return save(deps, session);
  });
}

function requireReview(session: Session) {
  if (session.phase !== "review") throw new V2Error("not_in_review", "先に面談を終えてください。", 409);
}

function findItem(session: Session, itemId: unknown): Item {
  const item = typeof itemId === "string" ? session.items.find((i) => i.id === itemId) : undefined;
  if (!item) throw new V2Error("no_item", "その項目は見つかりませんでした。", 404);
  return item;
}

/** 整理案を本人が書き直す。資料の下書きは古くなるので破棄する */
export function editItem(deps: Deps, sid: string, itemId: unknown, rawText: unknown): Promise<SessionView> {
  return withLock(sid, async () => {
    const text = cleanText(rawText);
    const session = load(deps, sid);
    requireReview(session);
    const item = findItem(session, itemId);
    item.text = text;
    item.edited = true;
    // 書き直した内容は、もう一度本人が「載せる」を選ぶまで資料に入れない
    item.selected = false;
    session.report = null;
    return save(deps, session);
  });
}

export function removeItem(deps: Deps, sid: string, itemId: unknown): Promise<SessionView> {
  return withLock(sid, async () => {
    const session = load(deps, sid);
    requireReview(session);
    const item = findItem(session, itemId);
    session.items = session.items.filter((i) => i.id !== item.id);
    session.report = null;
    return save(deps, session);
  });
}

export function confirmReview(deps: Deps, sid: string): Promise<SessionView> {
  return withLock(sid, async () => {
    const session = load(deps, sid);
    requireReview(session);
    session.reviewConfirmed = true;
    return save(deps, session);
  });
}

/** 関心のある選択肢を保存する（いくつでも・あとで変更可）。資料に載せるかは別に選ぶ */
export function setOptions(deps: Deps, sid: string, raw: unknown): Promise<SessionView> {
  return withLock(sid, async () => {
    if (!Array.isArray(raw) || raw.some((v) => !OPTION_KEYS.includes(v as OptionKey))) {
      throw new V2Error("bad_input", "選択肢の指定が正しくありません。");
    }
    const session = load(deps, sid);
    requireReview(session);
    const chosen = OPTION_KEYS.filter((k) => raw.includes(k));
    session.options = chosen;
    // 選択肢の項目は作り直す。「載せる」は必ず未選択に戻す
    session.items = session.items.filter((i) => i.kind !== "option");
    if (chosen.length > 0) {
      const labels = chosen.map((k) => OPTIONS.find((o) => o.key === k)!.label).join("、");
      session.items.push({
        id: deps.newId(),
        kind: "option",
        theme: null,
        text: `関心のある選択肢：${labels}（まだ決めたわけではありません）`,
        edited: false,
        selected: false,
      });
    }
    session.report = null;
    return save(deps, session);
  });
}

/** 相談先と、資料に載せる項目を保存する。指定された項目だけを「載せる」にする */
export function setReportSettings(
  deps: Deps,
  sid: string,
  consultant: unknown,
  selectedIds: unknown,
): Promise<SessionView> {
  return withLock(sid, async () => {
    if (!CONSULTANT_KEYS.includes(consultant as ConsultantKey)) {
      throw new V2Error("no_consultant", "相談先を選んでください。");
    }
    if (!Array.isArray(selectedIds) || selectedIds.some((v) => typeof v !== "string")) {
      throw new V2Error("bad_input", "載せる項目の指定が正しくありません。");
    }
    const session = load(deps, sid);
    requireReview(session);
    const known = new Set(session.items.map((i) => i.id));
    if (selectedIds.some((id) => !known.has(id))) {
      throw new V2Error("no_item", "その項目は見つかりませんでした。", 404);
    }
    const chosen = new Set(selectedIds as string[]);
    session.consultant = consultant as ConsultantKey;
    for (const item of session.items) item.selected = chosen.has(item.id);
    session.report = null;
    return save(deps, session);
  });
}

/** 相談資料の下書きを作る。自動では誰にも送らない */
export function generateReport(deps: Deps, sid: string): Promise<SessionView> {
  return withLock(sid, async () => {
    const session = load(deps, sid);
    requireReview(session);
    if (!session.reviewConfirmed) {
      throw new V2Error("not_confirmed", "先に、整理した内容をご本人が確認してください。", 409);
    }
    const input = buildReportInput(session);
    if (input.items.length === 0) {
      throw new V2Error("nothing_selected", "資料に載せる項目を、1つ以上選んでください。");
    }
    let draft;
    try {
      draft = await deps.generator(input);
    } catch {
      throw new V2Error("report_failed", "資料を作れませんでした。少し待って、もう一度お試しください。", 503);
    }
    session.report = { ...draft, generatedAt: deps.now() };
    return save(deps, session);
  });
}

/** この面談の内容をすべて消す */
export function reset(deps: Deps, sid: string): Promise<null> {
  return withLock(sid, async () => {
    deps.store.delete(sid);
    return null;
  });
}
