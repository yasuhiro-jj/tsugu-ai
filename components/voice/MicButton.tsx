"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  getRecognitionConstructor,
  type VoiceRecognition,
  type VoiceRecognitionErrorEvent,
  type VoiceRecognitionEvent,
} from "./speech-types";
import VolumeMeter from "./VolumeMeter";
import { correctTranscript } from "./corrections";
import styles from "./MicButton.module.css";

type Props = {
  /** 入力欄に足す文（確定した結果と、止めたときに残っていた途中の文）。途中の結果は随時には渡さない */
  onText: (text: string) => void;
  /** 送信中・AI の返事待ちなど、押せないとき true。聞き取り中に true になったら止める */
  disabled?: boolean;
  /** 周りのボタンが小さいとき "small"（.button--small をそろえて付ける） */
  size?: "normal" | "small";
  /** 入力欄に文字があるか（［もう一度話す］を出すかどうかに使う） */
  hasText?: boolean;
  /** 入力欄を空にする。渡したときだけ［もう一度話す］を出す */
  onClear?: () => void;
};

const REDO_HELP = "入力欄を空にして、最初から話し直せます";
const REDO_CONFIRM = "入力欄の文を消して、最初から話し直しますか？";

const MIC_DENIED = "マイクが使えませんでした。ブラウザの設定でマイクを許可してください。";
const STOPPED = "聞き取りが止まりました。もう一度押してください。";

/** 起き直しても意味のないエラー（これが出たら自動でやり直さない） */
const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture", "network"]);

function errorMessage(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return MIC_DENIED;
    case "audio-capture":
      return "マイクが見つかりませんでした。マイクのつながりを確かめてください。";
    case "no-speech":
      return "聞き取れませんでした。もう一度押して、話してください。";
    case "network":
      return "音声を文字にするサービスにつながりませんでした（Edge はマイクロソフト、Chrome は Google のサーバーを使います）。";
    case "aborted":
      return null; // こちらから止めたとき
    default:
      return "音声入力がうまくいきませんでした。もう一度お試しいただくか、文字で入力してください。";
  }
}

/**
 * マイクで話した内容を文字にするボタン（ブラウザの Web Speech API を使う）。
 * 音声認識が無いブラウザでは何も表示しない。サーバー描画との食い違いを避けるため、
 * 対応しているかは画面がブラウザで動き始めてから調べる。
 *
 * 途中の結果はボタンの近くに灰色で見せるだけで、入力欄には確定してから足す。
 * 利用者が止めたときは、残っている途中の文を足してから認識を打ち切り、その後に届く結果は捨てる（二重に入らない）。
 */
