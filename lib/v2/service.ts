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
  DEFAULT_PURPOSE,
  INTRO,
  MAX_PREP_TEXT,
  MAX_WHO,
  MAX_PURPOSE,
  MAX_TEXT,
  OPTION_KEYS,
  OPTIONS,
  PREP_AREAS,
  PREP_KEYS,
  PREP_NOT_YET,
  PREP_STATUS_KEYS,
  PREP_STATUSES,
  STEP_KEYS,
  WHEN_KEYS,
  THEME_KEYS,
  themeDef,
} from "./content";
import { echo, safeQuestion } from "./echo";
import type { V2Store } from "./store";
import {
  V2Error,
  type ConsultantKey,
  type InterviewAi,
  type Item,
  type OptionKey,
  type PrepEntry,
  type PrepKey,
  type PrepStatus,
  type ReportGenerator,
  type ReportInput,
  type Session,
  type StepChoice,
  type StepKey,
  type WhenKey,
  type SessionView,
  type ThemeKey,
  type ThemeState,
  type Turn,
} from "./types";

export type Deps = {
  store: V2Store;
  ai: InterviewAi;
  generator: ReportGenerator;
  now: () => string;
  newId: () => string;
};

const EMPTY_PREP: PrepEntry = { status: null, next: "", basis: "" };

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
export function cleanText(value: unknown, max: number = MAX_TEXT): string {
  if (typeof value !== "string") throw new V2Error("bad_input", "文字を入力してください。");
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (text === "") throw new V2Error("bad_input", "文字を入力してください。");
  if (text.length > max) throw new V2Error("bad_input", `${max}文字以内で入力してください。`);
  return text;
}

/** 準備リストを持たない古い形の面談を読んだときに、欠けている分を補う（内容は作り足さない） */
function fillPrep(session: Session): Session {
  session.prep ??= {} as Record<PrepKey, PrepEntry>;
  for (const key of PREP_KEYS) session.prep[key] ??= { ...EMPTY_PREP };
  session.steps ??= {};
  for (const key of THEME_KEYS) {
    const state = session.themes[key];
    state.answerIds ??= [];
    // 古い形で保存された回答には ID がない。並びがずれないよう、古い回答の位置を空の ID で埋める
    // （ID は新しい回答ほど後ろに付くので、足りない分は前に入れる）
    const missing = state.answers.length - state.answerIds.length;
    if (missing > 0) state.answerIds = [...Array<string>(missing).fill(""), ...state.answerIds];
  }
  return session;
}

function load(deps: Deps, sid: string): Session {
  const session = deps.store.get(sid);
  if (!session) throw new V2Error("no_session", "面談がまだ始まっていません。最初の画面から始めてください。", 409);
  return fillPrep(session);
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
function advance(deps: Deps, session: Session, prefix: string): Turn | null {
  const next = nextTheme(session);
  if (next) {
    session.currentTheme = next;
    session.themes[next].status = "in_progress";
    const turn: Turn = { who: "ai", theme: next, text: `${prefix}${themeDef(next).question}` };
    session.log.push(turn);
    return turn;
  }
  session.currentTheme = null;
  session.phase = "review";
  session.items = buildReviewItems(session.themes, deps.newId);
  return null;
}



/** 準備リストの1分野を、資料に載せる1行の文章にする。本人が選んだ状態と書いた言葉だけを使う */
export function prepText(key: PrepKey, entry: PrepEntry): string {
  const label = PREP_AREAS.find((a) => a.key === key)!.label;
  let state: string;
  if (entry.status === null) {
    state = PREP_NOT_YET;
  } else if (entry.status === "confirmed") {
    // 「確認済み」はご本人の申告。何で確かめたかを添え、書かれていなければその旨を示す
    state = entry.basis
      ? `確認済み（ご本人の申告。確かめた資料・時点：${entry.basis}）`
      : "確認済み（ご本人の申告。資料名・時点は未記入）";
  } else {
    state = PREP_STATUSES.find((s) => s.key === entry.status)!.label;
  }
  return entry.next ? `${label}：${state}／次に確認すること：${entry.next}` : `${label}：${state}`;
}

/** 空でもよい短い文章を整える（制御文字を除く）。長すぎはエラー */
function cleanOptional(value: unknown, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new V2Error("bad_input", "文字を入力してください。");
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (text.length > max) throw new V2Error("bad_input", `${max}文字以内で入力してください。`);
  return text;
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
      state.answers.forEach((answer, i) => {
        add("statement", key, answer);
        const id = state.answerIds?.[i];
        if (id) items[items.length - 1].answerId = id;
      });
      add("ai_note", key, def.aiNote);
    } else {
      add("unconfirmed", key, `「${def.label}」については、面談で答えていません。`);
    }
  }
  // 準備リスト：はじめはどの分野も「まだ確認していません」。
  // テーマには結びつけない（これを選んでも、面談のテーマの質問が資料に足されないように）
  for (const area of PREP_AREAS) {
    items.push({
      id: newId(),
      kind: "prep",
      theme: null,
      prepKey: area.key,
      text: prepText(area.key, EMPTY_PREP),
      edited: false,
      selected: false,
    });
  }
  return items;
}

