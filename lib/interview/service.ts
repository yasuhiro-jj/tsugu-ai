// AI 面談の進行ロジック（Next.js に依存しない。テストから DB と AI を差し替えて呼べる）。
//
// 守ること：
// - 読み書きは必ず (demoId, role) で絞る。相手の役割のデータは読まない
// - Claude に渡すのは「今のテーマの会話すべて」＋「終わったテーマのうち本人が確定した要約」だけ
//   （discarded の要約・相手の会話や要約・決算の具体的な数字は渡さない）
// - テーマの移動はアプリが行う（本人が要約を確定／破棄した時点）
// - AI の返事が壊れていたら同じ依頼を一度だけ再送。だめなら 502（入力文は保存しない）

import type { Client } from "@libsql/client";
import { THEMES, themeLabel, type ThemeKey } from "../themes";
import type {
  ChatMessage,
  InterviewState,
  MyTheme,
  ThemeSummary,
} from "../interview-types";
import type { Role } from "../role";
import { ServiceError } from "../errors";
import { COMPANY_CONTEXT, DEMO_PROFILES } from "../demo-profiles";
import {
  INTERVIEW_SYSTEM_TEMPLATE,
  REPLY_EXAMPLES,
  ROLE_INSTRUCTIONS,
  FOLLOWUP_LIMIT,
  buildAppNotes,
  fillTemplate,
} from "../prompts/interview";
import {
  isSummaryEmpty,
  normalizeAiSummary,
  validateDecision,
  validateMessageText,
  validateShared,
  validateSummary,
  validateThemeKey,
} from "../validation";
import {
  deleteDemoData,
  ensureInterviewRows,
  loadRecords,
  reserveAiCall,
  saveRecord,
  setCurrentTheme,
  type ThemeRecord,
} from "./store";

// ---- AI 呼び出しの差し替え口 ----

export type AiMessage = { role: "user" | "assistant"; content: string };
export type AiRequest = { system: string; messages: AiMessage[] };
/** AI に依頼して、返ってきた文字列（JSON のはず）を返す。テストでは偽物に差し替える。 */
export type InterviewAi = (req: AiRequest) => Promise<string>;

export type Deps = { db: Client; ai: InterviewAi };

export type AiAction = "followup" | "summarize" | "next_theme" | "finish";
export type AiOutput = { reply: string; action: AiAction; summary: ThemeSummary };

const ACTIONS: readonly AiAction[] = ["followup", "summarize", "next_theme", "finish"];
const REPLY_MAX_CHARS = 2000;
/** 1テーマの会話の上限（AI が要約に進まない場合の保険） */
const MAX_MESSAGES_PER_THEME = 30;

export const MSG_AI_FAILED = "少し時間をおいてもう一度送ってください";

const DONE: ReadonlySet<string> = new Set(["confirmed", "discarded"]);

// ---- 状態 ----

function currentThemeOf(records: Map<ThemeKey, ThemeRecord>): ThemeKey | null {
  for (const t of THEMES) {
    if (!DONE.has(records.get(t.key)!.status)) return t.key;
  }
  return null;
}

export function toState(role: Role, records: Map<ThemeKey, ThemeRecord>): InterviewState {
  const profile = DEMO_PROFILES[role];
  const themes: MyTheme[] = THEMES.map((t) => {
    const r = records.get(t.key)!;
    return {
      key: t.key,
      label: t.label,
      status: r.status,
      shared: r.status === "confirmed" ? r.shared : null,
      summary:
        r.status === "awaiting_confirmation" || r.status === "confirmed" ? r.summary : null,
    };
  });
  const current = currentThemeOf(records);
  const pending = THEMES.find((t) => {
    const r = records.get(t.key)!;
    return r.status === "confirmed" && r.shared === null;
  });
  return {
    role,
    displayName: profile.name,
    partnerLabel: profile.partnerLabel,
    themes,
    currentThemeKey: current,
    messages: current ? records.get(current)!.messages : [],
    pendingShareThemeKey: pending ? pending.key : null,
    finished: current === null,
  };
}

export async function getInterviewState(
  db: Client,
  demoId: string,
  role: Role,
): Promise<InterviewState> {
  return toState(role, await loadRecords(db, demoId, role));
}

// ---- Claude に渡す内容の組み立て ----

function kickoffText(themeKey: ThemeKey): string {
  const first = themeKey === THEMES[0].key;
  return (
    `（アプリより）テーマ「${themeLabel(themeKey)}」の面談を始めます。` +
    (first ? "最初のテーマなので、短いあいさつのあとに、" : "") +
    "このテーマの最初の問いかけをしてください。"
  );
}

const FORCE_SUMMARIZE_TEXT =
  "（アプリより）このテーマを要約して、action を summarize で返してください。reply では、要約を確認してもらう短い一言を添えてください。";

/**
 * 今の面談相手の records だけから system と messages を組み立てる。
 * records は呼び出し側が (demoId, role) で読んだものだけを渡すこと。
 */
