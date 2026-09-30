# HiddenAgent

Bloco de notas e assistente de IA em uma janelinha flutuante que **não aparece na captura de tela**.
Serve para anotar e pedir ajuda durante reuniões (Meet, Zoom, Teams…) sem que as anotações e as respostas
apareçam no compartilhamento de tela, em prints ou em gravações.

Aplicativo desktop feito com [Electron](https://www.electronjs.org/). Desenvolvido e testado no Windows 11.

---

## Sumário

- [Recursos](#recursos)
- [Como funciona a ocultação](#como-funciona-a-ocultação)
- [Requisitos](#requisitos)
- [Instalação e execução](#instalação-e-execução)
- [Iniciar com o Windows](#iniciar-com-o-windows)
- [Configurando o assistente de IA](#configurando-o-assistente-de-ia)
- [Uso](#uso)
- [Onde ficam os dados e o que sai do computador](#onde-ficam-os-dados-e-o-que-sai-do-computador)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Decisões de segurança](#decisões-de-segurança)
- [Limitações](#limitações)
- [Solução de problemas](#solução-de-problemas)

---

## Recursos

**Janela**
- Sem moldura, sempre no topo (acima de outras janelas, inclusive as em tela cheia) e **sem ícone na barra de tarefas**.
- Atalho global **Ctrl+Alt+H** para mostrar/ocultar, funcionando mesmo com outro programa em foco.
- Opacidade ajustável (30% a 100%) por um controle deslizante na barra de título.
- Lembra tamanho e posição; se o monitor anterior não existir mais, a janela abre dentro da tela.
- Instância única: abrir de novo apenas traz a janela de volta.

**Notas**
- Editor de texto simples com salvamento automático (300 ms depois de parar de digitar, ao perder o foco e ao fechar).

**Assistente de IA**
- Chat com respostas em *streaming*, botão **Parar** para interromper e **Limpar** para zerar a conversa.
- Atalhos prontos: **Resumir**, **Itens de ação** e **Ideias**, que usam as suas notas como contexto.
- Opção **Usar notas como contexto** (envia até os últimos 30.000 caracteres das notas junto com a pergunta).
- Botão **Inserir nas notas** em cada resposta.
- Dois provedores à escolha, com seleção de modelo: **Anthropic** e **OpenAI**.
- Mensagens de erro em português para os casos comuns (chave inválida, sem saldo, limite de uso, modelo indisponível, sem internet).

## Como funciona a ocultação

A janela usa `BrowserWindow.setContentProtection(true)` do Electron. No Windows isso marca a janela com
`WDA_EXCLUDEFROMCAPTURE`: ela continua visível para você, mas é excluída de capturas de tela e de
compartilhamento de tela feitos por software.

A etiqueta na barra de título mostra o estado:

| Etiqueta | Significado |
| --- | --- |
| **Oculta na captura** (verde) | Proteção ligada. |
| **VISÍVEL na captura** (vermelha) | Proteção desligada. Clique na etiqueta para alternar. |

A proteção **sempre começa ligada** a cada abertura do app. O estado não é salvo de propósito, para que um
"desliguei para testar" nunca sobreviva a um reinício.

## Requisitos

- **Windows 10 (versão 2004 ou mais nova) ou Windows 11.** Em versões anteriores do Windows 10, a janela aparece
  como um retângulo preto na captura em vez de sumir.
- [Node.js](https://nodejs.org/) (versão LTS recente) com npm.
- Uma chave de API da [Anthropic](https://console.anthropic.com/) e/ou da [OpenAI](https://platform.openai.com/)
  para usar o assistente. As notas funcionam sem chave.

## Instalação e execução

```bash
git clone https://github.com/TheoCoelho/HiddenAgent.git
cd HiddenAgent
npm install
npm start
```

Sem abrir terminal (Windows): dê dois cliques em **`iniciar.vbs`**. Ele inicia o app em segundo plano,
sem janela de console.

Para abrir **sem mostrar a janela** (ela só aparece pelo Ctrl+Alt+H), passe `--oculto`:

```bash
npm start -- --oculto
```

ou, no Windows, `wscript iniciar.vbs --oculto`.

## Iniciar com o Windows

Crie um atalho para o `iniciar.vbs` na pasta de inicialização (`shell:startup`). No PowerShell, dentro da
pasta do projeto:

```powershell
$atalho = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\HiddenAgent.lnk")
$atalho.TargetPath = "$env:WINDIR\System32\wscript.exe"
$atalho.Arguments = "`"$PWD\iniciar.vbs`" --oculto"
$atalho.WorkingDirectory = "$PWD"
$atalho.Save()
```

Com `--oculto`, o app sobe junto com o Windows sem abrir a janela. Se você mover a pasta do projeto, recrie o atalho.

## Configurando o assistente de IA

Abra a aba **Assistente**. Na primeira vez, o app pede a chave do provedor selecionado. Há duas formas de fornecê-la:

1. **Pelo app (recomendado):** cole a chave no campo e clique em **Salvar**. Ela é gravada
   **criptografada** com o `safeStorage` do Electron (no Windows, DPAPI, atrelada à sua conta do Windows) e nunca
   é exibida de volta. O botão **Chave** remove a chave salva para você trocá-la.
2. **Por variável de ambiente**, definida antes de abrir o app:

   | Provedor | Chave | Modelo extra (opcional) |
   | --- | --- | --- |
   | Anthropic | `ANTHROPIC_API_KEY` | `NOTAS_MODEL` |
   | OpenAI | `OPENAI_API_KEY` | `NOTAS_OPENAI_MODEL` |

   Se existirem as duas, a chave salva no app tem prioridade. Um modelo definido por variável de ambiente entra
   como opção extra no seletor.

### Modelos disponíveis

| Provedor | Modelo | Observação |
| --- | --- | --- |
| Anthropic | `claude-sonnet-5` | Equilibrado. **Padrão.** |
| Anthropic | `claude-opus-5` | Mais capaz. |
| Anthropic | `claude-fable-5-1` | Máxima capacidade, mais caro. |
| OpenAI | `gpt-4.1-mini` | Rápido, sem raciocínio. **Padrão.** |
| OpenAI | `gpt-4.1` | Mais capaz. |
| OpenAI | `gpt-5.4-mini` | Com raciocínio. |
| OpenAI | `gpt-5.5` | Mais capaz, com raciocínio. |

A escolha de provedor e modelo é lembrada entre execuções. O uso das APIs é cobrado na sua conta do provedor.

## Uso

| Ação | Como |
| --- | --- |
| Mostrar/ocultar a janela | **Ctrl+Alt+H** |
| Capturar a tela e enviar à IA | **Ctrl+Alt+P** ou botão **Print + IA** |
| Mover a janela | Arrastar a barra de título |
| Redimensionar | Arrastar as bordas (mínimo de 240 × 180) |
| Alternar proteção contra captura | Clicar na etiqueta verde/vermelha |
| Ajustar opacidade | Controle deslizante na barra de título |
| Ocultar (minimizar) | Botão **–**. Sem ícone na barra de tarefas, "minimizar" oculta; use Ctrl+Alt+H para voltar. |
| Encerrar o app | Botão **✕** (salva as notas e fecha) |
| Enviar pergunta | **Enter** (Shift+Enter quebra linha) |
| Interromper uma resposta | Botão **Parar** |

## Onde ficam os dados e o que sai do computador

**Print como contexto:** com o app aberto, pressione **Ctrl+Alt+P**, mesmo em outro programa.
O monitor onde está o mouse é capturado e enviado ao provedor selecionado, junto com a pergunta
digitada no assistente (ou um pedido automático de análise quando o campo está vazio).
O último print acompanha as perguntas seguintes até clicar em **Limpar**, capturar outro print ou fechar o app.
A imagem fica apenas na memória, sem arquivo local, em JPEG com lado maior de até 2560 pixels.
A captura respeita o estado da proteção da janela. Durante uma resposta, aguarde ou clique em **Parar**
antes de capturar novamente. Modelos personalizados precisam aceitar imagens.
Se o atalho estiver ocupado por outro aplicativo, use o botão **Print + IA**.

**Armazenamento local** (pasta de dados do Electron, `%APPDATA%\bloco-notas-privado`):

| Arquivo | Conteúdo |
| --- | --- |
| `notas.json` | Notas, opacidade, tamanho/posição da janela, provedor e modelos escolhidos. **Texto simples, sem criptografia.** |
| `chave-anthropic.bin`, `chave-openai.bin` | Chaves de API, criptografadas via `safeStorage`. |

> A pasta mantém o nome antigo do projeto (`bloco-notas-privado`) de propósito, para não perder dados de
> quem já usava o app antes de ele se chamar HiddenAgent. Está fixada em [`main.js`](main.js).

**O que é enviado pela rede:** somente quando você faz uma pergunta no assistente. Vão para o provedor
selecionado (Anthropic ou OpenAI): o histórico recente da conversa (até 20 mensagens), a sua pergunta e, se
**Usar notas como contexto** estiver marcado (ou ao usar Resumir, Itens de ação e Ideias), o texto das notas.
Ao usar **Print + IA**, a captura também é enviada e permanece como contexto conforme descrito acima.
Não há telemetria, análise de uso nem nenhum outro servidor envolvido. Desmarque a opção de contexto se as
notas tiverem algo que você não quer enviar.

## Estrutura do projeto

```
HiddenAgent/
├── main.js        Processo principal: janela, atalho global, proteção contra captura,
│                  armazenamento (notas.json, chaves), IPC e chamadas ao assistente
├── preload.js     Ponte segura (contextBridge) entre a interface e o processo principal
├── renderer.js    Lógica da interface: notas, abas, chat, seleção de provedor/modelo, chave
├── ai.js          Provedores (Anthropic, OpenAI), streaming, prompt do sistema,
│                  validação do histórico e tradução de erros
├── index.html     Estrutura da janela (com Content-Security-Policy restritiva)
├── styles.css     Tema escuro
├── iniciar.vbs    Inicia o app sem terminal (Windows); repassa argumentos como --oculto
└── package.json   Dependências e script `start`
```

**Fluxo de uma pergunta:** `renderer.js` envia o histórico e as notas por `window.api.ask` →
`main.js` valida, escolhe o provedor, lê a chave e chama `ai.js` → `ai.js` faz o streaming e devolve pedaços de
texto → `main.js` os repassa à janela (`ai:chunk`, `ai:done`, `ai:error`) → `renderer.js` desenha a resposta.

**Dependências:** [`electron`](https://www.npmjs.com/package/electron) (desenvolvimento),
[`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk) e [`openai`](https://www.npmjs.com/package/openai).

## Decisões de segurança

- `contextIsolation` ligado, `nodeIntegration` desligado e `sandbox` ativo: a interface só enxerga a API mínima
  exposta em `preload.js`.
- **Content-Security-Policy** `default-src 'none'; script-src 'self'; style-src 'self'`: nenhum recurso externo
  é carregado e não há script inline.
- Navegação e abertura de novas janelas são bloqueadas.
- As chaves nunca voltam para a interface: ela só recebe a origem da chave (`app` ou `env`), nunca o valor.
- O provedor recebido da interface é sempre validado contra a lista conhecida antes de virar caminho de arquivo,
  para impedir a montagem de caminhos arbitrários.
- Perguntas ao assistente só são aceitas da janela do próprio app.
- A janela é protegida contra captura **antes** de ser exibida, então não aparece nem por um quadro.

## Limitações

- **A ocultação vale para captura feita por software.** Ela não protege contra uma câmera apontada para a tela,
  uma placa de captura de vídeo ou um segundo dispositivo. Ferramentas de captura que usam mecanismos próprios
  podem ignorá-la.
- **As notas ficam em texto simples** no disco (só as chaves são criptografadas).
- **Windows apenas, na prática:** o `iniciar.vbs` é específico do Windows, e o comportamento da proteção em
  macOS e Linux é diferente ou limitado. O projeto não foi testado nesses sistemas.
- Apenas uma conversa por vez, sem histórico entre execuções: **Limpar** ou fechar o app descarta o chat.
- As notas são um único texto; não há várias notas, pastas ou busca.

## Solução de problemas

**A janela não aparece.** Pressione **Ctrl+Alt+H**. Se nada acontecer, o atalho pode estar em uso por outro
programa, ou o app não está rodando (abra o `iniciar.vbs`).

**"Nenhuma chave … configurada".** Abra a aba **Assistente** e cole a chave, ou defina a variável de ambiente
do provedor e reabra o app.

**"Criptografia indisponível neste sistema".** O `safeStorage` não está disponível. Use a variável de ambiente
do provedor.

**"Chave inválida ou sem permissão" / "Sem saldo ou cota".** Confira a chave e o faturamento no painel do provedor.

**"Modelo indisponível nesta conta".** Escolha outro modelo no seletor, ou defina o seu em `NOTAS_MODEL`
(Anthropic) ou `NOTAS_OPENAI_MODEL` (OpenAI).

**A chave salva parou de funcionar.** Se o app for encerrado à força logo após a primeira gravação, o Electron
pode não ter gravado a chave de criptografia. Nesse caso, salve a chave de novo.

**O app foi aberto duas vezes.** Só existe uma instância por vez. Abrir de novo apenas mostra a janela existente
(exceto com `--oculto`, que não faz nada).

---

## Uso responsável

O HiddenAgent existe para proteger a privacidade das suas próprias anotações. Respeite as regras do lugar onde
você o usa: provas, processos seletivos e reuniões com política própria podem proibir ferramentas de apoio ou
exigir que você as declare.
