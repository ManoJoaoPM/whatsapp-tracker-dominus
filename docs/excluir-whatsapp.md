# Excluir um WhatsApp

Em **Conexão WhatsApp**, selecione o número na lista e use **Excluir** (ao lado de *Desconectar*).

| Ação | O que faz |
|---|---|
| **Desconectar** | Faz logout do aparelho. O número continua na lista e pode ser reconectado com um novo QR code. |
| **Excluir** | Remove a conexão do sistema: faz logout, apaga a instância no Evolution e tira o número da lista. Para voltar a usar, é preciso conectar de novo. |

## O que acontece com as conversas

Por padrão, **as conversas e mensagens do número são mantidas**. Elas alimentam o Dashboard, o Kanban e o histórico dos leads já enviados ao Meta. Na confirmação existe a opção **"Apagar também as conversas e mensagens deste número"**, desmarcada por padrão, que remove de forma permanente:

- conversas (leads) e mensagens do número, inclusive imagens e áudios do banco secundário;
- histórico das avaliações da IA (`MqlEvaluation`) e payloads de leads capturados (`MetaLeadLog`) dessas conversas.

O registro dos eventos já enviados ao Meta (`MetaEventLog`) é **sempre mantido**, como trilha de auditoria. Ele contém apenas identificadores com hash, não o texto das conversas.

## Se o Evolution não responder

Nada é apagado e o sistema avisa. Aparece então **Excluir mesmo assim**, que remove o registro do sistema sem confirmação do Evolution. Nesse caso o aparelho pode continuar vinculado; remova-o em *Aparelhos conectados* no próprio WhatsApp.

## Links de conexão do cliente

Se o número foi criado por um link de conexão ainda não concluído, o link volta ao estado "aguardando" e o cliente pode conectar de novo. Se já estava concluído, ele permanece na lista como histórico.

## API

`DELETE /api/whatsapp-accounts/:id` (login e `x-client-id`). Parâmetros opcionais: `?deleteConversations=true` e `?force=true`. Resposta: `{ ok, deletedConversations, deletedMessages }`.
