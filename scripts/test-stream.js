import 'dotenv/config';
import { streamReply } from '../src/services/gemini.js';

const started = Date.now();
let pieces = 0;

try {
  const question = [{ role: 'user', content: 'Explain what an API is in about 100 words.' }];

  for await (const part of streamReply(question)) {
    const ms = Date.now() - started;
    if (part.type === 'text') {
      pieces++;
      console.log(`[${ms} ms] piece ${pieces}:`, JSON.stringify(part.text));
    } else {
      console.log(`[${ms} ms] DONE  tokensIn=${part.tokensIn}  tokensOut=${part.tokensOut}`);
    }
  }
  console.log('Total pieces received:', pieces);
} catch (err) {
  console.error('Stream failed.');
  console.error('Status:', err.status);
  console.error('Message:', err.message);
}