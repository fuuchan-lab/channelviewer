/**
 * Google ログインのトークンを待つ処理（LeadLog の tokenWaiter.ts と同じ）。
 *
 * ログイン用のポップアップが閉じた通知（popup_closed）は、スマホのブラウザなどで、
 * ログインが成功していてもトークンより少し先に届くことがある。すぐ失敗にせず、
 * 猶予の間にトークンが届けば成功として扱う。
 */
export function createTokenWaiter({ graceMs, timeoutMs }) {
  let done = false;
  let graceTimer;
  let settle;
  const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; });

  const finish = () => {
    done = true;
    clearTimeout(graceTimer);
    clearTimeout(overallTimer);
  };
  const rejectWith = (message) => {
    if (done) return;
    finish();
    settle.reject(new Error(message));
  };
  const overallTimer = setTimeout(() => rejectWith('login_timeout'), timeoutMs);

  return {
    promise,
    resolve(value) {
      if (done) return;
      finish();
      settle.resolve(value);
    },
    fail(type) {
      if (done) return;
      if (type === 'popup_closed') {
        graceTimer ??= setTimeout(() => rejectWith('popup_closed'), graceMs);
        return;
      }
      rejectWith(type);
    },
  };
}
