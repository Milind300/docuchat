const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const messages = document.getElementById('messages');

// Add one bubble to the screen
function addMessage(text, role) {
  const div = document.createElement('div');
  div.className = 'message ' + role;   // "message user" or "message bot"
  div.textContent = text;              // textContent is safe: it never runs HTML
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight; // scroll to the newest message
  return div;
}

// Pretend bot reply (we replace this with a real server call in Phase 4)
function fakeBotReply(userText) {
  const bubble = addMessage('Typing...', 'bot');
  setTimeout(() => {
    bubble.textContent = 'This is a fake reply to: "' + userText + '"';
  }, 800);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();              // stop the page from reloading
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, 'user');
  input.value = '';
  fakeBotReply(text);
});

addMessage('Hi! Ask me anything. (Replies are fake for now.)', 'bot');