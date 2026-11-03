import "server-only";

// AI参謀チャット（POST /api/advisor/message・/api/advisor/reset、getAdvisorState）。Next.js に依存しない（テストから呼べる）。
//
// 守ること（CLAUDE.md「必ず守る動作」・オーナー指示 2026-11-03）：
// - 会話は本人だけのもの：advisor_chats は (demo_id, role) ごと。読み書きは必ず demo_id ＋ role で絞る。
//   相手の役割には内容も「会話があること」も返さない。診断・学習・90日計画からは読まない
// - AI への入力は「お店の数字（計算済み）」「保存済みの診断（getDiagnosisFrom。二人とも共有したテーマだけから作った共有物）」
//   「本人の立場と知識レベル」「本人の会話（直近の数往復）」だけ。
//   面談の要約・会話（共有済みを含む）、相手の会話、学習プランの理由・希望は DB からも読まない
// - 診断は toPublicDiagnosisRecord と同じく diagnosis だけを使う（どのテーマが共有されたか basedOnThemeKeys は渡さない。SEC-103）
// - AI の呼び出しは callJsonAi（reserveAiCall で回数を予約。壊れた返事・一時エラーは1回だけ再送）
// - AI が失敗したら本人の発言も保存しない
// - 同時送信（SEC-A01）：AI を呼ぶ前に会話の行へ「送信中」の印（pending_at）を rev つきで書いて予約する。
//   予約できなかった送信は AI を呼ばずに 409（AI の回数・費用を使わない）。成功時は保存と同時に、失敗時は必ず印を外す。
//   ADVISOR_PENDING_TTL_MS より古い印は無視する（処理が途中で落ちても固まらない）
// - 診断との結びつき（REV-001）：会話は、AI に診断を渡した時点でその診断（diagnosis_created_at）に結びつく。
//   共有の取り消し（invalidateDiagnosisStatements の同じ batch）で結びついた会話は消え、読み出しでも今の診断と照合して
//   合わなければ消す。診断を一度も使っていない会話（null）は残す（取り消した内容を含まないため）
// - 知識レベル：後継者は learning.level（講座で上がる）、先代は初期値（REV-005）
// - 入力本文・AI の返事はログに出さない
// - AI の返事に言い切りに見える表現があれば固定の注記（caution）を足す。返事は変えない（lib/assertive.ts。SEC-A02）

import type { Client } from "@libsql/client";
import {
  ADVISOR_CONSULTS,
  ADVISOR_MAX_LENGTH,
  ADVISOR_MAX_TURNS,
  type AdvisorConsult,
  type AdvisorMessage,
  type AdvisorState,
} from "./advisor-types";
import type { Role } from "./role";
import { ServiceError, MSG_CONFLICT } from "./errors";
import { getDb } from "./db";
import { COMPANY_CONTEXT, DEMO_PROFILES } from "./demo-profiles";
import { financialsForPrompt, upsideForPrompt } from "./financials";
import { getDiagnosisFrom, toPublicDiagnosisRecord } from "./diagnosis";
import { ADVISOR_SYSTEM_TEMPLATE } from "./prompts/advisor";
import { arr, callJsonAi, dataBlock, dataNote, str, type AiDeps, type JsonAiMessage, type JsonAiRequest } from "./ai/json-ai";
import { charLen, fillTemplate, nowIso } from "./util";
import { validateText } from "./validation";
import { getLearningLevel } from "./learning";
import { ASSERTIVE_CAUTION, cautionFor } from "./assertive";

export const MSG_ADVISOR_TURN_LIMIT = `AI参謀と話せるのは${ADVISOR_MAX_TURNS}回までです。「会話を消す」で始めからやり直せます`;
export const MSG_ADVISOR_EMPTY = "相談したいことを入力してください";
export const MSG_ADVISOR_TOO_LONG = `相談は${ADVISOR_MAX_LENGTH}文字以内で入力してください`;
export const MSG_ADVISOR_BAD_CHARS = "使えない文字（制御文字など）が含まれています";

