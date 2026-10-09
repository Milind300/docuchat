import { chunkText } from '../src/services/chunker.js';

// A sample "document": 120 numbered sentences, with a paragraph break every 10
const sentences = Array.from(
  { length: 120 },
  (_, i) => `This is sentence number ${i + 1} of the sample document.`
);
let text = '';
sentences.forEach((s, i) => {
  text += s + (i % 10 === 9 ? '\n\n' : ' ');
});

const chunks = chunkText(text);
console.log('Text length:', text.length, 'characters');
console.log('Chunks:', chunks.length);
console.log('Longest chunk:', Math.max(...chunks.map((c) => c.length)));
console.log('');

chunks.forEach((c, i) => {
  const overlaps = i > 0 && chunks[i - 1].slice(-150).includes(c.slice(0, 30));
  console.log(
    `#${i + 1}`.padEnd(4),
    String(c.length).padStart(3),
    'chars | starts:', JSON.stringify(c.slice(0, 28)),
    '| ends:', JSON.stringify(c.slice(-20)),
    i > 0 ? '| overlaps previous: ' + (overlaps ? 'yes' : 'NO') : ''
  );
});

console.log('');
console.log('Empty text   ->', chunkText('').length, 'chunks');
console.log('Short text   ->', chunkText('Just one short sentence.').length, 'chunk');