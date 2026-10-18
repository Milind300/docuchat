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
const useDocsToggle = document.getElementById('use-docs');

const uploadBtn = document.getElementById('upload-btn');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const documentList = document.getElementById('document-list');

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB, the same limit as the server

let mode = 'login';          // 'login' or 'register'
let conversationId = null;   // which chat we are in (null = a new chat)
let busy = false;            // true while waiting for an answer
let uploading = false;       // true while a file is being processed

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
  setUploadStatus('');
  startNewChat();
  loadConversations();
  loadDocuments();
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
    li.title = c.title;
    li.addEventListener('click', () => openConversation(c._id));

    const title = document.createElement('span');
    title.className = 'chat-title';
    title.textContent = c.title;                    // textContent keeps titles safe
    li.appendChild(title);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chat-delete';
    del.textContent = '×';
    del.title = 'Delete this chat';
    del.addEventListener('click', (e) => {
      e.stopPropagation();                          // do not also open the chat
      deleteConversation(c);
    });
    li.appendChild(del);

    conversationList.appendChild(li);
  }
  markActive();
}

async function deleteConversation(c) {
  if (busy) return;
  const ok = confirm('Delete this chat?\n\n"' + c.title + '"\n\nThis cannot be undone.');
  if (!ok) return;

  try {
    const res = await api('/api/conversations/' + c._id, { method: 'DELETE' });
    if (res.ok) {
      if (c._id === conversationId) startNewChat();   // the open chat was deleted
    } else {
      const data = await res.json();
      alert(data.message || 'Could not delete that chat.');
    }
  } catch (err) {
    if (err.message !== 'unauthorized') alert('Cannot reach the server.');
  }
  loadConversations();
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
      const bubble = addMessage(m.content, m.role === 'user' ? 'user' : 'bot');
      if (m.role === 'assistant') addSources(bubble, m.sources);
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

// ---------- Documents panel ----------
function setUploadStatus(text, isError = false) {
  uploadStatus.textContent = text;
  uploadStatus.classList.toggle('error', isError);
}

function renderDocuments(list) {
  documentList.innerHTML = '';

  if (list.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No documents yet';
    documentList.appendChild(li);
    return;
  }

  for (const d of list) {
    const li = document.createElement('li');

    let label = d.filename;
    if (d.status === 'READY') label += ' · ' + d.chunkCount + ' parts';
    else if (d.status === 'FAILED') label += ' · failed';
    else label += ' · processing';

    const name = document.createElement('span');
    name.className = 'doc-name';
    name.textContent = label;                       // textContent keeps names safe
    name.title = d.status === 'FAILED' && d.error ? d.error : d.filename;
    li.appendChild(name);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'doc-delete';
    del.textContent = '×';
    del.title = 'Delete this document';
    del.disabled = d.status === 'PROCESSING';       // the server refuses it anyway
    del.addEventListener('click', () => deleteDocument(d));
    li.appendChild(del);

    documentList.appendChild(li);
  }
}

async function deleteDocument(doc) {
  if (uploading) return;
  const ok = confirm('Delete "' + doc.filename + '"?\n\nIt is removed from search. This cannot be undone.');
  if (!ok) return;

  try {
    const res = await api('/api/documents/' + doc._id, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setUploadStatus(data.message || 'Could not delete the document.', true);
    } else {
      setUploadStatus('Deleted: ' + doc.filename);
    }
  } catch (err) {
    if (err.message !== 'unauthorized') setUploadStatus('Cannot reach the server.', true);
  }
  loadDocuments();
}

async function loadDocuments() {
  try {
    const res = await api('/api/documents');
    if (!res.ok) return;
    const data = await res.json();
    renderDocuments(data.documents);
  } catch {
    /* the list is optional, so ignore errors here */
  }
}

async function uploadFile(file) {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.pdf') && !name.endsWith('.txt')) {
    setUploadStatus('Only PDF and TXT files are supported.', true);
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    setUploadStatus('That file is larger than 4 MB.', true);
    return;
  }

  uploading = true;
  uploadBtn.disabled = true;
  setUploadStatus('Processing "' + file.name + '"... this can take a little while.');

  try {
    const form = new FormData();
    form.append('file', file);

    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getToken() },   // no Content-Type: the browser sets it
      body: form,
    });

    if (res.status === 401) {
      clearToken();
      setMode('login');
      showAuth();
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      setUploadStatus(data.message || 'Upload failed.', true);
      return;
    }
    setUploadStatus('Ready: ' + data.document.filename + ' (' + data.document.chunkCount + ' parts)');
  } catch {
    setUploadStatus('Cannot reach the server.', true);
  } finally {
    uploading = false;
    uploadBtn.disabled = false;
    if (getToken()) loadDocuments();   // show the new document (or a failed one)
  }
}

