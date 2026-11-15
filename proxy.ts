// 2.0 の検証用のログイン（Clerk）のための、リクエストの入口。
//
// - 対象は 2.0 の画面（/v2）と 2.0 の API（/api/v2）だけ。ハッカソン版の画面と API は、ここを通らない
// - 検証用の動かし方（V2_MODE=verify で、鍵と保存先がそろっている）のときだけ、Clerk を動かす。
//   それ以外（ハッカソン版の本番サイト、手元の開発）では、何もせずにそのまま通す
//   （Clerk の処理は呼ばれず、Clerk への通信も起きない）

import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getMode } from "@/lib/v2/mode";

const passThrough = () => NextResponse.next();

export default getMode() === "verify" ? clerkMiddleware() : passThrough;

export const config = {
  matcher: ["/v2", "/v2/:path*", "/api/v2/:path*"],
};
