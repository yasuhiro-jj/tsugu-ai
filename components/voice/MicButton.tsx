"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  getRecognitionConstructor,
  type VoiceRecognition,
  type VoiceRecognitionErrorEvent,
  type VoiceRecognitionEvent,
} from "./speech-types";
import styles from "./MicButton.module.css";

type Props = {
  /** 確定した聞き取り結果（途中の結果は渡さない） */
  onText: (text: string) => void;
  /** 送信中・AI の返事待ちなど、押せないとき true。聞き取り中に true になったら止める */
  disabled?: boolean;
  /** 周りのボタンが小さいとき "small"（.button--small をそろえて付ける） */
  size?: "normal" | "small";
};

const MIC_DENIED = "マイクが使えませんでした。ブラウザの設定でマイクを許可してください。";

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
      return "音声入力の通信がうまくいきませんでした。少し待ってから、もう一度お試しください。";
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
 */
export default function MicButton({ onText, disabled = false, size = "normal" }: Props) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const recognitionRef = useRef<VoiceRecognition | null>(null);
  const onTextRef = useRef(onText);
  const noteId = useId();

  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  useEffect(() => {
    setSupported(getRecognitionConstructor() !== null);
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  // 押せない状態になったら、聞き取りを打ち切る（返事待ちの間に文字が入らないように）
  useEffect(() => {
    if (disabled && recognitionRef.current) {
      recognitionRef.current.abort();
    }
  }, [disabled]);

  function start() {
    const Ctor = getRecognitionConstructor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = false; // 途中の結果は受け取らない
    rec.maxAlternatives = 1;

    rec.onresult = (ev: VoiceRecognitionEvent) => {
      if (recognitionRef.current !== rec) return;
      let text = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (result.isFinal && result.length > 0) text += result[0].transcript;
      }
      text = text.trim();
      if (text) {
        setMessage(null);
        onTextRef.current(text);
      }
    };
    rec.onerror = (ev: VoiceRecognitionErrorEvent) => {
      const msg = errorMessage(ev.error);
      if (msg) setMessage(msg);
    };
    rec.onend = () => {
      if (recognitionRef.current === rec) recognitionRef.current = null;
      setListening(false);
    };

    try {
      recognitionRef.current = rec;
      setMessage(null);
      rec.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setMessage(MIC_DENIED);
    }
  }

  function stop() {
    // stop は話し終えた分を確定させてから終わる（onend で表示が戻る）
    recognitionRef.current?.stop();
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
      <button
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
      </button>
      <p id={noteId} className={styles.note}>
        音声はブラウザの音声入力（Chrome では Google のサーバー）で文字にします
      </p>
      <p className={styles.message} role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