uploadBtn.addEventListener('click', () => {
  if (!uploading) fileInput.click();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  fileInput.value = '';                // so choosing the same file again still triggers this
  if (file) uploadFile(file);
});

// ---------- Chat ----------
function addMessage(text, role) {
  const div = document.createElement('div');
  div.className = 'message ' + role;
  if (role === 'bot') {
    div.appendChild(renderMarkdown(text));   // formatted: bold, lists, code
  } else {
    div.textContent = text;                  // your own messages stay plain
  }
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

// Replaces the text inside a bot bubble with formatted text
function setBotText(el, text) {
  el.textContent = '';
  el.appendChild(renderMarkdown(text));
}

// Adds a collapsible "Sources" list under a bot answer
function addSources(bubble, sources) {
  if (!sources || sources.length === 0) return;

  const details = document.createElement('details');
  details.className = 'sources';

  const summary = document.createElement('summary');
  summary.textContent = 'Sources (' + sources.length + ')';
  details.appendChild(summary);

  for (const s of sources) {
    const item = document.createElement('div');
    item.className = 'source';

    const name = document.createElement('strong');
    name.textContent = s.filename;
    item.appendChild(name);
    item.appendChild(document.createTextNode(' · part ' + (s.chunkIndex + 1) + ' · match ' + s.score));

    const snippet = document.createElement('div');
    snippet.className = 'source-snippet';
    snippet.textContent = s.snippet;
    item.appendChild(snippet);

    details.appendChild(item);
  }

  bubble.appendChild(details);
}

// Reads a streamed answer (Server-Sent Events) and shows it as it arrives
async function readStream(res, bubble) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let finished = false;
  let errorMessage = '';
  let newConversationId = null;

  function handle(event) {
    if (event.type === 'text') {
      fullText += event.text;
      setBotText(bubble, fullText);              // formatted again as the text grows
      messages.scrollTop = messages.scrollHeight;
    } else if (event.type === 'done') {
      finished = true;
      newConversationId = event.conversationId;
    } else if (event.type === 'error') {
      errorMessage = event.message;
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Each event ends with a blank line
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (!block.startsWith('data: ')) continue;
      try {
        handle(JSON.parse(block.slice(6)));
      } catch {
        /* ignore one broken event */
      }
    }
  }

  return { fullText, finished, errorMessage, conversationId: newConversationId };
}

async function sendMessage(text) {
  addMessage(text, 'user');
  const bubble = addMessage('Thinking...', 'bot');
  busy = true;
  sendBtn.disabled = true;
  let saved = false;

  try {
    const useDocs = useDocsToggle.checked;

    // Plain questions stream. Document questions use the normal route (it returns sources).
    const res = await api(useDocs ? '/api/chat' : '/api/chat/stream', {
      method: 'POST',
      body: JSON.stringify({ message: text, conversationId, useDocuments: useDocs }),
    });

    // Checks that fail before streaming starts come back as normal JSON errors
    if (!res.ok) {
      const data = await res.json();
      bubble.textContent = data.message || 'Something went wrong';
      return;
    }

    if (useDocs) {
      const data = await res.json();
      conversationId = data.conversationId;     // remember the chat for the next question
      setBotText(bubble, data.reply);
      addSources(bubble, data.sources);
      saved = true;
    } else {
      const result = await readStream(res, bubble);
      if (result.conversationId) conversationId = result.conversationId;
      saved = result.fullText !== '';

      if (result.errorMessage) {
        if (result.fullText) setBotText(bubble, result.fullText + '\n\n(' + result.errorMessage + ')');
        else bubble.textContent = result.errorMessage;
      } else if (!result.finished) {
        if (result.fullText) setBotText(bubble, result.fullText + '\n\n(The answer was interrupted.)');
        else bubble.textContent = 'The connection was interrupted. Please try again.';
      }
    }
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