/** AI に渡す履歴：直近の往復数の上限 */
export const ADVISOR_HISTORY_EXCHANGES = 6;
/** AI に渡す履歴：文字数の合計の上限（古いものから落とす。今回の発言は数えない） */
export const ADVISOR_HISTORY_MAX_CHARS = 8000;
export const ADVISOR_MAX_TOKENS = 2000;
/** Route の maxDuration 60 秒より短く（DB の読み書きの分を残す。面談と同じ） */
export const ADVISOR_AI_BUDGET_MS = 50_000;
/** 「送信中」の印の有効時間。AI の時間（50秒）と Route の maxDuration（60秒）より長く、固まったときは早めに戻る長さ */
export const ADVISOR_PENDING_TTL_MS = 90_000;
export const MSG_ADVISOR_BUSY = "前の相談にまだ答えています。返事が出てからもう一度送ってください";

const REPLY_MAX = 1500;
const POINT_MAX = 200;
const POINTS_MAX = 4;
const NOTE_MAX = 300;

/** 相談の文：改行をそろえ、前後の空白を除いて 1〜1000 文字。改行は可、ほかの制御文字は 400（切り詰めはしない） */
export function validateAdvisorText(value: unknown): string {
  return validateText(value, {
    max: ADVISOR_MAX_LENGTH,
    allowNewline: true,
    emptyMessage: MSG_ADVISOR_EMPTY,
    tooLongMessage: MSG_ADVISOR_TOO_LONG,
    badCharMessage: MSG_ADVISOR_BAD_CHARS,
  });
}

// ---- 保存・取得（すべて demo_id ＋ role で絞る） ----

type Stored = { messages: AdvisorMessage[]; rev: number };
const EMPTY_CHAT: Stored = { messages: [], rev: 0 };

function isConsult(v: unknown): v is AdvisorConsult {
  return typeof v === "string" && (ADVISOR_CONSULTS as readonly string[]).includes(v);
}

/** DB の JSON を読む。形が違う項目は捨てる */
function parseStoredMessages(raw: unknown): AdvisorMessage[] {
  if (typeof raw !== "string") return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: AdvisorMessage[] = [];
  for (const x of arr(v)) {
    if (x === null || typeof x !== "object") continue;
    const m = x as Record<string, unknown>;
    if (typeof m.text !== "string" || typeof m.at !== "string") continue;
    if (m.from === "me") {
      out.push({ from: "me", text: m.text, at: m.at });
    } else if (m.from === "ai" && isConsult(m.consult)) {
      out.push({
        from: "ai",
        text: m.text,
        points: arr(m.points).filter((p): p is string => typeof p === "string"),
        consult: m.consult,
        consultNote: typeof m.consultNote === "string" ? m.consultNote : "",
        at: m.at,
        // 注記は固定の文だけを戻す（保存した JSON のほかの文は画面へ出さない）
        ...(m.caution === ASSERTIVE_CAUTION ? { caution: ASSERTIVE_CAUTION } : {}),
      });
    }
  }
  return out;
}

/**
 * 本人の会話を読む。診断と結びついた会話（diagnosis_created_at あり）は、今の有効な診断と照合し、
 * 診断が無い・違うなら返さずに消して空にする（REV-001。共有の取り消し・診断の作り直しで、古い診断をもとにした
 * AI の返事を画面にも AI 入力にも戻さない。lib/report.ts の getReportFrom と同じ考え方。消すのに失敗しても返さない）。
 * 会話を先に読み、そのあと診断を照合する（間に共有の取り消しが確定しても取り消し前の会話を返さないため。lib/report.ts と同じ順番）。
 */
async function loadChat(db: Client, demoId: string, role: Role): Promise<Stored> {
  const rs = await db.execute({
    sql: `SELECT messages, rev, diagnosis_created_at FROM advisor_chats WHERE demo_id = ? AND role = ?`,
    args: [demoId, role],
  });
  const row = rs.rows[0];
  if (!row) return EMPTY_CHAT;
  const boundTo = typeof row.diagnosis_created_at === "string" ? row.diagnosis_created_at : null;
  if (boundTo !== null) {
    const diag = await getDiagnosisFrom(db, demoId);
    if (!diag || diag.createdAt !== boundTo) {
      try {
        await db.execute({
          sql: `DELETE FROM advisor_chats WHERE demo_id = ? AND role = ? AND diagnosis_created_at = ?`,
          args: [demoId, role, boundTo],
        });
      } catch (err) {
        console.error(JSON.stringify({ level: "error", where: "advisor.invalidate", error: err instanceof Error ? err.name : "UnknownError" }));
      }
      return EMPTY_CHAT;
    }
  }
  return { messages: parseStoredMessages(row.messages), rev: Number(row.rev) };
}

