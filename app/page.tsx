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
      <section className="card">
        <h2>どちらの立場で利用しますか</h2>
        <p>デモでは、ボタンで先代・後継者の立場を切り替えて体験できます。</p>
        <RoleSwitcher />
      </section>
      <section className="card">
        <h2>デモをやり直す</h2>
        <p>このブラウザで入力した面談の内容を消して、最初から体験し直せます。</p>
        <ResetDemoButton />
      </section>
    </>
  );
}
