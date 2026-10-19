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

// ---------- Typing effect ----------
const TYPE_TICK_MS = 25;    // how often new characters are revealed
const TYPE_MIN_CHARS = 3;   // never reveal fewer characters than this per tick
const TYPE_CATCHUP = 15;    // a bigger backlog is revealed faster (backlog / 15 per tick)

// While text is half-typed, hide a dangling ** so the page never flashes raw asterisks
function stabilize(text) {
  const open = (s) => (s.match(/\*\*/g) || []).length % 2 === 1;
  if (!open(text)) return text;
  let t = text.replace(/\*+$/, '');   // drop a half-typed marker at the very end
  if (open(t)) t += '**';             // close a bold section that is still open
  return t;
}

function createTyper(bubble) {
  const instant = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let target = '';       // everything received so far
  let shown = 0;         // how many characters are visible
  let timer = null;
  let onDrained = null;

  function paint() {
    setBotText(bubble, stabilize(target.slice(0, shown)));
    messages.scrollTop = messages.scrollHeight;
  }

  function step() {
    const backlog = target.length - shown;
    if (backlog <= 0) {
      clearInterval(timer);
      timer = null;
      if (onDrained) onDrained();
      return;
    }
    shown += Math.min(backlog, Math.max(TYPE_MIN_CHARS, Math.ceil(backlog / TYPE_CATCHUP)));
    paint();
  }

  return {
    push(text) {
      target += text;
      if (instant) {
        shown = target.length;
        paint();
      } else if (!timer) {
        timer = setInterval(step, TYPE_TICK_MS);
      }
    },
    // Resolves when everything received has been shown
    finish() {
      return new Promise((resolve) => {
        if (instant || (!timer && shown >= target.length)) return resolve();
        onDrained = resolve;
      });
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

// Reads a streamed answer (Server-Sent Events) and types it out as it arrives
async function readStream(res, bubble) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const typer = createTyper(bubble);
  let buffer = '';
  let fullText = '';
  let finished = false;
  let errorMessage = '';
  let newConversationId = null;

  function handle(event) {
    if (event.type === 'text') {
      fullText += event.text;
      typer.push(event.text);
    } else if (event.type === 'done') {
      finished = true;
      newConversationId = event.conversationId;
    } else if (event.type === 'error') {
      errorMessage = event.message;
    }
  }

  try {
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

    await typer.finish();                         // let the typing catch up
    if (fullText) setBotText(bubble, fullText);   // final, exact text
  } finally {
    typer.stop();                                 // never leave a timer running
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
// ---------- My usage (analytics) ----------
const usageBtn = document.getElementById('usage-btn');
const usageDialog = document.getElementById('usage-dialog');
const usageClose = document.getElementById('usage-close');
const usageBody = document.getElementById('usage-body');

const BAR_MAX_PX = 80;
const fmt = (n) => Number(n).toLocaleString();
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;   // textContent keeps everything safe
  return node;
}

// "2026-10-18" becomes a date at UTC midnight, so no time zone can shift the day
function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const dayText = (s) => parseDay(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function renderUsage(summary, docInfo) {
  usageBody.textContent = '';
  const { days, totals, today } = summary;

  // ----- Today -----
  const c1 = el('section', 'usage-card');
  c1.appendChild(el('h3', null, 'Today'));
  c1.appendChild(el('p', 'usage-big', today.questions + ' of ' + today.limit + ' questions used'));
  const meter = el('div', 'meter');
  meter.setAttribute('role', 'progressbar');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', String(today.limit));
  meter.setAttribute('aria-valuenow', String(today.questions));
  const fill = el('span');
  fill.style.width = Math.min(100, Math.round((today.questions / today.limit) * 100)) + '%';
  meter.appendChild(fill);
  if (today.questions >= today.limit) meter.classList.add('full');
  c1.appendChild(meter);
  c1.appendChild(el('p', 'usage-note', 'Resets at midnight Pacific Time. Deleting a chat does not give questions back.'));
  usageBody.appendChild(c1);

  // ----- Last days -----
  const c2 = el('section', 'usage-card');
  c2.appendChild(el('h3', null, 'Last ' + days.length + ' days'));
  c2.appendChild(el('p', 'usage-note', dayText(days[0].date) + ' to ' + dayText(days[days.length - 1].date) + ' (Pacific time)'));

  const tiles = el('div', 'usage-tiles');
  [[totals.questions, 'questions'], [totals.tokensIn, 'tokens in'], [totals.tokensOut, 'tokens out']].forEach(([value, label]) => {
    const tile = el('div', 'usage-tile');
    tile.appendChild(el('strong', null, fmt(value)));
    tile.appendChild(el('span', null, label));
    tiles.appendChild(tile);
  });
  c2.appendChild(tiles);

  const max = Math.max(1, ...days.map((d) => d.questions));
  const bars = el('div', 'bars');
  bars.setAttribute('role', 'img');
  bars.setAttribute('aria-label', 'Questions per day: ' + plural(totals.questions, 'question') + ' in ' + days.length + ' days');
  days.forEach((d, i) => {
    const col = el('div', 'bar-col' + (i === days.length - 1 ? ' today' : ''));
    col.title = dayText(d.date) + ': ' + plural(d.questions, 'question') + ', ' + fmt(d.tokensIn) + ' tokens in, ' + fmt(d.tokensOut) + ' out';
    col.appendChild(el('span', 'bar-value', d.questions ? String(d.questions) : ''));
    const bar = el('span', 'bar-fill' + (d.questions === 0 ? ' zero' : ''));
    bar.style.height = (d.questions === 0 ? 2 : Math.max(4, Math.round((d.questions / max) * BAR_MAX_PX))) + 'px';
    col.appendChild(bar);
    col.appendChild(el('span', 'bar-label', String(parseDay(d.date).getUTCDate())));
    bars.appendChild(col);
  });
  c2.appendChild(bars);
  c2.appendChild(el('p', 'usage-note', 'Hover a bar for that day\'s tokens. Output tokens are undercounted if you delete chats.'));
  usageBody.appendChild(c2);

  // ----- Documents -----
  const c3 = el('section', 'usage-card');
  c3.appendChild(el('h3', null, 'Your documents'));
  const docs = docInfo.documents;

  if (docs.length === 0) {
    c3.appendChild(el('p', 'usage-note', 'No documents yet.'));
  } else {
    const maxAnswers = Math.max(1, ...docs.map((d) => d.answers));
    docs.forEach((d) => {
      const row = el('div', 'doc-row');

      const top = el('div', 'doc-row-top');
      top.appendChild(el('span', 'doc-row-name', d.filename));
      top.appendChild(el('span', 'doc-row-stat',
        d.answers ? plural(d.answers, 'answer') + ' · ' + plural(d.passages, 'passage') : 'Never cited'));
      row.appendChild(top);

      const m = el('div', 'meter small');
      const f = el('span');
      f.style.width = Math.round((d.answers / maxAnswers) * 100) + '%';
      m.appendChild(f);
      row.appendChild(m);

      let sub = plural(d.chunkCount, 'part');
      if (d.status !== 'READY') sub += ' · ' + d.status.toLowerCase();
      if (d.lastCitedAt) {
        sub += ' · last cited ' + new Date(d.lastCitedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }
      row.appendChild(el('div', 'doc-row-sub', sub));

      c3.appendChild(row);
    });
  }
  usageBody.appendChild(c3);
}

async function openUsage() {
  usageBody.textContent = '';
  usageBody.appendChild(el('p', 'usage-note', 'Loading...'));
  if (!usageDialog.open) usageDialog.showModal();

  try {
    const [a, b] = await Promise.all([api('/api/analytics/summary?days=14'), api('/api/analytics/documents')]);
    if (!a.ok || !b.ok) throw new Error('request failed');
    renderUsage(await a.json(), await b.json());
  } catch (err) {
    if (err.message === 'unauthorized') {   // api() already sent us back to the login screen
      usageDialog.close();
      return;
    }
    usageBody.textContent = '';
    usageBody.appendChild(el('p', 'usage-note', 'Could not load your usage. Please try again.'));
  }
}

// Only wire up the usage screen if its HTML is on the page, so a missing piece can never break the app
if (usageBtn && usageDialog && usageClose && usageBody) {
  usageBtn.addEventListener('click', openUsage);
  usageClose.addEventListener('click', () => usageDialog.close());
  usageDialog.addEventListener('click', (e) => {
    if (e.target === usageDialog) usageDialog.close();   // a click on the dimmed area
  });
}

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