function turnsOf(messages: AdvisorMessage[]): number {
  return messages.filter((m) => m.from === "me").length;
}

function toState(messages: AdvisorMessage[]): AdvisorState {
  return {
    messages,
    remainingTurns: Math.max(0, ADVISOR_MAX_TURNS - turnsOf(messages)),
    maxTurns: ADVISOR_MAX_TURNS,
    maxLength: ADVISOR_MAX_LENGTH,
  };
}

/**
 * AI を呼ぶ前に「送信中」の印を書いて予約する（SEC-A01）。予約できた後の rev を返す。
 * - 読んだときの rev のままで、印が無いか ADVISOR_PENDING_TTL_MS より古いときだけ書ける（条件つき UPDATE は原子的なので同時に来ても1つだけ）
 * - 行が無かったとき（rev 0）だけ新しく作る（既にあれば作らずに 409）。行はいつも rev 1 以上
 * - 読んだときに行があった（rev 1 以上）のに、そのあと消えていたら作り直さない（消された会話を古い履歴つきで戻さない）
 * - 予約できなければ 409（AI は呼ばない）
 */
async function reserveChat(db: Client, demoId: string, role: Role, readRev: number): Promise<number> {
  const now = Date.now();
  const at = new Date(now).toISOString();
  const staleBefore = new Date(now - ADVISOR_PENDING_TTL_MS).toISOString();
  const rs =
    readRev === 0
      ? await db.execute({
          sql: `INSERT INTO advisor_chats (demo_id, role, messages, rev, updated_at, pending_at) VALUES (?, ?, '[]', 1, ?, ?)
                ON CONFLICT(demo_id, role) DO NOTHING`,
          args: [demoId, role, at, at],
        })
      : await db.execute({
          sql: `UPDATE advisor_chats SET rev = rev + 1, pending_at = ?, updated_at = ?
                WHERE demo_id = ? AND role = ? AND rev = ? AND (pending_at IS NULL OR pending_at < ?)`,
          args: [at, at, demoId, role, readRev, staleBefore],
        });
  if (rs.rowsAffected !== 1) throw new ServiceError(409, MSG_ADVISOR_BUSY);
  return readRev + 1;
}

/** AI が失敗したとき：自分の予約（rev が予約時のまま）なら印を外す。ほかの送信が古い印を上書きしていたら何もしない */
async function releaseChat(db: Client, demoId: string, role: Role, reservedRev: number): Promise<void> {
  await db.execute({
    sql: `UPDATE advisor_chats SET pending_at = NULL, rev = rev + 1
          WHERE demo_id = ? AND role = ? AND rev = ? AND pending_at IS NOT NULL`,
    args: [demoId, role, reservedRev],
  });
}

/**
 * 予約したときの rev のままなら、会話を保存して印を外す（同時に2回送られたときの二重保存を防ぐ）。
 * UPDATE だけ（予約で行は必ずある）。予約中に「会話を消す」「デモをやり直す」で行が消えていたら保存せず false。
 *
 * 診断との結びつき（REV-001）：diagnosisAt は今回 AI に渡した診断の createdAt（渡していなければ null）。
 * - 診断を渡したら、会話をその診断に結びつける（診断なしで始めた会話も、診断を使った時点から結びつく）
 * - 会話が別の診断に結びついていたら保存しない（AI を待つ間に診断が作り直された）
 * - 渡した診断が今も有効でなければ保存しない（AI を待つ間に共有が取り消された。取り消し前の診断による返事を残さない）
 */
async function saveChat(
  db: Client,
  demoId: string,
  role: Role,
  messages: AdvisorMessage[],
  reservedRev: number,
  diagnosisAt: string | null,
): Promise<boolean> {
  const rs = await db.execute({
    sql: `UPDATE advisor_chats SET messages = ?, rev = rev + 1, updated_at = ?, pending_at = NULL,
            diagnosis_created_at = COALESCE(?, diagnosis_created_at)
          WHERE demo_id = ? AND role = ? AND rev = ?
            AND (diagnosis_created_at IS NULL OR diagnosis_created_at = ?)
            AND (? IS NULL OR EXISTS (SELECT 1 FROM diagnoses d WHERE d.demo_id = ? AND d.created_at = ?))`,
    args: [JSON.stringify(messages), nowIso(), diagnosisAt, demoId, role, reservedRev, diagnosisAt, diagnosisAt, demoId, diagnosisAt],
  });
  return rs.rowsAffected === 1;
}

