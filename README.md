# Telegram

Integra o ThinkIac ao Telegram. O pacote registra uma tela de configuração, polling do bot, sessões por chat, atendimento público opcional, progresso de execução e uma tool MCP para enviar mensagens.

## Instalação responsável

Antes de adicionar o pacote ao workspace, revise o código, as permissões do token do bot e os modelos configurados no ambiente. O token é guardado somente no backend e nunca é devolvido pela interface ou pelas rotas públicas.

## Como usar

1. Abra **Telegram** no menu do ThinkIac e conecte o token criado no BotFather.
2. Envie `/start` ao bot para que o chat apareça na aba **Chats**.
3. Ative apenas os chats administrativos que podem usar a Agent.
4. Em **Atendimento**, escolha os modelos para chats autorizados e, se necessário, para atendimento público.
5. Para liberar atendimento a desconhecidos, selecione primeiro um especialista com allowlist explícita de tools e então ative o atendimento público.

Mensagens administrativas usam uma sessão persistente por chat. Quando já existe um turno em execução, o pacote acompanha seu progresso, aguarda o término e envia a próxima mensagem sem descartar a solicitação.

## Comandos do bot

| Comando | Antes | Depois |
| --- | --- | --- |
| `/start` | Pode ser usado por qualquer chat observado. | Envia a mensagem de boas-vindas configurada. |
| `/help` | Chat autorizado. | Lista os comandos disponíveis. |
| `/sessions [página]` | Chat autorizado. | Lista as sessões em páginas de cinco. |
| `/session <n>` | Chat autorizado. | Troca para a sessão de número `n`; `/session default` volta à sessão padrão. |
| `/new` | Chat autorizado. | Cria e seleciona uma nova sessão do chat. |
| `/clear` | Chat autorizado. | Limpa o histórico da sessão atual. |
| `/status` | Chat autorizado. | Mostra provider, modelo e sessão em uso. |
| `/cancel` | Chat autorizado, com turno ativo. | Interrompe o turno da sessão atual. |

Chats novos começam bloqueados. Um chat bloqueado só recebe `/start`, a menos que o atendimento público esteja explicitamente habilitado.

## UX de progresso

Durante uma resposta, o bot envia uma única mensagem de estado e a atualiza com etapas e trechos de reasoning. As edições são limitadas para respeitar o rate limit do Telegram. Quando o runtime já processa a mesma sessão, o bot se reconecta ao stream, exibe o andamento e reenvia a nova mensagem assim que a sessão fica livre.

## HTTP API

O prefixo é `/telegram`. As rotas devolvem o resultado JSON do runtime.

| Método | Endpoint | Finalidade |
| --- | --- | --- |
| `GET` | `/telegram/api/status` | Estado da credencial, polling e bot conectado. |
| `GET`, `POST`, `DELETE` | `/telegram/api/token` | Consultar estado, conectar ou apagar a credencial. |
| `GET`, `POST`, `DELETE` | `/telegram/api/chats` | Listar, observar ou remover chats. |
| `POST` | `/telegram/api/chats/toggle` | Ativar ou bloquear um chat observado. |
| `GET`, `PATCH` | `/telegram/api/profile` | Consultar ou atualizar o perfil público do bot. |
| `GET`, `PATCH` | `/telegram/api/settings` | Consultar ou salvar atendimento, modelos e chat padrão. |
| `GET` | `/telegram/api/models` | Modelos disponíveis em providers autenticados. |
| `GET` | `/telegram/api/public-specialists` | Especialistas elegíveis ao atendimento público. |

## Tool MCP

| Tool | Finalidade |
| --- | --- |
| `telegramSendMessage` | Envia texto pelo bot para `chatId` informado, o destinatário padrão ou o único chat observado. |

Exemplo:

```json
{
  "text": "A implantação terminou.",
  "chatId": "123456789"
}
```

O envio emite `telegram:message:sent` quando tem sucesso e `telegram:message:failed` quando falha. Toda entrada recebida publica `telegram:message:received`.

## Desenvolvimento

```bash
node --test apps/thinkiac/packages/telegram/test/*.test.js
```

Versão atual: `1.1.0`.