export function buildInterviewRequest(params: {
  role: Role;
  records: Map<ThemeKey, ThemeRecord>;
  themeKey: ThemeKey;
  pendingUserText?: string;
}): AiRequest {
  const { role, records, themeKey } = params;
  const profile = DEMO_PROFILES[role];
  const rec = records.get(themeKey)!;
  const theme = THEMES.find((t) => t.key === themeKey)!;

  const remaining = THEMES.filter(
    (t) => t.key !== themeKey && !DONE.has(records.get(t.key)!.status),
  ).map((t) => t.label);

  const confirmed = THEMES.filter((t) => {
    const r = records.get(t.key)!;
    return t.key !== themeKey && r.status === "confirmed" && r.summary !== null;
  }).map((t) => `\n  - ${t.label}：${JSON.stringify(records.get(t.key)!.summary)}`);

  const system = [
    fillTemplate(INTERVIEW_SYSTEM_TEMPLATE, {
      role: profile.roleLabel,
      name: profile.name,
      route: profile.route,
      level: profile.level,
      company_context: COMPANY_CONTEXT,
      current_theme: `${theme.label}（${theme.hint}）`,
      followup_count: String(rec.followupCount),
      remaining_themes: remaining.length ? remaining.join("、") : "なし",
    }),
    ROLE_INSTRUCTIONS[role],
    REPLY_EXAMPLES,
    buildAppNotes({
      followupCount: rec.followupCount,
      confirmedSummaries: confirmed.length ? confirmed.join("") : "なし",
    }),
  ].join("\n\n");

  // Claude API は user から始める必要があるため、最初にアプリからの開始依頼を置く。
  const messages: AiMessage[] = [{ role: "user", content: kickoffText(themeKey) }];
  for (const m of rec.messages) {
    messages.push({ role: m.from === "me" ? "user" : "assistant", content: m.text });
  }
  if (params.pendingUserText !== undefined) {
    messages.push({ role: "user", content: params.pendingUserText });
  }
  return { system, messages };
}

/** AI の返事（文字列）を JSON として読み、形を確かめる。だめなら null。 */
export function parseAiOutput(raw: string): AiOutput | null {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let v: unknown;
  try {
    v = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.reply !== "string") return null;
  const reply = o.reply.trim();
  if (!reply || Array.from(reply).length > REPLY_MAX_CHARS) return null;
  if (!ACTIONS.includes(o.action as AiAction)) return null;
  return { reply, action: o.action as AiAction, summary: normalizeAiSummary(o.summary) };
}

/** AI を1回呼ぶ（回数を予約してから）。壊れた返事なら同じ依頼を一度だけ再送。 */
async function callAi(deps: Deps, demoId: string, role: Role, req: AiRequest): Promise<AiOutput> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await reserveAiCall(deps.db, demoId, role);
    let raw: string;
    try {
      raw = await deps.ai(req);
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      const name = err instanceof Error ? err.name : "UnknownError";
      const status =
        err && typeof err === "object" && "status" in err ? String((err as { status: unknown }).status) : "-";
      // 入力本文・SDK のエラー本文はログに出さない
      console.error(JSON.stringify({ level: "error", where: "interview.ai", error: name, status }));
      throw new ServiceError(502, MSG_AI_FAILED);
    }
    const parsed = parseAiOutput(raw);
    if (parsed) return parsed;
    console.warn(JSON.stringify({ level: "warn", where: "interview.ai", event: "invalid_json", attempt }));
  }
  throw new ServiceError(502, MSG_AI_FAILED);
}

async function loadForWrite(db: Client, demoId: string, role: Role) {
  await ensureInterviewRows(db, demoId, role);
  return loadRecords(db, demoId, role);
}

// ---- 操作 ----

/** 今のテーマの会話が空なら、最初の問いかけを AI に作らせて保存する。 */
export async function startInterview(deps: Deps, demoId: string, role: Role): Promise<InterviewState> {
  const records = await loadForWrite(deps.db, demoId, role);
  const themeKey = currentThemeOf(records);
  if (themeKey === null) return toState(role, records);
  const rec = records.get(themeKey)!;
  if (rec.messages.length > 0 || rec.status !== "not_started") return toState(role, records);

  const out = await callAi(deps, demoId, role, buildInterviewRequest({ role, records, themeKey }));
  const updated: ThemeRecord = {
    ...rec,
    messages: [{ from: "ai", text: out.reply }],
    status: "in_progress",
  };
  await saveRecord(deps.db, demoId, role, updated, rec.rev);
  await setCurrentTheme(deps.db, demoId, role, themeKey);
  records.set(themeKey, { ...updated, rev: rec.rev + 1 });
  return toState(role, records);
}