export async function getAdvisorStateFrom(db: Client, demoId: string, role: Role): Promise<AdvisorState> {
  return toState((await loadChat(db, demoId, role)).messages);
}

/** 画面（サーバーコンポーネント）用。demoId・role はサーバーでクッキーから読んだ値（getSession()）を渡すこと。 */
export async function getAdvisorState(demoId: string, role: Role): Promise<AdvisorState> {
  return getAdvisorStateFrom(await getDb(), demoId, role);
}

/** 本人の会話だけを消す（相手の役割の会話・ほかのデータは消さない） */
export async function resetAdvisor(db: Client, demoId: string, role: Role): Promise<AdvisorState> {
  await db.execute({
    sql: `DELETE FROM advisor_chats WHERE demo_id = ? AND role = ?`,
    args: [demoId, role],
  });
  return toState([]);
}

// ---- AI への依頼 ----

export const ADVISOR_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    points: { type: "array", items: { type: "string" } },
    consult: { type: "string", enum: [...ADVISOR_CONSULTS] },
    consult_note: { type: "string" },
  },
  required: ["reply", "points", "consult", "consult_note"],
  additionalProperties: false,
} as const;

export type AdvisorOutput = { reply: string; points: string[]; consult: AdvisorConsult; consultNote: string };

/** AI の返事を読む。reply が空・consult が決まった値でなければ null（壊れた返事として1回だけ再送） */
export function parseAdvisorOutput(v: Record<string, unknown>): AdvisorOutput | null {
  const reply = str(v.reply, REPLY_MAX);
  if (!reply) return null;
  if (!isConsult(v.consult)) return null;
  if (!Array.isArray(v.points)) return null;
  const points = v.points
    .map((p) => str(p, POINT_MAX))
    .filter((p): p is string => !!p)
    .slice(0, POINTS_MAX);
  const consultNote = v.consult === "不要" ? "" : (str(v.consult_note, NOTE_MAX) ?? "");
  return { reply, points, consult: v.consult, consultNote };
}

/** 直近の往復だけを残す（数と文字数の上限）。先頭はいつも本人の発言にする */
export function historyWindow(messages: AdvisorMessage[]): AdvisorMessage[] {
  let win = messages.slice(-ADVISOR_HISTORY_EXCHANGES * 2);
  const size = (ms: AdvisorMessage[]) =>
    ms.reduce((n, m) => n + charLen(m.text) + (m.from === "ai" ? m.points.reduce((k, p) => k + charLen(p), 0) : 0), 0);
  while (win.length > 0 && (win[0].from !== "me" || size(win) > ADVISOR_HISTORY_MAX_CHARS)) {
    win = win.slice(1);
  }
  return win;
}

/**
 * 本人の知識レベル（REV-005）。後継者は講座で上がる learning.level（講座の質問・解説と同じ getLearningLevel）、
 * 先代は learning を持たないので役割の初期値（demo-profiles）
 */
async function advisorLevel(db: Client, demoId: string, role: Role): Promise<string> {
  return role === "successor" ? getLearningLevel(db, demoId) : DEMO_PROFILES[role].level;
}

/** 診断（共有物）のうち AI に渡す部分。保存済みの診断が無ければ null */
async function diagnosisForPrompt(db: Client, demoId: string) {
  const rec = await getDiagnosisFrom(db, demoId);
  if (!rec) return null;
  const pub = toPublicDiagnosisRecord(rec); // basedOnThemeKeys は空（SEC-103）
  return { created_at: pub.createdAt, diagnosis: pub.diagnosis };
}

/**
 * AI への依頼を組み立てる。入力は引数で渡したものだけ（DB は読まない）。
 * - system：指示文＋ <shop_financials>（計算済みの数字）＋ <shop_upside>（仮定の試算）＋ <diagnosis>（保存済みの診断。無ければ「まだ無い」）
 * - messages：本人の会話の直近の数往復＋今回の発言
 */
