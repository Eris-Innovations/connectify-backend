/**
 * Smoke-test Groq using keys already loaded from backend/.env
 * Run from backend/:  npm run test:groq
 *   or: node --import tsx scripts/test-groq.ts
 */
import { env } from '../src/config/env';
import { probeLlmProviders } from '../src/modules/connecty/connecty.llm';

async function main() {
  console.log('CONNECTY_LLM_PROVIDER=', env.CONNECTY_LLM_PROVIDER);
  console.log('GROQ_API_KEY set=', Boolean(env.GROQ_API_KEY?.trim()), 'len=', env.GROQ_API_KEY?.length ?? 0);
  console.log('GROQ_MODEL=', env.GROQ_MODEL);
  console.log('GEMINI_API_KEY set=', Boolean(env.GEMINI_API_KEY?.trim()));

  const status = await probeLlmProviders();
  console.log(JSON.stringify(status, null, 2));

  if (!status.groq.ok) {
    console.error('\nGroq failed. Common fixes:');
    console.error('1) Key expires/revoked → create new key at https://console.groq.com/keys');
    console.error('2) Keys only on local .env but app talks to production API → add GROQ_API_KEY on the server and restart');
    console.error('3) Network firewall blocking api.groq.com');
    process.exitCode = 1;
  } else {
    console.log('\nGroq is workable.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
