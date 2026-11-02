import Link from "next/link";
import { getRole } from "@/lib/role";

const ROLE_LABELS = {
  predecessor: "先代として利用中",
  successor: "後継者として利用中",
} as const;

const NAV_ITEMS = [
  { href: "/interview", label: "AI面談" },
  { href: "/compare", label: "認識差の比較" },
  { href: "/learning", label: "学習プラン" },
  { href: "/plan", label: "90日行動計画" },
] as const;

export default async function Header() {
  const role = await getRole();

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <Link href="/" className="site-header__brand">
          TSUGU AI
        </Link>
        <div className="site-header__role">
          <span
            className={role ? "role-badge" : "role-badge role-badge--none"}
            aria-label="現在の役割"
          >
            {role ? ROLE_LABELS[role] : "役割未選択"}
          </span>
          <Link href="/">{role ? "役割を切り替える" : "役割を選ぶ"}</Link>
        </div>
      </div>
      <nav className="site-nav" aria-label="主要メニュー">
        <ul className="container">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
