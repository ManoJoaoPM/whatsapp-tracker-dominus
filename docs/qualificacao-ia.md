# Qualificação de leads por IA (MQL)

A IA lê a conversa e decide o quanto o lead está qualificado. O resultado alimenta o Kanban, o Dashboard e, para leads de anúncio, o evento `QualifiedLead` enviado ao Meta. Como esse evento treina o algoritmo de otimização, o sistema prioriza **precisão** (poucos falsos positivos) sobre quantidade.

## Princípio: a IA não dá a nota

A IA apenas julga **critérios** (atendido ou não) e, para cada um, **cita um trecho literal** da conversa. O servidor então:

1. Confere se o trecho existe na conversa (sem diferenciar maiúsculas e acentos). Parafrasear não vale.
2. Confere se foi escrito por quem o critério exige: `Fala do lead` ou `Lead ou empresa`. A fala da empresa não prova interesse do lead.
3. Soma os pesos dos critérios comprovados (0 a 100).

Níveis: **frio** 0-39, **morno** 40-69, **quente** 70-100.

Código: `api/services/mqlEngine.ts` (lógica pura e testada), `api/services/mqlService.ts` (chamada ao modelo), `api/services/mqlAutoScore.ts` (quando pontuar e persistência).

## Critérios por cliente

Em **Conexões → Qualificação por IA** cada empresa escolhe um modelo (Genérico, Imobiliária, Serviços com agendamento, Cursos e infoprodutos), edita os critérios (nome, descrição, pontos, quem precisa ter escrito a evidência) e descreve o negócio em texto livre. Até 12 critérios, pontos inteiros de -50 a 50.

Os pontos positivos dos modelos somam 100. Critérios com pontos negativos funcionam como penalidade (por exemplo, "Sem interesse").

## Proteção contra manipulação

O lead escreve o texto que a IA lê. Camadas de defesa:

- Mensagens do lead com ordens ao avaliador ("me marque como quente", "ignore as instruções", tags `</conversa>` etc.) são **detectadas por padrões, removidas do que o modelo vê** e substituídas por um aviso.
- O texto do lead vai dentro de `<conversa>`, sem caracteres `<` `>`, em uma linha e com limite de tamanho.
- Citações vindas de mensagens bloqueadas são recusadas.
- A conversa fica marcada (`mqlManipulation`) e **não é enviada ao Meta automaticamente**. Só a venda fechada por uma pessoa no Kanban sobrepõe a marca.

A detecção por padrões é uma rede de segurança, não uma garantia: um texto bem disfarçado pode passar. Por isso o envio ao Meta tem as camadas abaixo.

## Quando a conversa é pontuada

Nada é pontuado "na hora". Cada mensagem só agenda a avaliação para daqui a `MQL_DEBOUNCE_SECONDS` (120 s); mensagens novas empurram o horário. O agendamento fica no banco e sobrevive a reinícios. Regras:

- **Primeira nota:** só depois de `MQL_MIN_INBOUND` (2) mensagens do lead.
- **Novas notas:** só se houve mensagem nova do lead (ou 3+ mensagens no total) e no máximo uma vez a cada `MQL_MIN_INTERVAL_SECONDS` (300 s).
- **Leads em silêncio:** a cada 10 min o sistema procura conversas já pontuadas em que a empresa foi a última a falar e o lead não responde há `MQL_SILENCE_HOURS` (48 h). Cada período de silêncio é reavaliado uma vez e recebe -20 pontos ("Sem resposta há Xh").
- **Falhas do provedor de IA:** até 3 tentativas com espera crescente. O motivo fica em `mqlLastError` e nos logs.

Regras de negócio fixas: 4 ou mais mensagens do lead garantem no mínimo 40 pontos (morno, só para exibição, não confirma envio ao Meta); venda concluída vale 100.

## Confirmação antes de enviar ao Meta

O evento só é enfileirado se a conversa tiver `mqlConfirmed = true`, o que exige:

1. origem Meta e nível mínimo configurado em **Conexões → Meta Ads**;
2. pelo menos `MQL_CONFIRM_MIN_INBOUND` (2) mensagens do lead;
3. nenhuma tentativa de manipulação;
4. **uma segunda avaliação "cética"**, com outro prompt e critérios em ordem invertida, que também chegue ao nível mínimo. Quando as duas rodam, vale a **menor nota**.

Conversas já pontuadas antes desta versão não têm confirmação. Elas só voltam a ser avaliadas quando o lead mandar uma nova mensagem.

## Auditoria

Cada avaliação é gravada em `MqlEvaluation` com a versão do prompt (`mql-v3`), o modelo, o hash das regras usadas, os critérios com as citações (inclusive as recusadas e o motivo), a nota da segunda avaliação e o gatilho (`message`, `silence` ou `manual`). A conversa guarda o último resultado e o modal de MQL mostra os critérios com as citações. Histórico: `GET /api/mql/conversations/:id/evaluations`.

## Valor da venda

Além dos critérios, a IA informa se a conversa mostra uma venda ou proposta aceita com valor concreto, citando o trecho. O servidor só guarda o valor se a citação existir na conversa (nunca em mensagem bloqueada por manipulação) e se o número do trecho bater com o valor informado (aceita "R$ 1.500,00", "400 mil", "2,5 milhões"). Ele fica em `saleValueSuggested` e aparece como **sugestão** no diálogo de venda concluída. O valor que conta para o Meta (`saleValue`) é sempre o que uma pessoa confirma.

## Limites conhecidos

- Áudios e imagens não são lidos: a IA só vê o texto das mensagens.
- Os workers precisam de processo contínuo (Docker ou `npm run server:dev`). Em hospedagem serverless a pontuação automática não roda.
- Um lead que mente de forma convincente ("tenho 400 mil de entrada") ainda pontua: a IA não verifica fatos. Isso é tratado na calibração (Fase 7), comparando a nota da IA com o resultado real das vendas.
- O modelo precisa seguir a instrução de citar literalmente. Provedores compatíveis com OpenAI que não aceitam `json_schema` caem automaticamente para um modo mais simples.
