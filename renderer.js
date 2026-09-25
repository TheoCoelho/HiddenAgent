const $ = (id) => document.getElementById(id);

const notas = $('notas');
const opacidade = $('opacidade');
const protecao = $('protecao');
const chat = $('chat');
const pergunta = $('pergunta');
const enviar = $('enviar');
const setup = $('chave-setup');

// ---------------------------------------------------------------- notas

function renderProtecao(ativa) {
  protecao.textContent = ativa ? 'Oculta na captura' : 'VISÍVEL na captura';
  protecao.className = `badge ${ativa ? 'on' : 'off'}`;
}

(async () => {
  const state = await window.api.getState();
  notas.value = state.text;
  opacidade.value = state.opacity;
  renderProtecao(state.captureProtected);
})();

let timer;
const salvar = () => { clearTimeout(timer); window.api.saveText(notas.value); };

notas.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(salvar, 300);
});
notas.addEventListener('blur', salvar);

opacidade.addEventListener('input', () => window.api.setOpacity(opacidade.value));
protecao.addEventListener('click', async () => renderProtecao(await window.api.toggleProtection()));
$('minimizar').addEventListener('click', () => window.api.minimize());
$('fechar').addEventListener('click', () => { salvar(); window.api.quit(); });

// ---------------------------------------------------------------- abas

function abrirAba(nome) {
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.aba === nome);
  $('aba-notas').hidden = nome !== 'notas';
  $('aba-assistente').hidden = nome !== 'assistente';
  (nome === 'notas' ? notas : pergunta).focus();
  if (nome === 'assistente') atualizarChave();
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => abrirAba(tab.dataset.aba));
}

// ---------------------------------------------------------------- chave da API

const provedor = $('provedor');
const modelo = $('modelo');
let estadoIA = null; // { provider, providers: [{ id, label, envKey, keyHint, keySource, model, models: [{ id, label }] }] }

const provedorAtual = () => estadoIA.providers.find((p) => p.id === estadoIA.provider);

function desenharProvedor() {
  if (!provedor.options.length) {
    for (const p of estadoIA.providers) provedor.append(new Option(p.label, p.id));
  }
  provedor.value = estadoIA.provider;

  const p = provedorAtual();
  modelo.replaceChildren(...p.models.map((m) => new Option(m.label, m.id)));
  modelo.value = p.model;
  $('chave-texto').textContent = `Cole sua chave da API da ${p.label}. Ela fica criptografada neste computador e nunca é exibida aqui.`;
  $('chave-input').placeholder = p.keyHint;
  $('chave-dica').textContent = `Alternativa: definir a variável de ambiente ${p.envKey} antes de abrir o app.`;
  setup.hidden = p.keySource !== null;
  $('chave-erro').hidden = true;
}

async function atualizarChave(novoStatus) {
  estadoIA = novoStatus || await window.api.aiStatus();
  desenharProvedor();
  desenharVazio();
}

provedor.addEventListener('change', async () => atualizarChave(await window.api.setProvider(provedor.value)));
modelo.addEventListener('change', async () => atualizarChave(await window.api.setModel(estadoIA.provider, modelo.value)));

$('chave-salvar').addEventListener('click', async () => {
  const resultado = await window.api.setKey(estadoIA.provider, $('chave-input').value);
  if (!resultado.ok) {
    $('chave-erro').textContent = resultado.error;
    $('chave-erro').hidden = false;
    return;
  }
  $('chave-input').value = '';
  await atualizarChave();
  pergunta.focus();
});

$('trocar-chave').addEventListener('click', async () => {
  if (!estadoIA) return;
  const p = provedorAtual();
  if (p.keySource === 'app') estadoIA = await window.api.clearKey(p.id);
  // Se a chave vem da variável de ambiente, o app só mostra o formulário para salvar outra por cima.
  setup.hidden = false;
  $('chave-input').focus();
});

// ---------------------------------------------------------------- chat

let historico = [];   // [{ role, content }] das trocas concluídas
let ocupado = false;
let balaoAtual = null;
let respostaAtual = '';
let ultimaPergunta = '';

