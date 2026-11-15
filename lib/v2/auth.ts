// 「誰が操作しているか」を確かめる部品（認証）の入口。
//
// 段階3の土台：どの認証サービスを使うかはまだ決まっていない。
// 決まったあとに差し替えられるよう、ここでは「合言葉（トークン）から、本人・所属・役割を返す」
// という形だけを決め、その先の権限確認（access.ts）は認証サービスに関係なく同じにする。
//
// 注意：createLocalAuth は本人認証ではない（ログインがない手元の試作用）。
// 実データを扱う前に、実績のある認証サービスへ差し替え、第三者の診断を受ける。

import { createHash } from "node:crypto";

/** owner=経営者本人 / operator=運営担当者（面談や資料の中身は見られない） */
export type Role = "owner" | "operator";

export type Actor = {
  userId: string;
  /** 会社（テナント）の ID */
  tenantId: string;
  role: Role;
};

export type AuthProvider = {
  /** 合言葉が有効なら、いまの本人・所属・役割を返す。無効・期限切れ・所属なしは null */
  resolve(token: string | null): Actor | null | Promise<Actor | null>;
};

/** 手元の試作で、サーバーが発行するセッション ID の形 */
const LOCAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * 手元の試作用：ログインなし。
 * クッキーの ID 1つを「一人だけの会社の、経営者本人」として扱う。
 * 保存先には、クッキーの値そのものではなく、元に戻せない形（ハッシュ）にした ID を使う。
 */
export function createLocalAuth(): AuthProvider {
  return {
    resolve(token) {
      // サーバーが発行した ID の形（43文字）だけを受け付ける。
      // 検証用の入口が渡す決まった名前など、ほかの文字列は合言葉として通さない
      if (!token || !LOCAL_TOKEN_PATTERN.test(token)) return null;
      const h = createHash("sha256").update(token).digest("base64url").slice(0, 32);
      return { userId: `u-${h}`, tenantId: `t-${h}`, role: "owner" };
    },
  };
}

export type DirectoryAuth = {
  provider: AuthProvider;
  addUser(userId: string, tenantId: string, role?: Role): void;
  /** ログインして、合言葉を受け取る */
  login(userId: string): string;
  logout(token: string): void;
  /** 所属を外す（退職・利用停止）。その人の合言葉はすべて使えなくなる */
  removeMember(userId: string): void;
  setRole(userId: string, role: Role): void;
};

/**
 * 検証用：名簿つきの認証（架空の利用者だけで使う）。
 * 権限確認のテスト（別の会社・同じ会社の別の人・ログアウト後・期限切れ・所属を外した後）のために使う。
 * 合言葉を確かめるたびに、いまの所属と役割を読み直す（古い権限を使い回さない）。
 */
export function createDirectoryAuth(opts: {
  newToken: () => string;
  nowMs?: () => number;
  ttlMs?: number;
}): DirectoryAuth {
  const nowMs = opts.nowMs ?? (() => Date.now());
  const ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
  const users = new Map<string, { tenantId: string; role: Role; active: boolean }>();
  const sessions = new Map<string, { userId: string; expiresAt: number }>();

  return {
    provider: {
      resolve(token) {
        if (!token) return null;
        const session = sessions.get(token);
        if (!session) return null;
        if (session.expiresAt <= nowMs()) {
          sessions.delete(token);
          return null;
        }
        const user = users.get(session.userId);
        if (!user || !user.active) return null;
        return { userId: session.userId, tenantId: user.tenantId, role: user.role };
      },
    },
    addUser(userId, tenantId, role = "owner") {
      // 登録し直すときは、それまでの合言葉を破棄する（別の会社の権限で使い回されないように）
      for (const [token, session] of sessions) {
        if (session.userId === userId) sessions.delete(token);
      }
      users.set(userId, { tenantId, role, active: true });
    },
    login(userId) {
      const user = users.get(userId);
      if (!user || !user.active) throw new Error("unknown user");
      const token = opts.newToken();
      sessions.set(token, { userId, expiresAt: nowMs() + ttlMs });
      return token;
    },
    logout(token) {
      sessions.delete(token);
    },
    removeMember(userId) {
      const user = users.get(userId);
      if (user) user.active = false;
      // 合言葉そのものも破棄する（あとで所属を戻したり、別の会社に登録し直したりしても、古い合言葉は使えない）
      for (const [token, session] of sessions) {
        if (session.userId === userId) sessions.delete(token);
      }
    },
    setRole(userId, role) {
      const user = users.get(userId);
      if (user) user.role = role;
    },
  };
}
