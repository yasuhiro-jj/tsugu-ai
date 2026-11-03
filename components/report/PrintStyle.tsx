// 資料ページの印刷用スタイル。ヘッダー・メニュー・フッターは全体の部品なので、
// CSS Modules ではなく、このページにだけ置く style 要素で指定する（固定の文字列。利用者の入力は含めない）。
// - メニュー・ボタン・ページ内リンクを消す（data-print="hide"）
// - 白黒でも読めるよう、文字は黒・背景は白・枠線は黒にする（作り手の札は文字で区別できる）

const PRINT_CSS = `
@media print {
  .skip-link, .site-header, .site-nav, .site-footer, [data-print="hide"] { display: none !important; }
  html, body { background: #fff !important; }
  body, body * { color: #000 !important; box-shadow: none !important; }
  .main, .main * { background: #fff !important; }
  .card, .data-table th, .data-table td { border-color: #000 !important; }
  .card { border-radius: 0; padding: 12px 0; border-width: 0 0 1px 0; }
  .main { max-width: none; padding: 0; }
  a { text-decoration: none; }
  h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
  tr, li { break-inside: avoid; page-break-inside: avoid; }
}
`;

export default function PrintStyle() {
  return <style>{PRINT_CSS}</style>;
}
