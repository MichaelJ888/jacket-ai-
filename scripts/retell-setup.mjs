// Provisions the Retell voice agent for inbound calls (idempotent: re-running updates the same LLM/agent).
// Usage: set RETELL_API_KEY and ADMIN_TOKEN (shell or .env.local), then `npm run voice:setup`.
import { existsSync, readFileSync } from 'node:fs';

const envPath = new URL('../.env.local', import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^"|"$/g, '');
  }
}

const apiKey = process.env.RETELL_API_KEY;
const adminToken = process.env.ADMIN_TOKEN || process.env.ADMIN_PASSWORD;
const base = (process.env.APP_BASE_URL || 'https://jacket-ai.vercel.app').replace(/\/$/, '');
if (!apiKey || !adminToken) {
  console.error('Set RETELL_API_KEY and ADMIN_TOKEN first (see docs/VOICE_AI.md).');
  process.exit(1);
}

async function retell(path, method, body) {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

const promptRes = await fetch(`${base}/api/voice-call/prompt`, { headers: { Authorization: `Bearer ${adminToken}` }, signal: AbortSignal.timeout(15000) });
if (!promptRes.ok) throw new Error(`Could not load prompt (${promptRes.status}). Check ADMIN_TOKEN.`);
const { general_prompt: prompt, custom_functions_url: toolsUrl, webhook_url: webhookUrl } = await promptRes.json();

const obj = (properties, required) => ({ type: 'object', properties, required });
const str = (description) => ({ type: 'string', description });
const generalTools = [
  { type: 'custom', name: 'check_order_status', description: 'Look up the stage of an order. Only after the caller gives their order number.', url: toolsUrl, method: 'POST', timeout_ms: 8000, speak_during_execution: true, execution_message_description: 'Say you are checking the order now.', parameters: obj({ order_number: str('Order number the caller gave') }, ['order_number']) },
  { type: 'custom', name: 'create_lead', description: 'Save a new customer inquiry after getting their name and what they need.', url: toolsUrl, method: 'POST', timeout_ms: 8000, speak_during_execution: false, parameters: obj({ name: str('Caller name'), request: str('What they need: item, quantity, deadline'), contact: str('Alternate contact number, only if the caller gives one') }, ['name', 'request']) },
  { type: 'custom', name: 'request_human_callback', description: 'Alert the team for an urgent issue, an angry caller, or when the caller asks for a person.', url: toolsUrl, method: 'POST', timeout_ms: 8000, speak_during_execution: false, parameters: obj({ reason: str('Why a human should call back') }, ['reason']) },
  { type: 'end_call', name: 'end_call', description: 'End the call once the caller has nothing else to ask.' },
];

const llmBody = {
  general_prompt: prompt,
  general_tools: generalTools,
  start_speaker: 'agent',
  begin_message: 'Hello, thank you for calling MJIC. Pasensya na po, wala pa po ang team ngayon. Ako po ang AI assistant. Paano ko po kayo matutulungan?',
};

const llmId = process.env.RETELL_LLM_ID;
const llm = llmId ? await retell(`/update-retell-llm/${llmId}`, 'PATCH', llmBody) : await retell('/create-retell-llm', 'POST', llmBody);
console.log(`LLM: ${llm.llm_id}${llmId ? ' (updated)' : ''}`);

const agentBody = {
  agent_name: 'MJIC Receptionist',
  response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
  language: 'en-US',
  webhook_url: webhookUrl,
  max_call_duration_ms: 5 * 60 * 1000,
  end_call_after_silence_ms: 20 * 1000,
  voicemail_option: { action: { type: 'hangup' } },
};

const agentId = process.env.RETELL_AGENT_ID;
let agent;
if (agentId) {
  agent = await retell(`/update-agent/${agentId}`, 'PATCH', agentBody);
} else {
  const voices = await retell('/list-voices', 'GET');
  const voice = voices.find((v) => /elevenlabs|cartesia/i.test(v.provider || '')) || voices[0];
  if (!voice) throw new Error('No Retell voices available');
  agent = await retell('/create-agent', 'POST', { ...agentBody, voice_id: voice.voice_id });
}
console.log(`Agent: ${agent.agent_id}${agentId ? ' (updated)' : ''}`);
console.log('\nNext: put RETELL_API_KEY and RETELL_AGENT_ID in Vercel env, assign the agent to your inbound number in Retell, then forward missed calls (docs/VOICE_AI.md).');
if (!llmId) console.log(`Re-run later with RETELL_LLM_ID=${llm.llm_id} RETELL_AGENT_ID=${agent.agent_id} to update instead of create.`);
