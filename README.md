# Avaliação de Desempenho e Desenvolvimento de Colaboradores

Santa Casa de Pelotas — Fases 1 e 2: fundação e avaliações. React/JavaScript, Vite, Express e PostgreSQL. Inclui competências, perguntas, questionários versionados, ciclos, autoavaliação, avaliações de gestores, consolidação, radar e liberação pelo RH. PDI e assinaturas ainda não fazem parte desta entrega. Consulte `docs/IMPLEMENTACAO.md` para a situação real das validações e do banco.

## Instalação (Windows Server 2022)

Requisito: Node.js 22.12 ou superior, npm e acesso ao PostgreSQL existente. Na pasta raiz:

```powershell
Copy-Item .env.example .env
```

Edite `.env` e informe `PGPASSWORD` e `PGHOST`. As demais configurações já apontam para a porta PostgreSQL `5434`, banco/usuário `avaliacao_desempenho`, servidor `0.0.0.0:5005`. Não envie `.env` ao Git. Nenhuma senha do banco é fornecida no código.

```powershell
npm install
npm run inspect-db
npm run migrate
npm run seed
npm run build
npm start
```

Acesse `http://localhost:5005` ou `http://IP_DO_SERVIDOR:5005`. Autorize a porta TCP 5005 no firewall institucional, se necessário. O backend `/api` e o frontend compilado usam a mesma porta.

O primeiro acesso é `master` / `master`. É obrigatório escolher outra senha antes de acessar qualquer funcionalidade. A seed usa bcrypt (custo 12), é idempotente e nunca substitui a senha existente. Depois da configuração inicial, reserve esse acesso para administração e crie os usuários nominativos por CPF.

## Ordem de configuração

1. Troque a senha de instalação.
2. Cadastre núcleos, setores e cargos.
3. Cadastre funcionários, inicialmente sem gerente/gestor se necessário.
4. Crie seus usuários por CPF com os perfis Gerente e Gestor imediato.
5. Edite funcionários e atribua os responsáveis.
6. Cadastre os demais usuários e teste o escopo de cada perfil.

RH e Master administram cadastros, usuários, importações, configurações e auditoria. Gerentes e gestores consultam seu próprio cadastro e os funcionários vinculados à sua responsabilidade. Colaboradores consultam seu próprio cadastro. Exceções explícitas permitem consulta adicional e são auditadas. Todos os controles são aplicados pela API.

## Desenvolvimento e verificações

```powershell
npm run dev
npm run check
npm test
npm run build
```

Em desenvolvimento, Vite usa somente `127.0.0.1:5173` e encaminha `/api` para `127.0.0.1:5005`; não requer segunda porta pública. Para conferir o frontend compilado pela rede, execute build e `npm start`.

## PM2

```powershell
pm2 start ecosystem.config.cjs
pm2 logs avaliacao-desempenho
pm2 restart avaliacao-desempenho
pm2 save
```

Também é compatível com `pm2 start server.js --name avaliacao-desempenho`. Configure a inicialização automática do PM2 conforme o procedimento institucional do Windows (serviço ou tarefa agendada); `pm2 save` sozinho não instala um serviço.

## Banco e migrations

O banco existente não é criado, apagado ou recriado. As tabelas ficam no schema `ad`. `migrate` inspeciona e imprime apenas os nomes das tabelas antes de alterar a estrutura, obtém um lock e aplica migrations pendentes numa transação. O usuário deve ter permissão de criação de schema no banco existente. Se o schema `ad` já contiver tabelas sem controle de migrations, o comando interrompe sem alterações. Checksums detectam modificações em migrations já aplicadas. Não edite uma migration aplicada: crie outra versão.

São preservados cadastros e históricos. Não existem rotas de exclusão física de funcionários; use situação funcional. Catálogos e usuários podem ser inativados. Alterações de vínculo encerram o anterior e criam outro. Mudanças de CPF também atualizam o login associado. Transfira vínculos ativos antes de desativar um responsável ou mudar seu perfil.

Antes de implantação, mantenha um backup institucional com `pg_dump` e valide restauração em ambiente separado. Não coloque backups contendo dados pessoais no repositório.

## Importação

Na tela Importação, baixe o modelo CSV e consulte os códigos de cargos, setores e responsáveis. Suporta CSV UTF-8 (vírgula/ponto e vírgula) e XLSX, primeira planilha, até 1.000 registros e 2 MB. Mantenha CPF/RE como texto; datas no formato `AAAA-MM-DD`. Os cabeçalhos são:

```text
name;cpf;re;position_id;sector_id;manager_id;supervisor_id;status;admission_date;position_start;level_start
```

O núcleo é derivado do setor. Responsáveis são opcionais; status é `ativo`, `afastado` ou `desligado`. A prévia valida CPF, obrigatoriedade, datas, referências e duplicidades. Edite as células e clique em Validar correções. Confirmação revalida no servidor e grava todo o lote em transação. CPF identifica atualizações; conflito de RE com outro CPF bloqueia. Histórico de lotes inclui responsável, data e relatório CSV. A importação não cria automaticamente contas de acesso.

## Segurança e operação

- Cookies HttpOnly/SameSite Strict; sessão opaca, token armazenado por hash no PostgreSQL e CSRF obrigatório nas operações autenticadas.
- Expiração por inatividade configurável e duração absoluta de 12 horas. Sem polling que renove sessão automaticamente.
- Limite de 10 tentativas em 15 minutos por IP para login/troca de senha; uma instância PM2 conforme configuração. O contador em memória reinicia com o processo. Para múltiplas instâncias será necessário um armazenamento compartilhado do limitador.
- `COOKIE_SECURE=true` quando houver HTTPS. Habilite `TRUST_PROXY=true` somente atrás de um proxy confiável de um salto. Na intranet HTTP, cookies Secure precisam permanecer desabilitados.
- Bcrypt custo 12. Senhas nunca retornam pela API ou são registradas em logs/auditoria. Redefinição invalida sessões e força nova troca.
- Senhas são limitadas a 72 bytes UTF-8 para evitar truncamento pelo bcrypt; caracteres acentuados podem ocupar mais de um byte. Referência técnica: https://www.npmjs.com/package/bcryptjs .
- Política mínima configurável entre 6 e 72 caracteres; variáveis de ambiente podem reforçar o mínimo e reduzir o tempo de sessão. Mudança de política não invalida senhas antigas automaticamente.
- Auditoria administrativa inclui dados pessoais de alterações cadastrais; restrita a RH/Master. Proteja acesso ao banco e defina retenção institucional.
- Logs estruturados em stdout com ID de requisição, método, rota e status, sem corpo, cookies ou senhas. `/api/health` confirma o processo HTTP, não a conectividade do banco.
- Assinaturas eletrônicas e recuperação de senha pelo usuário ficam para etapas posteriores. Senha pode ser redefinida pelo RH; Master altera a própria senha.

## Estrutura

```text
client/                  React, componentes, estilos e Vite
server/src/routes/       API REST e permissões
server/src/controllers/  Autenticação
server/src/services/     Funcionários, importação e auditoria
server/src/middleware/   Sessões, CSRF, escopo e permissões
server/src/database/     Conexão, inspeção, migrations e seed
server/src/utils/        Validação e logs
scripts/                 Verificação de sintaxe
tests/                   Testes automatizados
docs/                    Registro da implementação
server.js                Inicialização e encerramento
ecosystem.config.cjs     Configuração PM2
```

Consulte `docs/IMPLEMENTACAO.md` para resultados efetivamente executados e pendências de homologação.
