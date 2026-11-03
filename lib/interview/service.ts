import "server-only";

// AI 面談の進行ロジック（Next.js に依存しない。テストから DB と AI を差し替えて呼べる）。
//
// 守ること：
// - 読み書きは必ず (demoId, role) で絞る。相手の役割のデータは読まない
// - Claude に渡すのは「今のテーマの会話すべて」＋「終わったテーマのうち本人が確定した要約」だけ
//   （discarded の要約・相手の会話や要約・決算の具体的な数字は渡さない）
// - テーマの移動はアプリが行う（本人が要約を確定／破棄した時点）
// - AI の返事が壊れていたら同じ依頼を一度だけ再送。一時的な失敗（接続エラー・429/5xx/529）も一度だけ再送
//   （lib/ai/retry.ts。再送も reserveAiCall で数える）。だめなら 502（入力文は保存しない）
// - 1回の利用者操作で AI に使う時間は INTERVIEW_AI_BUDGET_MS まで（Route の maxDuration 60 秒より短く）
// - 1回の利用者操作あたりの AI 呼び出しは最大6回（SEC-204）：
//   callAiWithRetry 1回あたり最大3回（初回＋一時エラーの再送1回＋壊れた返事の再送1回）×
//   sendMessage の callAi 最大2回（通常の返事＋要約の依頼し直し）。startInterview は最大3回。
//   どの回も reserveAiCall で数え、時間の予算が足りなければ予約せずに止める

import type { Client } from "@libsql/client";
import { THEMES, themeLabel, type ThemeKey } from "../themes";
import type {
  ChatMessage,
  InterviewState,
  MyTheme,
  RevokeImpact,
  ThemeSummary,
} from "../interview-types";
import type { Role } from "../role";
import { ServiceError } from "../errors";
import { DEMO_PROFILES } from "../demo-profiles";
import type { CompanySettings } from "../settings-types";
import { TSUGUMI_SETTINGS } from "../industry-presets";
import { getCompanySettingsFrom } from "../company-settings";
import { companyContextFor, currentThemeFor, displayNameFor, profileFor, themeListFor } from "../settings-prompt";
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
  saveRecord,
  saveRecordStatement,
  MSG_CONFLICT,
  setCurrentTheme,
  type ThemeRecord,
} from "./store";
import { invalidateDiagnosisStatements } from "../plan-store";
import { callAiWithRetry, realSleep } from "../ai/retry";
import { dataBlock, extractJsonObject } from "../ai/json-ai";

// ---- AI 呼び出しの差し替え口 ----

export type AiMessage = { role: "user" | "assistant"; content: string };
export type AiRequest = { system: string; messages: AiMessage[] };
/**
 * AI に依頼して、返ってきた文字列（JSON のはず）を返す。テストでは偽物に差し替える。
 * opts.timeoutMs はこの1回の待ち時間の上限（残り時間から service が渡す）。
 */
export type InterviewAi = (req: AiRequest, opts?: { timeoutMs?: number }) => Promise<string>;

export type Deps = {
  db: Client;
  ai: InterviewAi;
  /** テスト用の時計 */
  now?: () => number;
  /** テスト用の待ち（一時エラーの再送前の待ち時間） */
  sleep?: (ms: number) => Promise<void>;
};

/** 1回の利用者操作（開始・送信）で AI に使ってよい時間。Route の maxDuration（60 秒）より短く */
export const INTERVIEW_AI_BUDGET_MS = 50_000;

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

/** 何も消えないときの revokeImpact */
export const NO_REVOKE_IMPACT: RevokeImpact = {
  diagnosis: false,
  learningPlanWithDiagnosis: false,
  actionPlan: false,
  report: false,
  myAdvisorChat: false,
};

/**
 * 共有を取り消すと消えるもの（invalidateDiagnosisStatements と同じ範囲）のうち、今このデモ用 ID にあるもの。
 * すべて demo_id で絞る。AI参謀の会話は本人の役割の分だけ（相手の会話の有無は返さない）。
 * 学習プランは今のプラン（current_plan）が診断を使ったものかだけを見る
 */
