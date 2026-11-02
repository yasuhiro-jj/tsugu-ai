import Link from "next/link";
import RoleSwitcher from "@/components/RoleSwitcher";
import ResetDemoButton from "@/components/ResetDemoButton";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <h1>想いと事業を、次の世代へ。</h1>
        <p className="lead">
          TSUGU AI は、先代と後継者それぞれの AI 面談から認識の違いを見つけ、
          後継者の学びと90日の行動計画につなげる事業承継の対話支援サービスです。
        </p>
      </section>
      <section className="card" id="role-select" aria-labelledby="role-select-title">
        <h2 id="role-select-title">どちらの立場で利用しますか</h2>
        <p>デモでは、ボタンで先代・後継者の立場を切り替えて体験できます。</p>
        <RoleSwitcher />
      </section>
      <section className="card" aria-labelledby="flow-title">
        <h2 id="flow-title">デモの流れ（架空の「食事処 つぐみ」）</h2>
        <ol className="demo-flow">
          <li>
            先代（森川 修さん）が AI 面談で答える
            <span className="muted">（上の<a href="#role-select">「先代として入る」</a>から始めます）</span>
          </li>
          <li>
            後継者（森川 拓也さん）が AI 面談で答える
            <span className="muted">（上の<a href="#role-select">「後継者として入る」</a>に切り替えます）</span>
          </li>
          <li>
            <Link href="/compare">共有した回答だけで比べ、AI が「追加確認が必要な点」を整理する</Link>
          </li>
          <li>
            <Link href="/learning">診断を受けて、後継者の学習プランが変わる</Link>
          </li>
          <li>
            <Link href="/plan">90日行動計画ができる</Link>
          </li>
        </ol>
        <p className="muted">役割は上のボタンでいつでも切り替えられます。</p>
      </section>
      <section className="card">
        <h2>デモをやり直す</h2>
        <p>
          このブラウザで入力した面談・共有の設定・診断・学習プラン・90日計画のデータを消して、最初から体験し直せます。
        </p>
        <ResetDemoButton />
      </section>
    </>
  );
}