/** 本人のメッセージを送り、AI の返事を保存する。AI が失敗したら入力文は保存しない。 */
export async function sendMessage(
  deps: Deps,
  demoId: string,
  role: Role,
  rawText: unknown,
): Promise<InterviewState> {
  const text = validateMessageText(rawText);
  const records = await loadForWrite(deps.db, demoId, role);
  const themeKey = currentThemeOf(records);
  if (themeKey === null) throw new ServiceError(409, "面談はすべて終わっています");
  const rec = records.get(themeKey)!;
  if (rec.status === "awaiting_confirmation") {
    throw new ServiceError(409, "先に要約を確認してください");
  }
  if (rec.messages.length === 0) throw new ServiceError(409, "先に面談を始めてください");
  if (rec.messages.length >= MAX_MESSAGES_PER_THEME) {
    throw new ServiceError(
      409,
      "このテーマの会話が長くなりました。いったん「このテーマは保存しない」を選んで次へ進んでください",
    );
  }

  const req = buildInterviewRequest({ role, records, themeKey, pendingUserText: text });
  let out = await callAi(deps, demoId, role, req);

  const wantsEnd = out.action !== "followup";
  const overLimit = out.action === "followup" && rec.followupCount >= FOLLOWUP_LIMIT;
  if ((wantsEnd && isSummaryEmpty(out.summary)) || overLimit) {
    // 要約が無いまま終わろうとした／深掘りの上限を超えた → 一度だけ要約を依頼し直す
    const retryReq: AiRequest = {
      system: req.system,
      messages: [
        ...req.messages,
        { role: "assistant", content: JSON.stringify(out) },
        { role: "user", content: FORCE_SUMMARIZE_TEXT },
      ],
    };
    out = await callAi(deps, demoId, role, retryReq);
  }

  const messages: ChatMessage[] = [
    ...rec.messages,
    { from: "me", text },
    { from: "ai", text: out.reply },
  ];
  let updated: ThemeRecord;
  if (out.action !== "followup" && !isSummaryEmpty(out.summary)) {
    // summarize（または要約つきの next_theme / finish）→ 下書きとして本人の確認待ち
    updated = { ...rec, messages, status: "awaiting_confirmation", summary: out.summary };
  } else {
    updated = {
      ...rec,
      messages,
      status: "in_progress",
      followupCount: out.action === "followup" ? rec.followupCount + 1 : rec.followupCount,
    };
  }
  await saveRecord(deps.db, demoId, role, updated, rec.rev);
  records.set(themeKey, { ...updated, rev: rec.rev + 1 });
  return toState(role, records);
}

/** 要約の確定／破棄。確定・破棄したら次の未着手テーマへ移る。 */
export async function decideSummary(
  db: Client,
  demoId: string,
  role: Role,
  body: Record<string, unknown>,
): Promise<InterviewState> {
  const themeKey = validateThemeKey(body.themeKey);
  const decision = validateDecision(body.decision);
  const edited =
    decision === "confirm" && body.summary !== undefined ? validateSummary(body.summary) : undefined;

  const records = await loadForWrite(db, demoId, role);
  const rec = records.get(themeKey)!;
  const current = currentThemeOf(records);

  let updated: ThemeRecord;
  if (decision === "confirm") {
    if (rec.status !== "awaiting_confirmation" || rec.summary === null) {
      throw new ServiceError(409, "このテーマには確認待ちの要約がありません");
    }
    const summary = edited ?? rec.summary;
    updated = { ...rec, status: "confirmed", summary, shared: null };
  } else {
    // 破棄は今のテーマ（面談中または確認待ち）だけ。会話と要約は残さない
    if (themeKey !== current || DONE.has(rec.status)) {
      throw new ServiceError(409, "このテーマは今は保存しない扱いにできません");
    }
    updated = { ...rec, status: "discarded", summary: null, shared: null, messages: [] };
  }
  await saveRecord(db, demoId, role, updated, rec.rev);
  records.set(themeKey, { ...updated, rev: rec.rev + 1 });
  await setCurrentTheme(db, demoId, role, currentThemeOf(records));
  return toState(role, records);
}

/** 共有の選択（confirmed のテーマだけ。何度でも変更可） */
export async function setShared(
  db: Client,
  demoId: string,
  role: Role,
  body: Record<string, unknown>,
): Promise<InterviewState> {
  const themeKey = validateThemeKey(body.themeKey);
  const shared = validateShared(body.shared);
  const records = await loadForWrite(db, demoId, role);
  const rec = records.get(themeKey)!;
  if (rec.status !== "confirmed") {
    throw new ServiceError(409, "確定した要約だけ共有を選べます");
  }
  const updated: ThemeRecord = { ...rec, shared };
  await saveRecord(db, demoId, role, updated, rec.rev);
  records.set(themeKey, { ...updated, rev: rec.rev + 1 });
  return toState(role, records);
}

/** このデモ用 ID のデータを全部消して、今の役割の初期状態を返す。 */
export async function resetDemo(db: Client, demoId: string, role: Role): Promise<InterviewState> {
  await deleteDemoData(db, demoId);
  return getInterviewState(db, demoId, role);
}