/** 資料生成に渡す入力を作る。本人が「載せる」を選んだ項目だけを取り出す */
export function buildReportInput(session: Session): ReportInput {
  const consultant = CONSULTANTS.find((c) => c.key === session.consultant);
  if (!consultant) throw new V2Error("no_consultant", "相談先を選んでください。");
  return {
    consultantLabel: consultant.label,
    purpose: session.purpose,
    items: session.items
      .filter((i) => i.selected === true)
      .map((i) => ({ kind: i.kind, theme: i.theme, text: i.text })),
  };
}

export function getView(deps: Deps, sid: string): SessionView | null {
  const session = deps.store.get(sid);
  return session ? toView(fillPrep(session)) : null;
}

/** 面談を始める。すでに始めていれば続きから（中断しても同じ場所に戻れる） */
export function start(deps: Deps, sid: string): Promise<SessionView> {
  return withLock(sid, async () => {
    const existing = deps.store.get(sid);
    if (existing) return toView(existing);
    const now = deps.now();
    const themes = Object.fromEntries(
      THEME_KEYS.map((k) => [k, { status: "not_started", answers: [], answerIds: [], followupAsked: false }]),
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
      prep: Object.fromEntries(PREP_KEYS.map((k) => [k, { ...EMPTY_PREP }])) as unknown as Record<PrepKey, PrepEntry>,
      options: [],
      steps: {},
      consultant: null,
      purpose: DEFAULT_PURPOSE,
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

    const answerId = deps.newId();
    state.answers = answers;
    state.answerIds = [...state.answerIds, answerId];
    session.log.push({ who: "me", theme: key, text, answerId });
    // 受け止めの一文（本人の言葉の引用）は、AI に任せず、今回の回答だけから作る。
    // 質問とは別に持ち、その発言を消したら引用も消せるようにする
    const heard = echo(text);
    let aiTurn: Turn | null;
    // 聞き返しは1テーマ1回まで（AI の返事にかかわらず、ここで止める）
    if (reply.action === "followup" && !state.followupAsked) {
      state.followupAsked = true;
      // AI の聞き返しに本人の言葉が混ざっていたら使わず、決まった質問に戻す
      aiTurn = { who: "ai", theme: key, text: safeQuestion(reply.reply, answers, themeDef(key).followup) };
      session.log.push(aiTurn);
    } else {
      state.status = "answered";
      aiTurn = advance(deps, session, "ありがとうございます。次の質問です。\n\n");
    }
    if (aiTurn) {
      aiTurn.heard = heard;
      aiTurn.heardOf = answerId;
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

/** 準備リストの項目は、準備リストの画面でだけ変えられる（文章と状態が食い違わないように） */
function rejectPrep(item: Item) {
  if (item.kind === "prep") {
    throw new V2Error("bad_input", "準備リストの項目は、準備リストの画面で直してください。");
  }
}

/** 整理案を本人が書き直す。資料の下書きは古くなるので破棄する */
export function editItem(deps: Deps, sid: string, itemId: unknown, rawText: unknown): Promise<SessionView> {
  return withLock(sid, async () => {
    const text = cleanText(rawText);
    const session = load(deps, sid);
    requireReview(session);
    const item = findItem(session, itemId);
    rejectPrep(item);
    item.text = text;
    item.edited = true;
    // 書き直した内容は、もう一度本人が「載せる」を選ぶまで資料に入れない。
    // ID も発行し直す：古い文章を表示したままの画面から、同じ ID で「載せる」を送れないようにする
    item.selected = false;
    item.id = deps.newId();
    session.report = null;
    return save(deps, session);
  });
}

/**
 * 本人の発言を、面談の記録からも消す。
 * - 回答の原文、会話の記録の該当の発言、AI がその言葉を引用した一文を消す
 * - そのテーマの答えが1つも残らなくなったら、AI の整理案（本人が直していないもの）も消し、
 *   「答えが残っていません」を未確認として残す（黙って無かったことにしない）
 */
function forgetAnswer(deps: Deps, session: Session, theme: ThemeKey, answerId: string) {
  const state = session.themes[theme];
  const index = state.answerIds.indexOf(answerId);
  if (index >= 0) {
    state.answers.splice(index, 1);
    state.answerIds.splice(index, 1);
  }
  session.log = session.log.filter((t) => t.answerId !== answerId);
  for (const turn of session.log) {
    if (turn.heardOf === answerId) {
      delete turn.heard;
      delete turn.heardOf;
    }
  }
  if (state.answers.length === 0) {
    state.status = "skipped";
    session.items = session.items.filter((i) => !(i.kind === "ai_note" && i.theme === theme && !i.edited));
    if (!session.items.some((i) => i.kind === "unconfirmed" && i.theme === theme)) {
      session.items.push({
        id: deps.newId(),
        kind: "unconfirmed",
        theme,
        text: `「${themeDef(theme).label}」については、答えが残っていません。`,
        edited: false,
        selected: false,
      });
    }
  }
}

/** 項目を外す。本人の発言は、面談の記録からも消す */
export function removeItem(deps: Deps, sid: string, itemId: unknown): Promise<SessionView> {
  return withLock(sid, async () => {
    const session = load(deps, sid);
    requireReview(session);
    const item = findItem(session, itemId);
    rejectPrep(item);
    if (item.kind === "statement") {
      // 古い形で保存された発言は、面談の記録のどこにあるかを確かめられない。
      // 「記録からも消す」と言って消し残すことがないよう、個別には消さない
      if (!item.answerId || !item.theme || !session.themes[item.theme].answerIds.includes(item.answerId)) {
        throw new V2Error(
          "cannot_forget",
          "この発言は古い形で保存されているため、個別には消せません。消したいときは「すべて消す」を使ってください。",
          409,
        );
      }
      forgetAnswer(deps, session, item.theme, item.answerId);
    }
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

/**
 * 準備リストを保存する。渡された分野だけを書き換える。
 * 文章が変わった分野は「載せる」を外す（本人が選び直すまで資料に入れない）。
 * 1つでも正しくない指定があれば、何も変えない
 */
export function setPrep(deps: Deps, sid: string, raw: unknown): Promise<SessionView> {
  return withLock(sid, async () => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new V2Error("bad_input", "準備リストの指定が正しくありません。");
    }
    const updates = new Map<PrepKey, PrepEntry>();
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!PREP_KEYS.includes(key as PrepKey) || value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new V2Error("bad_input", "準備リストの指定が正しくありません。");
      }
      const v = value as Record<string, unknown>;
      const status = v.status === null || v.status === undefined ? null : v.status;
      if (status !== null && !PREP_STATUS_KEYS.includes(status as PrepStatus)) {
        throw new V2Error("bad_input", "準備リストの指定が正しくありません。");
      }
      updates.set(key as PrepKey, {
        status: status as PrepStatus | null,
        next: cleanOptional(v.next, MAX_PREP_TEXT),
        // 「何で確かめたか」は確認済みのときだけ持つ
        basis: status === "confirmed" ? cleanOptional(v.basis, MAX_PREP_TEXT) : "",
      });
    }

    const session = load(deps, sid);
    requireReview(session);
    for (const [key, entry] of updates) {
      session.prep[key] = entry;
      const text = prepText(key, entry);
      const item = session.items.find((i) => i.kind === "prep" && i.prepKey === key);
      if (!item) {
        session.items.push({ id: deps.newId(), kind: "prep", theme: null, prepKey: key, text, edited: false, selected: false });
      } else if (item.text !== text) {
        // 文章が変わったら「載せる」を外し、ID も発行し直す（古い画面の ID では選べないように）
        item.text = text;
        item.selected = false;
        item.id = deps.newId();
        // 「次の一歩」のメモは、前の文章に対して選んだもの。文章が変わったら持ち越さない
        delete session.steps[key];
      }
    }
    session.report = null;
    return save(deps, session);
  });
}

/**
 * 「次の一歩」で本人が選んだこと（やる／今は保留、誰が、いつ頃）を保存する。
 * 本人用のメモで、相談資料には入れない。資料の下書きにも影響しない。
 * 1つでも正しくない指定があれば、何も変えない
 */
export function setNextSteps(deps: Deps, sid: string, raw: unknown): Promise<SessionView> {
  return withLock(sid, async () => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new V2Error("bad_input", "次の一歩の指定が正しくありません。");
    }
    const updates = new Map<StepKey, StepChoice>();
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!STEP_KEYS.includes(key as StepKey) || value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new V2Error("bad_input", "次の一歩の指定が正しくありません。");
      }
      const v = value as Record<string, unknown>;
      const decision = v.decision === undefined ? null : v.decision;
      if (decision !== null && decision !== "do" && decision !== "hold") {
        throw new V2Error("bad_input", "次の一歩の指定が正しくありません。");
      }
      const when = v.when === undefined ? null : v.when;
      if (when !== null && !WHEN_KEYS.includes(when as WhenKey)) {
        throw new V2Error("bad_input", "次の一歩の指定が正しくありません。");
      }
      // 「誰が」「いつ頃」は、やると決めたときだけ持つ
      updates.set(key as StepKey, {
        decision,
        who: decision === "do" ? cleanOptional(v.who, MAX_WHO) : "",
        when: decision === "do" ? (when as WhenKey | null) : null,
      });
    }

    const session = load(deps, sid);
    requireReview(session);
    for (const [key, choice] of updates) session.steps[key] = choice;
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

/**
 * 相談先と、資料に載せる項目を保存する。指定された項目だけを「載せる」にする。
 * purpose（相談の目的）は、渡されたときだけ書き換える
 */
export function setReportSettings(
  deps: Deps,
  sid: string,
  consultant: unknown,
  selectedIds: unknown,
  rawPurpose?: unknown,
): Promise<SessionView> {
  return withLock(sid, async () => {
    const purpose = rawPurpose === undefined ? null : cleanText(rawPurpose, MAX_PURPOSE);
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
    // 相談先を変えたら、前の相談先に対する「次の一歩」のメモは持ち越さない
    if (session.consultant !== consultant) delete session.steps.consult;
    session.consultant = consultant as ConsultantKey;
    if (purpose !== null) session.purpose = purpose;
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
