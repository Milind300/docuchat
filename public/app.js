// ---------- Elements ----------
const authScreen = document.getElementById('auth-screen');
const chatScreen = document.getElementById('chat-screen');
const authForm = document.getElementById('auth-form');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authSubmit = document.getElementById('auth-submit');
const authError = document.getElementById('auth-error');
const authSubtitle = document.getElementById('auth-subtitle');
const authSwitch = document.getElementById('auth-switch');
const authSwitchText = document.getElementById('auth-switch-text');
const userEmail = document.getElementById('user-email');
const logoutBtn = document.getElementById('logout-btn');

const chatForm = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const messages = document.getElementById('messages');

let mode = 'login'; // 'login' or 'register'

// ---------- Token helpers ----------
const getToken = () => localStorage.getItem('token');
const setToken = (t) => localStorage.setItem('token', t);
const clearToken = () => localStorage.removeItem('token');

// ---------- Screen switching ----------
function showAuth() {
  chatScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
}

function showChat(email) {
  authScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  userEmail.textContent = email;
  messages.innerHTML = '';
  addMessage('Hi! Ask me anything. (Replies are fake for now.)', 'bot');
}

function setMode(newMode) {
  mode = newMode;
  authError.textContent = '';
  if (mode === 'login') {
    authSubtitle.textContent = 'Log in to continue';
    authSubmit.textContent = 'Log in';
    authSwitchText.textContent = 'No account?';
    authSwitch.textContent = 'Register';
    authPassword.autocomplete = 'current-password';
  } else {
    authSubtitle.textContent = 'Create your account';
    authSubmit.textContent = 'Register';
    authSwitchText.textContent = 'Already have an account?';
    authSwitch.textContent = 'Log in';
    authPassword.autocomplete = 'new-password';
  }
}

authSwitch.addEventListener('click', (e) => {
  e.preventDefault();
  setMode(mode === 'login' ? 'register' : 'login');
});

// ---------- Login / Register ----------
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  authSubmit.disabled = true;

  try {
    const res = await fetch('/api/auth/' + mode, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: authEmail.value, password: authPassword.value }),
    });
    const data = await res.json();

    if (!res.ok) {
      authError.textContent = data.message || 'Something went wrong';
      return;
    }

    setToken(data.token);
    authForm.reset();
    showChat(data.user.email);
  } catch {
    authError.textContent = 'Cannot reach the server';
  } finally {
    authSubmit.disabled = false;
  }
});

logoutBtn.addEventListener('click', () => {
  clearToken();
  setMode('login');
  showAuth();
});

// ---------- Chat (still fake) ----------
function addMessage(text, role) {
  const div = document.createElement('div');
  div.className = 'message ' + role;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function fakeBotReply(userText) {
  const bubble = addMessage('Typing...', 'bot');
  setTimeout(() => {
    bubble.textContent = 'This is a fake reply to: "' + userText + '"';
  }, 800);
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addMessage(text, 'user');
  input.value = '';
  fakeBotReply(text);
});

// ---------- On page load: am I already logged in? ----------
async function init() {
  const token = getToken();
  if (!token) return showAuth();

  try {
    const res = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('bad token');
    const data = await res.json();
    showChat(data.user.email);
  } catch {
    clearToken();
    showAuth();
  }
}

init();