export async function getRevokeImpact(db: Client, demoId: string, role: Role): Promise<RevokeImpact> {
  const rs = await db.execute({
    sql: `SELECT
            EXISTS (SELECT 1 FROM diagnoses WHERE demo_id = ?) AS diagnosis,
            EXISTS (SELECT 1 FROM learning WHERE demo_id = ? AND current_plan IS NOT NULL
                      AND json_valid(current_plan) AND json_extract(current_plan, '$.usedDiagnosis') = 1) AS learning_plan,
            EXISTS (SELECT 1 FROM action_plans WHERE demo_id = ?) AS action_plan,
            EXISTS (SELECT 1 FROM reports WHERE demo_id = ?) AS report,
            EXISTS (SELECT 1 FROM advisor_chats WHERE demo_id = ? AND role = ? AND diagnosis_created_at IS NOT NULL) AS my_chat`,
    args: [demoId, demoId, demoId, demoId, demoId, role],
  });
  const r = rs.rows[0];
  if (!r) return { ...NO_REVOKE_IMPACT };
  return {
    diagnosis: Number(r.diagnosis) === 1,
    learningPlanWithDiagnosis: Number(r.learning_plan) === 1,
    actionPlan: Number(r.action_plan) === 1,
    report: Number(r.report) === 1,
    myAdvisorChat: Number(r.my_chat) === 1,
  };
}

/** toState に revokeImpact を DB から読んで付ける */
async function stateFor(
  db: Client,
  demoId: string,
  role: Role,
  records: Map<ThemeKey, ThemeRecord>,
  settings: CompanySettings,
): Promise<InterviewState> {
  return toState(role, records, settings, await getRevokeImpact(db, demoId, role));
}

export function toState(
  role: Role,
  records: Map<ThemeKey, ThemeRecord>,
  settings: CompanySettings = TSUGUMI_SETTINGS,
  revokeImpact: RevokeImpact = NO_REVOKE_IMPACT,
): InterviewState {
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
    displayName: displayNameFor(settings, role),
    partnerLabel: profile.partnerLabel,
    themes,
    currentThemeKey: current,
    messages: current ? records.get(current)!.messages : [],
    pendingShareThemeKey: pending ? pending.key : null,
    finished: current === null,
    // records は本人の役割の行だけ（loadRecords が demo_id と role で絞る）なので、相手の会話は入らない
    history: THEMES.filter((t) => records.get(t.key)!.status === "confirmed").map((t) => ({
      key: t.key,
      label: t.label,
      messages: records.get(t.key)!.messages,
    })),
    revokeImpact: { ...revokeImpact },
  };
}

