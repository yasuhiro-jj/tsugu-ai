import Link from "next/link";
import { getRole } from "@/lib/role";
import HeaderNav from "@/components/HeaderNav";

const ROLE_LABELS = {
  predecessor: "先代として利用中",
  successor: "後継者として利用中",
} as const;

export default async function Header() {
  const role = await getRole();

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link href="/" className="site-header__brand">
          TSUGU AI
        </Link>
        <div className="site-header__role">
          <span className={role ? "role-badge" : "role-badge role-badge--none"}>
            <span className="visually-hidden">現在の役割：</span>
            {role ? ROLE_LABELS[role] : "役割未選択"}
          </span>
          <Link href="/">{role ? "役割を切り替える" : "役割を選ぶ"}</Link>
        </div>
      </div>
      <HeaderNav />
    </header>
  );
}
