# Registro de implementação — Santa Casa de Pelotas

Data: 16/11/2026. Projeto implementado diretamente na pasta solicitada. Este documento distingue código implementado de validação no PostgreSQL.

## Fase 1 — Fundação

- React/JavaScript, Vite e React Router; layout azul com painéis escuros, sem avatares, menu responsivo, formulários, tabelas, modais, mensagens e carregamento.
- Express com API `/api`, validação Zod, logs estruturados, Helmet, tratamento centralizado de erros e PostgreSQL por `pg`.
- Login por CPF, exceção `master`, seed idempotente `master/master`, bcrypt custo 12, troca obrigatória, política mínima de senha, sessão HttpOnly/SameSite, Secure configurável, CSRF, limite de tentativas e expiração por inatividade.
- Cadastros de funcionários, usuários, cargos, núcleos, setores, vínculos e exceções de consulta. Histórico de vínculos e auditoria; sem exclusão física de funcionários.
- Importação CSV/XLSX com prévia editável, validação, confirmação transacional, atualização por CPF, relatório e histórico de lotes.
- Servidor único na porta 5005, `server.js`, configuração PM2 e scripts de instalação, inspeção, migration, seed, build, desenvolvimento, testes e sintaxe.

## Fase 2 — Avaliação de desempenho

- Competências gerais/específicas, categorias, pesos e situação ativa/inativa, com versões imutáveis dos dados de avaliação.
- Banco de perguntas com cinco descrições comportamentais obrigatórias. Sem resposta “Não se aplica”.
- Questionários por cargo: publicação congela todas as competências aplicáveis, perguntas, escalas e pesos. Versões anteriores permanecem consultáveis.
- Ciclos com referência, abertura, prazo, periodicidade, pesos de perfis, limite de divergência, participantes e estados preparação/aberto/encerrado.
- Inscrição de participantes utiliza uma versão explícita do questionário compatível com o cargo; identifica autoavaliação e responsáveis pela hierarquia. RH pode adicionar avaliadores e designar substitutos com justificativa.
- Avaliações independentes, rascunhos versionados, conclusão com todas as perguntas respondidas, prevenção de gravação sobre versão desatualizada, restrição por avaliador e período.
- Média das perguntas de uma competência por avaliador; média ponderada dos avaliadores por competência; média final ponderada das competências. `decimal.js`, precisão de 40 dígitos, sem arredondamento intermediário explícito. Apresentação com duas casas.
- Autoavaliação excluída do cálculo final; comparação por competência e radar (a partir de três competências), com tabela acessível em todos os casos. Divergência usa diferença absoluta maior ou igual ao limite, sem classificação automática de desempenho inadequado.
- Resultado bloqueado enquanto gestores ou decisões de validade estiverem pendentes. A autoavaliação pendente não altera nem impede a nota final dos gestores.
- Notas individuais disponíveis somente ao RH, gestor responsável autorizado e autor da própria avaliação. Colaborador recebe apenas consolidação/comparação após liberação explícita do RH.
- Liberações/revogações são auditadas e guardam snapshots. Mudanças de avaliador/hierarquia revogam resultado previamente liberado no ciclo afetado.
- Mudança de vínculo em ciclo ativo transfere avaliações pendentes e preserva revisões. Rascunhos transferidos aguardam decisão do RH. Avaliações concluídas ficam preservadas até decisão sobre sua validade. Nenhuma resposta é apagada.
- Prorrogação justificada; encerramento com justificativa obrigatória quando há pendências. Encerramento bloqueia respostas, sem completar artificialmente avaliações pendentes.
- Módulo PDI não iniciado.

## Estrutura

`client/`, `server/src/routes/`, `server/src/controllers/`, `server/src/services/`, `server/src/middleware/`, `server/src/database/migrations/`, `server/src/database/seeds/`, `server/src/utils/`, `scripts/`, `tests/` e `docs/`.

## Tabelas definidas nas migrations

Schema `ad`:

| Migration | Tabelas |
| --- | --- |
| Controle | `schema_migrations` |
| 001 — Fundação | `roles`, `permissions`, `role_permissions`, `nuclei`, `sectors`, `positions`, `employees`, `users`, `managers`, `supervisors`, `organizational_links`, `hierarchy_exceptions`, `sessions`, `audit`, `imports`, `settings` |
| 002 — Avaliações | `competencies`, `competency_versions`, `questions`, `question_versions`, `questionnaires`, `questionnaire_versions`, `evaluation_cycles`, `cycle_participants`, `evaluation_assignments`, `evaluation_responses`, `evaluation_transfers`, `evaluation_result_releases` |

O executor inspeciona a estrutura antes de qualquer DDL, verifica checksums, aplica somente versões pendentes, usa lock e transação. Não contém DROP DATABASE, DROP SCHEMA ou TRUNCATE. O schema `ad` preexistente sem controle de migrations exige revisão manual.