export async function getInterviewState(
  db: Client,
  demoId: string,
  role: Role,
): Promise<InterviewState> {
  return stateFor(db, demoId, role, await loadRecords(db, demoId, role), await getCompanySettingsFrom(db, demoId));
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
  /** 会社の設定（省略時はつぐみの初期値）。名前・関係・知識レベル・概要・テーマの補足をここから */
  settings?: CompanySettings;
}): AiRequest {
  const { role, records, themeKey } = params;
  const settings = params.settings ?? TSUGUMI_SETTINGS;
  const profile = profileFor(settings, role);
  const rec = records.get(themeKey)!;

  const remaining = THEMES.filter(
    (t) => t.key !== themeKey && !DONE.has(records.get(t.key)!.status),
  ).map((t) => t.label);

  const confirmed = THEMES.filter((t) => {
    const r = records.get(t.key)!;
    return t.key !== themeKey && r.status === "confirmed" && r.summary !== null;
  }).map((t) => ({ theme: t.label, summary: records.get(t.key)!.summary }));

  const system = [
    fillTemplate(INTERVIEW_SYSTEM_TEMPLATE, {
      role: profile.roleLabel,
      name: profile.name,
      route: profile.route,
      level: profile.level,
      company_context: companyContextFor(settings),
      current_theme: currentThemeFor(settings, themeKey),
      theme_list: themeListFor(settings),
      followup_count: String(rec.followupCount),
      remaining_themes: remaining.length ? remaining.join("、") : "なし",
    }),
    ROLE_INSTRUCTIONS[role],
    REPLY_EXAMPLES,
    buildAppNotes({
      followupCount: rec.followupCount,
      confirmedSummaries: dataBlock("confirmed_summaries", confirmed),
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

/** AI の返事（文字列）を JSON として読み、形を確かめる。だめなら null。JSON の取り出しは JSON 系と共通。 */
export function parseAiOutput(raw: string): AiOutput | null {
  const o = extractJsonObject(raw);
  if (!o) return null;
  if (typeof o.reply !== "string") return null;
  const reply = o.reply.trim();
  if (!reply || Array.from(reply).length > REPLY_MAX_CHARS) return null;
  if (!ACTIONS.includes(o.action as AiAction)) return null;
  return { reply, action: o.action as AiAction, summary: normalizeAiSummary(o.summary) };
}

/**
 * AI を呼ぶ（毎回、回数を予約してから）。壊れた返事・一時的な失敗のときはそれぞれ一度だけ再送。
 * startedAt は利用者操作の開始時刻（同じ操作で2回呼ぶときも時間の予算を共有する）。
 */
async function callAi(
  deps: Deps,
  demoId: string,
  role: Role,
  req: AiRequest,
  startedAt: number,
): Promise<AiOutput> {
  return callAiWithRetry({
    db: deps.db,
    demoId,
    role,
    where: "interview.ai",
    budgetMs: INTERVIEW_AI_BUDGET_MS,
    startedAt,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? realSleep,
    call: (timeoutMs) => deps.ai(req, { timeoutMs }),
    parse: parseAiOutput,
    failMessage: MSG_AI_FAILED,
  });
}

/** 自分の面談の行（無ければ作る）と、会社の設定（二人の共有物。面談の指示文と表示名に使う）を読む */
async function loadForWrite(db: Client, demoId: string, role: Role) {
  await ensureInterviewRows(db, demoId, role);
  const [records, settings] = await Promise.all([loadRecords(db, demoId, role), getCompanySettingsFrom(db, demoId)]);
  return { records, settings };
}

// ---- 操作 ----

/** 今のテーマの会話が空なら、最初の問いかけを AI に作らせて保存する。 */
export async function startInterview(deps: Deps, demoId: string, role: Role): Promise<InterviewState> {
  const startedAt = (deps.now ?? Date.now)();
  const { records, settings } = await loadForWrite(deps.db, demoId, role);
  const themeKey = currentThemeOf(records);
  if (themeKey === null) return stateFor(deps.db, demoId, role, records, settings);
  const rec = records.get(themeKey)!;
  if (rec.messages.length > 0 || rec.status !== "not_started") return stateFor(deps.db, demoId, role, records, settings);

  const out = await callAi(deps, demoId, role, buildInterviewRequest({ role, records, themeKey, settings }), startedAt);
  const updated: ThemeRecord = {
    ...rec,
    messages: [{ from: "ai", text: out.reply }],
    status: "in_progress",
  };
  await saveRecord(deps.db, demoId, role, updated, rec.rev);
  await setCurrentTheme(deps.db, demoId, role, themeKey);
  records.set(themeKey, { ...updated, rev: rec.rev + 1 });
  return stateFor(deps.db, demoId, role, records, settings);
}

/** 本人のメッセージを送り、AI の返事を保存する。AI が失敗したら入力文は保存しない。 */
export async function sendMessage(
  deps: Deps,
  demoId: string,
  role: Role,
  rawText: unknown,
): Promise<InterviewState> {
  const startedAt = (deps.now ?? Date.now)();
  const text = validateMessageText(rawText);
  const { records, settings } = await loadForWrite(deps.db, demoId, role);
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

  const req = buildInterviewRequest({ role, records, themeKey, pendingUserText: text, settings });
  let out = await callAi(deps, demoId, role, req, startedAt);

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
    out = await callAi(deps, demoId, role, retryReq, startedAt);
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
  return stateFor(deps.db, demoId, role, records, settings);
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

  const { records, settings } = await loadForWrite(db, demoId, role);
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
  return stateFor(db, demoId, role, records, settings);
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
  const { records, settings } = await loadForWrite(db, demoId, role);
  const rec = records.get(themeKey)!;
  if (rec.status !== "confirmed") {
    throw new ServiceError(409, "確定した要約だけ共有を選べます");
  }
  const updated: ThemeRecord = { ...rec, shared };
  // 共有を取り消すときは、shared の保存と「診断と派生物（90日計画・診断を使った学習プラン）の削除」を
  // 1つのトランザクション（db.batch）で行う。片方だけ成功して取り消した内容が派生物に残ることを防ぐ（SEC-101）
  const stmts = [saveRecordStatement(demoId, role, updated, rec.rev)];
  if (rec.shared === true && !shared) stmts.push(...invalidateDiagnosisStatements(demoId));
  const results = await db.batch(stmts, "write");
  if (results[0].rowsAffected !== 1) {
    // rev が合わなかった（ほかの操作と重なった）。共有状態は変わっていない。
    // 同じ batch の削除は実行済みだが、派生物を消す方向なので安全側（作り直せばよい）
    throw new ServiceError(409, MSG_CONFLICT);
  }
  records.set(themeKey, { ...updated, rev: rec.rev + 1 });
  return stateFor(db, demoId, role, records, settings);
}

/** このデモ用 ID のデータを全部消して、今の役割の初期状態を返す。 */
export async function resetDemo(db: Client, demoId: string, role: Role): Promise<InterviewState> {
  await deleteDemoData(db, demoId);
  return getInterviewState(db, demoId, role);
}
