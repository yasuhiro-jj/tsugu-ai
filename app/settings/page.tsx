import Link from "next/link";
import { getSession } from "@/lib/demo";
import { getCompanySettings } from "@/components/server-data";
import { TSUGUMI_SETTINGS } from "@/lib/industry-presets";
import type { SettingsView } from "@/lib/settings-types";
import SettingsForm from "@/components/settings/SettingsForm";

export const dynamic = "force-dynamic";

// 会社の設定。設定は二人の共有物（先代・後継者のどちらからでも見られる・書き換えられる）。
// 取得はサーバーで「デモ用 ID」に絞って行う。役割が未選択なら初期値（つぐみ）を見せるだけ。

export default async function SettingsPage() {
  const session = await getSession();

  let view: SettingsView | null = null;
  let loadFailed = false;
  if (session) {
    try {
      // 消えるもの（willInvalidate）は役割ごとに違う（自分の AI参謀の会話）ので、役割も渡す
      view = await getCompanySettings(session.demoId, session.role);
    } catch {
      loadFailed = true;
    }
  }

  return (
    <>
      <p className="breadcrumb">
        <Link href="/">トップ</Link> ＞ 会社の設定
      </p>
      <h1 className="page-title">会社の設定</h1>
      <p className="lead">
        業種・会社の概要・面談する人・テーマの補足・決算の数字を入れると、その会社に合わせて面談・診断・学習・90日計画・資料・AI参謀が動きます。何も変えなければ、架空の「食事処 つぐみ」のデモのままです。
      </p>
      {loadFailed ? (
        <section className="card notice">
          <h2>設定を読み込めませんでした</h2>
          <p role="alert">時間をおいて、ページを読み込み直してください。</p>
        </section>
      ) : (
        <SettingsForm initialView={view} defaults={TSUGUMI_SETTINGS} canSave={session !== null && view !== null} />
      )}
    </>
  );
}
