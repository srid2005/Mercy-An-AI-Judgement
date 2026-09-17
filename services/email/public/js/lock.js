const errorEl = document.getElementById('error');
const input = document.getElementById('password');
const btn = document.getElementById('unlock-btn');
const nameEl = document.getElementById('account-name');
const emailEl = document.getElementById('account-email');
const avatarEl = document.getElementById('account-avatar');
const hintBox = document.getElementById('hint-box');
const hintText = document.getElementById('hint-text');
const showHintBtn = document.getElementById('show-hint-btn');

fetch('/api/public/account-preview')
  .then((r) => r.json())
  .then((d) => {
    nameEl.textContent = d.display_name || d.username;
    emailEl.textContent = d.email_address || '';
    if (d.avatar_url) avatarEl.src = d.avatar_url;
  })
  .catch(() => {
    nameEl.textContent = 'Account';
  });

showHintBtn.addEventListener('click', async () => {
  if (!hintBox.hidden) {
    hintBox.hidden = true;
    return;
  }
  const { hint } = await fetch('/api/auth/hint').then((r) => r.json());
  hintText.textContent = hint || 'No hint available.';
  hintBox.hidden = false;
});

async function tryUnlock() {
  errorEl.textContent = '';
  const password = input.value.trim();
  if (!password) return;

  btn.disabled = true;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  btn.disabled = false;

  if (!res.ok) {
    errorEl.textContent = 'Incorrect password. Please try again.';
    return;
  }

  const { token } = await res.json();
  localStorage.setItem('eml_token', token);
  window.location.href = '/inbox.html';
}

btn.addEventListener('click', tryUnlock);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryUnlock();
});