## Validação e pendências

| Verificação executada | Resultado |
| --- | --- |
| Instalação npm | Concluída; lockfile gerado. Cache temporário usado devido à restrição de escrita no cache padrão. |
| Sintaxe do backend/scripts | Aprovada em 19 arquivos. |
| Testes automatizados | 24 aprovados, 0 falhas: cálculos, precisão, exclusão da autoavaliação, permissões, transferências, preservação de revisões, validação de CPF/datas, CSV/XLSX, sessão obrigatória e limitador de tentativas. |
| Build React/Vite | Aprovado. Carregamento nativo da configuração evita leitura de diretórios ancestrais bloqueados pelo ambiente. |
| Auditoria de dependências de produção | Zero vulnerabilidades conhecidas após atualizar csv-parse e uuid transitivo do ExcelJS. |
| Inicialização do servidor | Confirmada em `0.0.0.0:5005`. Não equivale a login ou teste de persistência. |
| Inspeção PostgreSQL | Recusada com `28P01` (autenticação). |
| Migration | Comando executado e cancelado com `28P01`, antes de alteração de estrutura/dados. |
| Seed / login real / fluxos persistidos | Não validados contra PostgreSQL devido à falha de autenticação. |
| Inspeção visual | Não realizada: abertura do navegador recusada pela política de aprovação. |

O PostgreSQL respondeu na porta 5434, mas recusou as credenciais com código `28P01`. Nenhuma alteração do banco foi aplicada. Não foi tentada adivinhação de senha nem alteração do usuário PostgreSQL. Os cinco testes do serviço de transferência usam um cliente de banco simulado e verificam as operações emitidas; não substituem testes de integração com PostgreSQL.

A autenticação real do Master, troca de senha persistida, cadastros, escopo SQL, migrations, importação transacional, fluxo completo de ciclos, transferências e liberação de resultados dependem de conexão autorizada válida e homologação no banco de desenvolvimento.

A inspeção visual pelo navegador foi bloqueada pela política de aprovação ao abrir localhost:5005. Isso não representa teste visual aprovado.

## Operação

Preencha corretamente `PGPASSWORD` e confirme `PGHOST`, `PGPORT`, `PGDATABASE` e `PGUSER` no `.env` local. Não publique credenciais. Em seguida:

```powershell
npm install
npm run inspect-db
npm run migrate
npm run seed
npm run build
npm start
```

PM2: `pm2 start ecosystem.config.cjs`, `pm2 logs avaliacao-desempenho`, `pm2 restart avaliacao-desempenho`.

## Homologação necessária

1. Executar migrations duas vezes e confirmar ausência de reaplicação e preservação das tabelas existentes.
2. Executar seed duas vezes e verificar que a senha original não foi sobrescrita.
3. Entrar como Master, verificar bloqueio das funções até trocar senha, entrar novamente.
4. Cadastrar funcionários e responsáveis; verificar isolamento entre gestores e colaborador.
5. Criar competências, perguntas e questionário; editar e republicar; confirmar que participante anterior mantém a versão original.
6. Criar ciclo, inscrever participantes, conferir distribuição automática, abrir, responder como usuários distintos.
7. Testar rascunho, campos incompletos, limites 1–5, concorrência de versão e prazo expirado.
8. Transferir funcionário com rascunho, decidir reaproveitamento, responder como novo responsável; consultar histórico.
9. Substituir avaliador e decidir validade de resposta concluída. Conferir revogação de liberação prévia.
10. Conferir média manualmente, radar e divergências. Colaborador não acessa resultados antes de liberar nem notas individuais depois de liberar.
11. Prorrogar e encerrar ciclo com pendências, verificando justificativa e auditoria.

## Limitações operacionais explícitas

- Periodicidade é parâmetro do ciclo; não há criação automática de ciclos recorrentes.
- Troca de cargo durante ciclo não altera o questionário congelado do participante. Próximo ciclo usa a versão adequada ao novo cargo.
- Listas de funcionários limitadas a 1.000 registros; importação até 1.000 linhas/2 MB; transferências exibem os últimos 500 registros.
- Não há edição das notas concluídas, reabertura automática, PDI, elegibilidade ou assinatura eletrônica nesta fase.
- Um responsável com avaliação em andamento não pode simplesmente ser removido da hierarquia: informe o novo responsável ou substitua o avaliador antes de remover o vínculo.
- Uma nova transferência aguarda a decisão sobre a transferência anterior. Quando o destino já possui avaliação própria, suas respostas não são sobrescritas nem mescladas ao rascunho antigo; o RH decide sobre o registro de origem preservado.
- Limitador de login em memória, adequado à instância única configurada no PM2; requer armazenamento compartilhado se houver múltiplas instâncias.
- Os testes unitários não substituem a validação de autorização e persistência contra PostgreSQL real.
