// Turns a small, safe subset of Markdown into page elements.
// It never uses innerHTML, so text from the AI cannot inject HTML or scripts.

const BULLET = /^\s*[*-]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const FENCE = /^\s*```/;

// Adds text to `parent`, turning **bold** and `code` into elements
function renderInline(text, parent) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      const el = document.createElement('strong');
      el.textContent = part.slice(2, -2);
      parent.appendChild(el);
    } else if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      const el = document.createElement('code');
      el.textContent = part.slice(1, -1);
      parent.appendChild(el);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
}

function startsNewBlock(line) {
  return FENCE.test(line) || BULLET.test(line) || NUMBERED.test(line);
}

function renderMarkdown(text) {
  const fragment = document.createDocumentFragment();
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block: ``` ... ```
    if (FENCE.test(line)) {
      const codeLines = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = codeLines.join('\n');
      pre.appendChild(code);
      fragment.appendChild(pre);
      continue;
    }

    // Bullet list or numbered list
    const isBullet = BULLET.test(line);
    if (isBullet || NUMBERED.test(line)) {
      const marker = isBullet ? BULLET : NUMBERED;
      const list = document.createElement(isBullet ? 'ul' : 'ol');
      while (i < lines.length && marker.test(lines[i])) {
        const li = document.createElement('li');
        renderInline(lines[i].replace(marker, ''), li);
        list.appendChild(li);
        i++;
      }
      fragment.appendChild(list);
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Normal paragraph: keep going until a blank line or a new block starts
    const paragraphLines = [];
    while (i < lines.length && lines[i].trim() && !startsNewBlock(lines[i])) {
      paragraphLines.push(lines[i]);
      i++;
    }
    const p = document.createElement('p');
    renderInline(paragraphLines.join('\n'), p);
    fragment.appendChild(p);
  }

  return fragment;
}