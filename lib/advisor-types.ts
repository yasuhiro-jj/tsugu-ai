// AI参謀チャットで画面とサーバーがやりとりするデータの形（画面からも import してよい。server-only は付けない）。
// 会話は本人（デモ用 ID ＋役割）だけのもの。相手の役割には内容も「会話があること」も返さない（lib/advisor.ts）。

import type { Grounding } from "./plan-types";

/** 相談先の仕分け。「不要」は今回の質問では専門家に確認するほどのことが無いという意味 */
export type AdvisorConsult = "不要" | "銀行" | "税理士" | "その他の専門家";

export type AdvisorMessage =
  | { from: "me"; text: string; at: string }
  | {
      from: "ai";
      text: string;
      points: string[];
      consult: AdvisorConsult;
      consultNote: string;
      at: string;
      /** AI の返事に言い切りに見える表現があったときの固定の注記（lib/assertive.ts）。返事そのものは変えない */
      caution?: string;
      /**
       * 出典（web: true で送った相談への返事だけ。検索で見つかった・返事に引用したページ。重複なし・最大8件）。
       * kind は "public"＝公的機関、"private"＝民間サービス（ドメインから判定）。許可した11件のドメイン以外は入らない。
       * 次の相談で AI に渡す履歴には入れない（本文だけを渡す）
       */
      sources?: { url: string; title: string; kind: "public" | "private" }[];
      /** web: true で送った相談への返事のとき、検索が実行され結果を受け取れたか（web でない返事には付かない） */
      searched?: boolean;
      /**
       * 根拠の照合（lib/grounding.ts）。お店の数字・診断・本人の発言・出典の文に無い数字が返事にあったときだけ付く。
       * 画面は groundingNotice(grounding) の決まった文を出す。返事そのものは変えない。次の相談で AI に渡す履歴には入れない
       */
      grounding?: Grounding;
      /**
       * web: true の返事で、検索の言葉から会社名・名前・金額・連絡先を伏せたときだけ付く決まった文
       * （「検索では会社名・名前・金額などを伏せて調べました」。lib/ai/search-query.ts の SEARCH_QUERY_NOTE）
       */
      searchQueryNote?: string;
    };

export type AdvisorState = {
  messages: AdvisorMessage[];
  /** 本人があと何回話せるか */
  remainingTurns: number;
  maxTurns: number;
  /** 1回の発言の文字数の上限 */
  maxLength: number;
};

/** 本人の発言の上限（1役割あたり。「会話を消す」で会話を消すと、また20回話せる） */
export const ADVISOR_MAX_TURNS = 20;
export const ADVISOR_MAX_LENGTH = 1000;

export const ADVISOR_CONSULTS: readonly AdvisorConsult[] = ["不要", "銀行", "税理士", "その他の専門家"];

/** 最初に出す質問の例（食事処 つぐみ（架空）の決算の数字に合わせる） */
export const ADVISOR_SUGGESTIONS: string[] = [
  "手元のお金はあと何か月もちますか？",
  "当期が赤字になった理由を、数字から整理してください",
  "原価率と人件費率を下げるには、どんな選択肢がありますか？",
  "借入の返済について、銀行に何を相談すればよいですか？",
];
