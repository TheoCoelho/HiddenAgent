const MAX_MESSAGES = 20;
const MAX_NOTES_CHARS = 30000;

const SYSTEM_BASE = [
  'Você é um assistente colaborativo de reuniões, integrado a um bloco de notas privado.',
  'Ajude com planejamento, organização de anotações, brainstorming de ideias, resumos e itens de ação.',
  'Responda em português do Brasil, de forma direta e curta: o painel é pequeno, então prefira listas curtas a parágrafos longos.',
  'Se faltar informação, faça uma pergunta objetiva em vez de inventar.',
].join(' ');

function buildSystem(notes) {
  const text = (notes || '').trim().slice(-MAX_NOTES_CHARS);
  if (!text) return SYSTEM_BASE;
  return `${SYSTEM_BASE}\n\nAs anotações atuais do usuário estão entre <notas> e </notas>. `
    + `Use-as como contexto quando forem relevantes, sem repeti-las por inteiro.\n<notas>\n${text}\n</notas>`;
}

// Valida o histórico vindo do renderer e o reduz às últimas mensagens,
// garantindo que comece e termine com uma mensagem do usuário.
function prepareMessages(messages) {
  if (!Array.isArray(messages)) return null;
  const clean = messages.filter((m) =>
    m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());
  const recent = clean.slice(-MAX_MESSAGES);
  while (recent.length && recent[0].role !== 'user') recent.shift();
  if (!recent.length || recent[recent.length - 1].role !== 'user') return null;
  return recent.map(({ role, content }) => ({ role, content }));
}

// ---------------------------------------------------------------- erros com mensagem pronta

// Erro cuja mensagem já é para o usuário (recusa, filtro, limite esgotado antes de escrever).
class AnswerError extends Error {}

const EMPTY_ANSWER = {
  refusal: 'O modelo recusou responder a esta pergunta. Reformule ou escolha outro modelo.',
  content_filter: 'A resposta foi bloqueada pelo filtro de conteúdo do provedor. Reformule a pergunta.',
  max_tokens: 'O modelo esgotou o limite de saída antes de escrever a resposta (gastou tudo pensando). Tente de novo ou escolha outro modelo.',
  length: 'O modelo esgotou o limite de saída antes de escrever a resposta (gastou tudo pensando). Tente de novo ou escolha outro modelo.',
};

// Chamada terminou sem nenhum texto: diz o motivo em vez de mostrar uma resposta vazia.
const emptyAnswer = (reason) =>
  new AnswerError(EMPTY_ANSWER[reason] || 'O modelo não devolveu nenhum texto. Tente novamente.');

// ---------------------------------------------------------------- provedores

// Sonnet 5, Opus 5 e Fable 5.1 pensam por conta própria (thinking adaptativo, sem parâmetro).
// O esforço controla quanto pensam e, com isso, a latência da primeira palavra.
// Os tokens de pensamento contam no limite de saída, por isso o limite é folgado.
async function streamAnthropic({ apiKey, model, system, messages, maxTokens, signal, onText }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const params = { model: model.id, max_tokens: maxTokens, system, messages };
  if (model.effort) params.output_config = { effort: model.effort };

  // Nos modelos mais capazes, uma recusa por política é reenviada no servidor a um modelo substituto.
  const stream = model.fallbacks
    ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
    : client.messages.stream(params, { signal });

  let emitted = false;
  stream.on('text', (text) => { emitted = true; onText(text); });
  const message = await stream.finalMessage();
  if (!emitted) throw emptyAnswer(message.stop_reason);
}

async function streamOpenAI({ apiKey, model, system, messages, maxTokens, signal, onText }) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey });
  const stream = await client.chat.completions.create({
    model: model.id,
    stream: true,
    max_completion_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, ...messages],
  }, { signal });

  let emitted = false;
  let finish = null;
  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    const text = choice?.delta?.content;
    if (text) { emitted = true; onText(text); }
  }
  // O SDK encerra o loop sem erro quando cancelado; nesse caso o vazio é esperado.
  if (!emitted && !signal?.aborted) throw emptyAnswer(finish);
}

