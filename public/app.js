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
const sendBtn = chatForm.querySelector('button');

const newChatBtn = document.getElementById('new-chat-btn');
const conversationList = document.getElementById('conversation-list');

let mode = 'login';          // 'login' or 'register'
let conversationId = null;   // which chat we are in (null = a new chat)
let busy = false;            // true while waiting for an answer

// ---------- Token helpers ----------
const getToken = () => localStorage.getItem('token');
const setToken = (t) => localStorage.setItem('token', t);
const clearToken = () => localStorage.removeItem('token');

// ---------- Fetch with the login token ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + getToken(),
    },
  });
  if (res.status === 401) {          // token missing or expired
    clearToken();
    setMode('login');
    showAuth();
    throw new Error('unauthorized');
  }
  return res;
}

// ---------- Screen switching ----------
function showAuth() {
  chatScreen.classList.add('hidden');
  authScreen.classList.remove('hidden');
}

function showChat(email) {
  authScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  userEmail.textContent = email;
  startNewChat();
  loadConversations();
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

// ---------- Sidebar: the list of chats ----------
function markActive() {
  for (const li of conversationList.querySelectorAll('li[data-id]')) {
    li.classList.toggle('active', li.dataset.id === conversationId);
  }
}

function renderConversations(list) {
  conversationList.innerHTML = '';

  if (list.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No chats yet';
    conversationList.appendChild(li);
    return;
  }

  for (const c of list) {
    const li = document.createElement('li');
    li.dataset.id = c._id;
    li.textContent = c.title;       // textContent keeps titles safe
    li.title = c.title;
    li.addEventListener('click', () => openConversation(c._id));
    conversationList.appendChild(li);
  }
  markActive();
}

async function loadConversations() {
  try {
    const res = await api('/api/conversations');
    if (!res.ok) return;
    const data = await res.json();
    renderConversations(data.conversations);
  } catch {
    /* the sidebar is optional, so ignore errors here */
  }
}

async function openConversation(id) {
  if (busy || id === conversationId) return;

  try {
    const res = await api('/api/conversations/' + id + '/messages');
    const data = await res.json();
    if (!res.ok) {
      addMessage(data.message || 'Could not load that chat', 'bot');
      return;
    }

    conversationId = data.conversationId;
    messages.innerHTML = '';
    for (const m of data.messages) {
      addMessage(m.content, m.role === 'user' ? 'user' : 'bot');
    }
    markActive();
  } catch {
    /* unauthorized is already handled inside api() */
  }
}

function startNewChat() {
  conversationId = null;
  messages.innerHTML = '';
  addMessage('Hi! Ask me anything.', 'bot');
  markActive();
}

newChatBtn.addEventListener('click', () => {
  if (busy) return;
  startNewChat();
});

// ---------- Chat ----------
function addMessage(text, role) {
  const div = document.createElement('div');
  div.className = 'message ' + role;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

async function sendMessage(text) {
  addMessage(text, 'user');
  const bubble = addMessage('Thinking...', 'bot');
  busy = true;
  sendBtn.disabled = true;
  let saved = false;

  try {
    const res = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: text, conversationId }),
    });
    const data = await res.json();

    if (!res.ok) {
      bubble.textContent = data.message || 'Something went wrong';
      return;
    }

    conversationId = data.conversationId;   // remember the chat for the next question
    bubble.textContent = data.reply;
    saved = true;
  } catch (err) {
    if (err.message !== 'unauthorized') bubble.textContent = 'Cannot reach the server';
  } finally {
    busy = false;
    sendBtn.disabled = false;
    messages.scrollTop = messages.scrollHeight;
  }

  if (saved) await loadConversations();     // refresh the sidebar list
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  sendMessage(text);
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