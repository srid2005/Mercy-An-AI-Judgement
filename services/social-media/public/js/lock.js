const errorEl = document.getElementById('error');
const input = document.getElementById('password');
const btn = document.getElementById('unlock-btn');
const nameEl = document.getElementById('account-name');
const avatarEl = document.getElementById('account-avatar');
const hintBox = document.getElementById('hint-box');
const hintText = document.getElementById('hint-text');
const showHintBtn = document.getElementById('show-hint-btn');

fetch('/api/public/account-preview')
  .then((r) => r.json())
  .then((d) => {
    nameEl.textContent = d.display_name || d.username;
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
  localStorage.setItem('sm_token', token);
  window.location.href = '/feed.html';
}

btn.addEventListener('click', tryUnlock);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryUnlock();
});

// ---------------------------------------------------------------------
// Forgot password -> real 4-digit PIN emailed to Meera's Quill inbox
// ---------------------------------------------------------------------

const sendPinBtn = document.getElementById('send-pin-btn');
const pinSection = document.getElementById('pin-section');
const pinInput = document.getElementById('pin-input');
const verifyPinBtn = document.getElementById('verify-pin-btn');
const pinError = document.getElementById('pin-error');

sendPinBtn.addEventListener('click', async () => {
  sendPinBtn.disabled = true;
  sendPinBtn.textContent = 'Sending…';
  try {
    const res = await fetch('/api/auth/forgot-password', { method: 'POST' });
    if (!res.ok) {
      pinError.textContent = 'Could not send the code right now. Try again in a moment.';
      pinSection.hidden = false;
      return;
    }
    sendPinBtn.textContent = 'Code sent -- check your email';
    pinSection.hidden = false;
    pinInput.focus();
  } finally {
    sendPinBtn.disabled = false;
  }
});

async function tryVerifyPin() {
  pinError.textContent = '';
  const pin = pinInput.value.trim();
  if (!pin) return;

  verifyPinBtn.disabled = true;
  const res = await fetch('/api/auth/verify-reset-pin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  verifyPinBtn.disabled = false;

  if (!res.ok) {
    pinError.textContent = 'Incorrect or expired code.';
    return;
  }

  const { token } = await res.json();
  localStorage.setItem('sm_token', token);
  window.location.href = '/feed.html';
}

verifyPinBtn.addEventListener('click', tryVerifyPin);
pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryVerifyPin();
});