const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    envModel: 'NOTAS_MODEL',
    defaultModel: 'claude-sonnet-5',
    keyHint: 'sk-ant-…',
    maxTokens: 16000,
    models: [
      { id: 'claude-sonnet-5', label: 'Sonnet 5 — equilibrado (padrão)', effort: 'medium' },
      { id: 'claude-opus-5', label: 'Opus 5 — mais capaz', effort: 'medium', fallbacks: true },
      { id: 'claude-fable-5-1', label: 'Fable 5.1 — máxima capacidade (mais caro)', effort: 'medium', fallbacks: true },
    ],
    stream: streamAnthropic,
  },
  openai: {
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    envModel: 'NOTAS_OPENAI_MODEL',
    // Padrão sem raciocínio: responde rápido e não gasta o limite de saída com tokens ocultos.
    defaultModel: 'gpt-4.1-mini',
    keyHint: 'sk-…',
    // Folga para os modelos de raciocínio, cujos tokens ocultos contam neste limite.
    maxTokens: 8000,
    models: [
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini — rápido (padrão)' },
      { id: 'gpt-4.1', label: 'GPT-4.1 — mais capaz' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini — com raciocínio' },
      { id: 'gpt-5.5', label: 'GPT-5.5 — mais capaz, com raciocínio' },
    ],
    stream: streamOpenAI,
  },
};

const isProvider = (id) => Object.prototype.hasOwnProperty.call(PROVIDERS, id);

// Lista de modelos do provedor. Um modelo definido por variável de ambiente entra como opção extra.
function modelsOf(provider) {
  const p = PROVIDERS[provider];
  const list = [...p.models];
  const fromEnv = process.env[p.envModel];
  if (fromEnv && !list.some((m) => m.id === fromEnv)) list.push({ id: fromEnv, label: `${fromEnv} (${p.envModel})` });
  return list;
}

const isModel = (provider, id) => isProvider(provider) && typeof id === 'string' && modelsOf(provider).some((m) => m.id === id);

// Escolha salva > variável de ambiente > padrão. Escolha inválida (modelo que saiu da lista) é ignorada.
function resolveModel(provider, chosen) {
  const list = modelsOf(provider);
  const p = PROVIDERS[provider];
  const find = (id) => list.find((m) => m.id === id);
  return find(chosen) || find(process.env[p.envModel]) || find(p.defaultModel);
}

// Dados dos provedores para a interface (sem funções nem segredos).
function describeProviders(chosenModels = {}) {
  return Object.entries(PROVIDERS).map(([id, p]) => ({
    id,
    label: p.label,
    envKey: p.envKey,
    envModel: p.envModel,
    keyHint: p.keyHint,
    models: modelsOf(id).map(({ id: modelId, label }) => ({ id: modelId, label })),
    model: resolveModel(id, chosenModels?.[id]).id,
  }));
}

async function streamAnswer({ provider = 'anthropic', model, apiKey, messages, notes, signal, onText }) {
  if (!isProvider(provider)) throw new Error(`Provedor desconhecido: ${provider}`);
  const p = PROVIDERS[provider];
  await p.stream({
    apiKey,
    model: resolveModel(provider, model),
    system: buildSystem(notes),
    messages,
    maxTokens: p.maxTokens,
    signal,
    onText,
  });
}

// Traduz erros das APIs em mensagens curtas para mostrar na janela.
function friendlyError(err, provider = 'anthropic') {
  if (err instanceof AnswerError) return err.message;
  const { label, envModel } = PROVIDERS[isProvider(provider) ? provider : 'anthropic'];
  if (err?.code === 'insufficient_quota') return `Sem saldo ou cota na conta da ${label}. Confira o faturamento.`;
  if (err?.status === 401) return `Chave da ${label} inválida ou sem permissão. Confira a chave.`;
  if (err?.status === 403) return 'A chave não tem acesso a este modelo. Escolha outro modelo.';
  if (err?.status === 404) return `Modelo indisponível nesta conta. Escolha outro modelo (ou defina o seu em ${envModel}).`;
  if (err?.status === 429) return 'Limite de uso atingido. Tente de novo em instantes.';
  if (err?.status >= 500) return `A API da ${label} está instável no momento. Tente novamente.`;
  if (err?.status === 400) return `Requisição recusada pela ${label}: ${err.message}`;
  if (/connection|fetch failed|ENOTFOUND|ECONN/i.test(`${err?.name} ${err?.message}`)) {
    return 'Sem conexão com a API. Verifique a internet.';
  }
  return `Erro inesperado: ${err?.message || err}`;
}

module.exports = {
  streamAnswer, prepareMessages, buildSystem, friendlyError, describeProviders,
  isProvider, isModel, resolveModel, PROVIDERS,
};
