// 比較画面のお店の数字（FinancialTable）で、「もうけ（損益）」「お金の動き（資金繰り）」の2欄に入らない
// 今までの行（rows）を、どちらの欄の近くに置くかを決める表示用の部品。数字の計算はしない（lib/financials.ts が計算済み）。

/** お金の動き側に置く行（表示名で判定）。それ以外の行は、もうけ側の「ほかの数字」に畳む */
const CASH_LABELS: ReadonlySet<string> = new Set([
  "手元資金（期末）",
  "手元資金は月商の何か月分",
  "借入残高（期末）",
  "年間返済額（元本）",
  "減価償却費",
  "元本の返済",
  "現金の増減",
  "当期の現金の動き",
]);

export function isCashRow(label: string): boolean {
  return CASH_LABELS.has(label);
}

/** cashMovement の行と同じ数字を別の名前で持つ今までの行（2欄の表示では重ねて出さない） */
export const DUPLICATE_CASH_LABELS: ReadonlySet<string> = new Set(["当期の現金の動き", "年間返済額（元本）"]);