function desenharVazio() {
  if (chat.querySelector('.msg')) return;
  chat.replaceChildren();
  const aviso = document.createElement('div');
  aviso.className = 'vazio';
  aviso.textContent = 'Pergunte algo ou use os atalhos abaixo. O assistente lê suas notas quando "Usar notas como contexto" está marcado.';
  chat.append(aviso);
}

function novaMensagem(tipo, texto) {
  chat.querySelector('.vazio')?.remove();
  const div = document.createElement('div');
  div.className = `msg ${tipo}`;
  div.textContent = texto;
  chat.append(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function definirOcupado(valor) {
  ocupado = valor;
  enviar.textContent = valor ? 'Parar' : 'Enviar';
  enviar.classList.toggle('parar', valor);
  provedor.disabled = valor;
  modelo.disabled = valor;
  for (const chip of document.querySelectorAll('.chip')) chip.disabled = valor;
}

function adicionarAcoes(balao, texto) {
  const acoes = document.createElement('div');
  acoes.className = 'acoes';
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'botao mini';
  botao.textContent = 'Inserir nas notas';
  botao.addEventListener('click', () => {
    notas.value += `${notas.value && !notas.value.endsWith('\n') ? '\n\n' : ''}${texto}\n`;
    salvar();
    botao.textContent = 'Inserido ✓';
    botao.disabled = true;
  });
  acoes.append(botao);
  balao.append(acoes);
}

function perguntar(texto, { forcarNotas = false } = {}) {
  const conteudo = texto.trim();
  if (!conteudo || ocupado) return;

  ultimaPergunta = conteudo;
  novaMensagem('user', conteudo);
  balaoAtual = novaMensagem('ai pensando', '');
  respostaAtual = '';
  definirOcupado(true);

  window.api.ask({
    messages: [...historico, { role: 'user', content: conteudo }],
    includeNotes: forcarNotas || $('usar-notas').checked,
    notes: notas.value,
  });
}

// Encerra a pergunta em andamento e devolve o balão dela (null se a conversa foi limpa no meio).
function encerrar() {
  const balao = balaoAtual;
  balaoAtual = null;
  definirOcupado(false);
  return balao;
}

window.api.onAi({
  chunk(texto) {
    if (!balaoAtual) return;
    balaoAtual.classList.remove('pensando');
    respostaAtual += texto;
    balaoAtual.textContent = respostaAtual;
    if (chat.scrollHeight - chat.scrollTop - chat.clientHeight < 60) chat.scrollTop = chat.scrollHeight;
  },

  done() {
    const balao = encerrar();
    if (!balao) return;
    if (respostaAtual) {
      historico.push({ role: 'user', content: ultimaPergunta }, { role: 'assistant', content: respostaAtual });
      balao.classList.remove('pensando');
      adicionarAcoes(balao, respostaAtual);
    } else {
      balao.remove(); // parou antes de chegar qualquer texto
    }
  },

  error(mensagem) {
    const balao = encerrar();
    if (balao) {
      balao.className = 'msg erro';
      balao.textContent = mensagem;
      if (!pergunta.value) pergunta.value = ultimaPergunta; // devolve a pergunta para tentar de novo
    } else {
      novaMensagem('erro', mensagem);
    }
    if (/chave/i.test(mensagem)) atualizarChave();
  },
});

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (ocupado) return window.api.abort();
  const texto = pergunta.value;
  if (!texto.trim()) return;
  pergunta.value = '';
  perguntar(texto);
});

pergunta.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('form').requestSubmit();
  }
});

for (const chip of document.querySelectorAll('.chip')) {
  chip.addEventListener('click', () => perguntar(chip.dataset.prompt, { forcarNotas: true }));
}

$('limpar').addEventListener('click', () => {
  if (ocupado) {
    window.api.abort();
    balaoAtual = null; // o evento de conclusão que chegar depois é descartado
    respostaAtual = '';
  }
  historico = [];
  chat.replaceChildren();
  desenharVazio();
});

atualizarChave(); // já preenche o seletor de provedor
