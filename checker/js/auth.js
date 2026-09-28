// 簡易ログイン。入力した暗証番号（数字4桁）を PBKDF2 でハッシュにして PASS_HASH と照合する。
// 番号そのものはどこにも置かない。ただし判定はブラウザ内なので、ソースを読める人には突破できる（リンクを知っているだけの人を締め出す用途）。
// PASS_HASH は「pbkdf2$くり返し回数$ソルト$ハッシュ」（Base64）。空ならログインなしで開く。
export const PASS_HASH = 'pbkdf2$600000$DioWOlYDbOlRsjyqxcl/IQ==$Lv6pjODmyB1uNO/YxKOxXSzgRRIWE/mPQU/QdgWgWtw=';

const KEY = 'ckauth';
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function matches(pw) {
  const [, iter, salt, hash] = PASS_HASH.split('$');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: +iter }, key, 256);
  return b64(bits) === hash;
}

const loggedIn = () => { try { return localStorage.getItem(KEY) === PASS_HASH; } catch { return false; } };

export function logout() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  location.reload();
}

// ログインが済むまで待つ。済んだら html の locked を外してアプリを見せる。
export function requireLogin() {
  const root = document.documentElement;
  if (!PASS_HASH || loggedIn()) { root.classList.remove('locked'); return Promise.resolve(); }
  const form = document.getElementById('login'), pw = document.getElementById('loginPw'), msg = document.getElementById('loginMsg');
  const btn = form.querySelector('button');
  pw.focus();
  return new Promise((resolve) => {
    // 4桁そろったらそのまま確かめる。
    pw.addEventListener('input', () => { if (/^\d{4}$/.test(pw.value)) form.requestSubmit(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      btn.disabled = true;
      msg.textContent = '確認中…';
      const ok = await matches(pw.value).catch(() => false);
      btn.disabled = false;
      if (!ok) {
        msg.textContent = '暗証番号が違います。';
        pw.value = '';
        pw.focus();
        return;
      }
      try { localStorage.setItem(KEY, PASS_HASH); } catch { /* 次回また入力する */ }
      msg.textContent = '';
      pw.value = '';
      root.classList.remove('locked');
      resolve();
    });
  });
}
