/**
 * Web Speech API（音声認識）の最小限の型。
 * TypeScript の標準の型に無い環境（webkit 接頭辞つきなど）でも使えるよう、ここで必要な分だけ定義する。
 * 標準の型と名前がぶつからないよう、Voice〜 という名前にしている。
 */

export interface VoiceRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

export interface VoiceRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: VoiceRecognitionAlternative;
}

export interface VoiceRecognitionResultList {
  readonly length: number;
  readonly [index: number]: VoiceRecognitionResult;
}

export interface VoiceRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: VoiceRecognitionResultList;
}

export interface VoiceRecognitionErrorEvent extends Event {
  /** 例："not-allowed" / "service-not-allowed" / "no-speech" / "audio-capture" / "network" / "aborted" */
  readonly error: string;
}

export interface VoiceRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((ev: Event) => void) | null;
  onresult: ((ev: VoiceRecognitionEvent) => void) | null;
  onerror: ((ev: VoiceRecognitionErrorEvent) => void) | null;
  onend: ((ev: Event) => void) | null;
}

export type VoiceRecognitionConstructor = new () => VoiceRecognition;

/** ブラウザに音声認識があればその作り方を返す。無ければ（サーバー側・Firefox など）null */
export function getRecognitionConstructor(): VoiceRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: VoiceRecognitionConstructor;
    webkitSpeechRecognition?: VoiceRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
