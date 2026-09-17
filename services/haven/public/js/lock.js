const errorEl = document.getElementById('error');
const stepRequest = document.getElementById('step-request');
const stepCode = document.getElementById('step-code');
const stepQuestions = document.getElementById('step-questions');
const stepsList = document.getElementById('steps');

let challenge = sessionStorage.getItem('hav_challenge') || null;

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showStep(n) {
  stepRequest.hidden = n !== 1;
  stepCode.hidden = n !== 2;
  stepQuestions.hidden = n !== 3;
  [...stepsList.children].forEach((li, i) => {
    li.classList.toggle('active', i === n - 1);
    li.classList.toggle('done', i < n - 1);
  });
  errorEl.textContent = '';
}

fetch('/api/public/account-preview')
  .then((r) => r.json())
  .then((d) => {
    document.getElementById('account-name').textContent = d.display_name;
    document.getElementById('account-email').textContent = d.masked_email;
    if (d.avatar_url) document.getElementById('account-avatar').src = d.avatar_url;
  })
  .catch(() => {
    document.getElementById('account-name').textContent = 'Account';
  });

// -- step 1: request a code ------------------------------------------------
async function requestCode(btn) {
  errorEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const res = await fetch('/api/auth/request-code', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not send the code.');
    document.getElementById('sent-to').textContent = data.masked_email;
    showStep(2);
    document.getElementById('code').focus();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = btn.id === 'resend-btn' ? "Didn't get it? Send again" : 'Email me a sign-in code';
  }
}
document.getElementById('send-code-btn').addEventListener('click', (e) => requestCode(e.currentTarget));
document.getElementById('resend-btn').addEventListener('click', (e) => requestCode(e.currentTarget));

// -- step 2: verify the code -----------------------------------------------
async function verifyCode() {
  errorEl.textContent = '';
  const code = document.getElementById('code').value.trim();
  if (code.length !== 6) {
    errorEl.textContent = 'Enter the 6-digit code from the email.';
    return;
  }
  const res = await fetch('/api/auth/verify-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    errorEl.textContent = 'That code is incorrect or has expired.';
    return;
  }
  challenge = (await res.json()).challenge;
  sessionStorage.setItem('hav_challenge', challenge);
  await loadQuestions();
}
document.getElementById('verify-code-btn').addEventListener('click', verifyCode);
document.getElementById('code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') verifyCode();
});

// -- step 3: security questions --------------------------------------------
async function loadQuestions() {
  const res = await fetch('/api/auth/questions', { headers: { Authorization: `Bearer ${challenge}` } });
  if (!res.ok) {
    sessionStorage.removeItem('hav_challenge');
    challenge = null;
    showStep(1);
    errorEl.textContent = 'Your sign-in session expired. Request a new code.';
    return;
  }
  const { questions } = await res.json();
  document.getElementById('questions').innerHTML = questions
    .map(
      (q) => `
      <div class="question" data-position="${q.position}">
        <label>${q.position}. ${escapeHtml(q.question)}</label>
        <input type="text" autocomplete="off" data-answer="${q.position}" />
        <div class="q-foot">
          <button type="button" class="link hint-toggle">Show hint</button>
          <span class="hint-text" hidden>${escapeHtml(q.hint)}</span>
          <span class="q-error" hidden>Doesn't match</span>
        </div>
      </div>`
    )
    .join('');
  document.querySelectorAll('.hint-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hint = btn.parentElement.querySelector('.hint-text');
      hint.hidden = !hint.hidden;
      btn.textContent = hint.hidden ? 'Show hint' : 'Hide hint';
    });
  });
  showStep(3);
  document.querySelector('[data-answer="1"]').focus();
}

async function submitAnswers() {
  errorEl.textContent = '';
  const answers = {};
  document.querySelectorAll('[data-answer]').forEach((input) => {
    answers[input.dataset.answer] = input.value;
  });
  document.querySelectorAll('.question').forEach((q) => {
    q.classList.remove('wrong');
    q.querySelector('.q-error').hidden = true;
  });

  const btn = document.getElementById('answers-btn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/auth/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${challenge}` },
      body: JSON.stringify({ answers }),
    });
    const data = await res.json();
    if (res.status === 401 && data.wrong) {
      data.wrong.forEach((pos) => {
        const q = document.querySelector(`.question[data-position="${pos}"]`);
        q.classList.add('wrong');
        q.querySelector('.q-error').hidden = false;
      });
      errorEl.textContent = `${data.wrong.length} answer${data.wrong.length > 1 ? 's' : ''} didn't match.`;
      return;
    }
    if (!res.ok) {
      sessionStorage.removeItem('hav_challenge');
      challenge = null;
      showStep(1);
      errorEl.textContent = 'Your sign-in session expired. Request a new code.';
      return;
    }
    sessionStorage.removeItem('hav_challenge');
    localStorage.setItem('hav_token', data.token);
    window.location.href = '/diary.html';
  } finally {
    btn.disabled = false;
  }
}
document.getElementById('answers-btn').addEventListener('click', submitAnswers);
document.getElementById('questions').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAnswers();
});

// Resume at the questions if a code was already confirmed in this tab.
if (challenge) loadQuestions();
else showStep(1);