export function buildAdvisorRequest(params: {
  role: Role;
  history: AdvisorMessage[];
  text: string;
  diagnosis: Awaited<ReturnType<typeof diagnosisForPrompt>>;
  /** 本人の知識レベル（advisorLevel）。省略時は役割の初期値 */
  level?: string;
}): JsonAiRequest {
  const profile = DEMO_PROFILES[params.role];
  const system = [
    fillTemplate(ADVISOR_SYSTEM_TEMPLATE, {
      role: profile.roleLabel,
      level: params.level ?? profile.level,
      company_context: COMPANY_CONTEXT,
    }),
    // 共通の注意書き（lib/ai/json-ai.ts）に、AI参謀だけの行をつなぐ。データは system の下のタグに入れる
    dataNote("この指示文の下の <...> タグの中（お店の数字・試算・診断）", [
      "診断は、先代と後継者の二人が共有した内容から作られたものです。診断が無いときは、数字だけで答えてください。",
      "<shop_upside> は仮定の試算です。実現を保証しません。「この策が正解」と断定せず、前提条件と選択肢として扱ってください。",
    ]),
    dataBlock("shop_financials", financialsForPrompt()),
    dataBlock("shop_upside", upsideForPrompt()),
    dataBlock("diagnosis", params.diagnosis ?? "まだ診断はありません"),
  ].join("\n\n");

  const messages: JsonAiMessage[] = historyWindow(params.history).map((m) =>
    m.from === "me"
      ? { role: "user", content: m.text }
      : {
          role: "assistant",
          content: JSON.stringify({ reply: m.text, points: m.points, consult: m.consult, consult_note: m.consultNote }),
        },
  );
  messages.push({ role: "user", content: params.text });

  return {
    purpose: "advisor",
    system,
    messages,
    schema: ADVISOR_SCHEMA as unknown as Record<string, unknown>,
    maxTokens: ADVISOR_MAX_TOKENS,
    budgetMs: ADVISOR_AI_BUDGET_MS,
  };
}

/**
 * 本人の相談を送り、AI の返事と一緒に保存する。AI が失敗したら（429・502）本人の発言も保存しない。
 * 送信中の印を予約できなければ（同時送信）AI を呼ばずに 409。
 */
export async function sendAdvisorMessage(
  deps: AiDeps,
  demoId: string,
  role: Role,
  rawText: unknown,
): Promise<AdvisorState> {
  const text = validateAdvisorText(rawText);
  const chat = await loadChat(deps.db, demoId, role);
  if (turnsOf(chat.messages) >= ADVISOR_MAX_TURNS) throw new ServiceError(400, MSG_ADVISOR_TURN_LIMIT);

  const myAt = nowIso();
  const diagnosis = await diagnosisForPrompt(deps.db, demoId);
  const req = buildAdvisorRequest({
    role,
    history: chat.messages,
    text,
    diagnosis,
    level: await advisorLevel(deps.db, demoId, role),
  });

  // 読んだ rev のまま予約できたときだけ AI を呼ぶ（chat.messages は予約の時点でも同じ内容）
  const reservedRev = await reserveChat(deps.db, demoId, role, chat.rev);
  const release = async () => {
    try {
      await releaseChat(deps.db, demoId, role, reservedRev);
    } catch {
      // 印を外せなくても、ADVISOR_PENDING_TTL_MS で無視されるようになる。元のエラーを返す
    }
  };
  let out: AdvisorOutput;
  try {
    out = await callJsonAi(deps, demoId, role, req, parseAdvisorOutput);
  } catch (err) {
    await release();
    throw err;
  }

  // 言い切りに見える表現があれば固定の注記を足す（返事は変えない。ログは種類だけ。SEC-A02）
  const caution = cautionFor("advisor.message", [out.reply, ...out.points, out.consultNote]);
  const messages: AdvisorMessage[] = [
    ...chat.messages,
    { from: "me", text, at: myAt },
    {
      from: "ai",
      text: out.reply,
      points: out.points,
      consult: out.consult,
      consultNote: out.consultNote,
      at: nowIso(),
      ...(caution ? { caution } : {}),
    },
  ];
  if (!(await saveChat(deps.db, demoId, role, messages, reservedRev, diagnosis?.created_at ?? null))) {
    await release();
    throw new ServiceError(409, MSG_CONFLICT);
  }
  return toState(messages);
}