export default function MicButton({ onText, disabled = false, size = "normal", hasText = false, onClear }: Props) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  /** いま結果を受け付けている認識。null や別の認識になったら、届いた結果・終了は無視する */
  const recognitionRef = useRef<VoiceRecognition | null>(null);
  const interimRef = useRef("");
  const restartedRef = useRef(false);
  const lastErrorRef = useRef<string | null>(null);
  const onTextRef = useRef(onText);
  const noteId = useId();
  const micRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  function clearInterim() {
    interimRef.current = "";
    setInterim("");
  }

  /** 認識を手放す（以後その認識から届く結果・終了は無視される） */
  function release(drop: boolean) {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec && drop) rec.abort();
    setListening(false);
    clearInterim();
  }

  useEffect(() => {
    setSupported(getRecognitionConstructor() !== null);
    return () => {
      // 画面を離れたら打ち切る（メーターも外れてマイクを離す）
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      rec?.abort();
    };
  }, []);

  // 押せない状態になったら、聞き取りを打ち切る（返事待ちの間に文字が入らないように）
  useEffect(() => {
    if (disabled && recognitionRef.current) release(true);
  }, [disabled]);

  function flushInterim() {
    const rest = correctTranscript(interimRef.current).trim();
    clearInterim();
    if (rest) onTextRef.current(rest);
  }

  function start() {
    const Ctor = getRecognitionConstructor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = true; // 途中の結果は表示だけに使う（Edge は確定までが長いことがあるため）
    rec.maxAlternatives = 1;

    rec.onresult = (ev: VoiceRecognitionEvent) => {
      if (recognitionRef.current !== rec) return;
      let finalText = "";
      let interimText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (result.length === 0) continue;
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      interimRef.current = interimText;
      setInterim(correctTranscript(interimText));
      // 聞き間違いの置き換えは音声の結果にだけ当てる（キーボードで打った文字には当てない）
      finalText = correctTranscript(finalText).trim();
      if (finalText) {
        restartedRef.current = false; // 聞き取れているので、無音で止まったときのやり直しをまた1回使えるようにする
        setMessage(null);
        onTextRef.current(finalText);
      }
    };
    rec.onerror = (ev: VoiceRecognitionErrorEvent) => {
      if (recognitionRef.current !== rec) return;
      lastErrorRef.current = ev.error;
      const msg = errorMessage(ev.error);
      if (msg && FATAL_ERRORS.has(ev.error)) setMessage(msg);
    };
    rec.onend = () => {
      if (recognitionRef.current !== rec) return; // 利用者が止めた・打ち切った後の終了
      // 利用者が止めていないのに終わった（無音などでブラウザが止めた）
      flushInterim();
      const err = lastErrorRef.current;
      lastErrorRef.current = null;
      if (err === null || !FATAL_ERRORS.has(err)) {
        if (!restartedRef.current) {
          restartedRef.current = true;
          try {
            rec.start(); // 1回だけ自動でやり直す
            return;
          } catch {
            // 下で止まった扱いにする
          }
        }
        setMessage(err === "no-speech" ? (errorMessage("no-speech") ?? STOPPED) : STOPPED);
      }
      release(false);
    };

    try {
      recognitionRef.current = rec;
      restartedRef.current = false;
      lastErrorRef.current = null;
      clearInterim();
      setMessage(null);
      rec.start();
      setListening(true);
    } catch {
      release(false);
      setMessage(MIC_DENIED);
    }
  }

  function stop() {
    // 確定していない途中の文も足してから打ち切る。打ち切った認識の結果はもう受け付けないので二重に入らない
    flushInterim();
    release(true);
  }

  function handleRedo() {
    if (disabled || listening || !onClear) return;
    if (!window.confirm(REDO_CONFIRM)) return;
    onClear();
    start();
    // 押したボタンは消えるので、マイクのボタンに移す（キーボード操作で迷わないように）
    micRef.current?.focus();
  }

  function handleClick() {
    if (disabled) return;
    if (listening) stop();
    else start();
  }

  if (!supported) return null;

  const visibleLabel = listening ? "聞き取り中…（押すと止まります）" : "マイクで話す";

  return (
    <div className={styles.wrap}>
      <div className={styles.buttons}>
        <button
          ref={micRef}
          type="button"
          className={`button button--secondary ${size === "small" ? "button--small" : ""} ${styles.mic} ${listening ? styles.listening : ""}`}
          onClick={handleClick}
          disabled={disabled}
          aria-pressed={listening}
          aria-label={`音声入力：${visibleLabel}`}
          aria-describedby={noteId}
        >
          <span className={styles.dot} aria-hidden="true" />
          {visibleLabel}
          {listening && <VolumeMeter />}
        </button>
        {onClear && hasText && !listening && !disabled && (
          <button
            type="button"
            className={`button button--secondary ${size === "small" ? "button--small" : ""} ${styles.redo}`}
            onClick={handleRedo}
            aria-label={`もう一度話す：${REDO_HELP}`}
            title={REDO_HELP}
          >
            もう一度話す
          </button>
        )}
      </div>
      {listening && interim && <p className={styles.interim}>聞き取り中：{interim}</p>}
      {/* 注記は場所を取らないよう1行に畳む（聞き取り中の文・メーター・エラーの案内は畳まずに常に見せる） */}
      <details className={styles.about}>
        <summary className={styles.aboutSummary}>音声入力について</summary>
        <div id={noteId}>
          <p className={styles.note}>
            音声はブラウザの音声入力で文字にします（Chrome は Google、Edge はマイクロソフトのサーバーで文字にします）
          </p>
          <p className={styles.note}>
            音声はたまに聞き間違えることがあります（例：「先代」が「仙台」になる）。送信する前に内容を確かめ、必要なら直してください。ご了承ください。
          </p>
        </div>
      </details>
      <p className={styles.message} role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
