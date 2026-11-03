"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/interview", label: "AI面談" },
  { href: "/compare", label: "認識差の比較" },
  { href: "/learning", label: "学習プラン" },
  { href: "/plan", label: "90日行動計画" },
  { href: "/report", label: "資料" },
  { href: "/advisor", label: "AI参謀" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** ヘッダーの主要メニュー。現在のページに aria-current="page" を付ける（役割の取得はしない） */
export default function HeaderNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav className="site-nav" aria-label="主要メニュー">
      <ul className="container">
        {NAV_ITEMS.map((item) => {
          const current = isCurrent(pathname, item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={current ? "page" : undefined}>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
