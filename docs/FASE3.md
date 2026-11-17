# Fase 3 — Feedback de Desempenho e PDI

## Integração e preservação

Implementação incremental no React/Express/PostgreSQL existente. A migration `003_feedback_development.sql` adiciona seis tabelas, sem alterar tabelas ou migrations anteriores. Mantém autenticação, hierarquias, autorização da Fase 2, consolidação decimal, respostas e política de liberação. O radar da Fase 2 é reutilizado.

Antes da migration foi capturada uma referência das 28 tabelas originais. `preservation-phase3.json` contém apenas contagens e hashes, sem dados pessoais. `node scripts/verify-preservation.js` compara o banco com essa referência e verifica SHA-256 dos arquivos 001 e 002. Alterações legítimas posteriores de usuários ou sessões naturalmente mudam a comparação. Não recapture a referência para ocultar diferenças.

## Fluxo

1. RH acompanha todos os participantes em **Feedback de Desempenho**. Participantes sem plano aparecem como **PDI obrigatório · não iniciado**, inclusive em ciclos anteriores.
2. Após a consolidação, o gestor responsável inicia e salva rascunhos. O funcionário acessa somente após a liberação do resultado pelo RH no fluxo de ciclos já existente.
3. Gestor registra reunião, pontos fortes, oportunidades, observações, objetivo e ações. Cada ação requer competência do questionário do ciclo, descrição, responsável, início, prazo e indicador. Ações salvas não são excluídas; cancelamento exige justificativa.
4. Funcionário registra sua contribuição. O gestor não pode escrever em nome dele. Encaminhamento exige contribuição de autoria do funcionário, campos obrigatórios, liberação do RH e pelo menos uma ação não cancelada.
5. Encaminhamento congela o conteúdo do feedback/PDI, identificação e resultado consolidado. Cada parte revisa, declara ciência, sem pressupor concordância, e reautentica com sua própria senha. São armazenados usuário, identificação funcional, tipo (gestor/funcionário), data/hora, rodada, conteúdo e hash. Formalização exige dois usuários distintos e os dois tipos de assinatura.
6. Enquanto aguarda assinaturas, qualquer parte pode devolver o documento para ajustes com justificativa. Assinaturas anteriores permanecem no histórico, mas não valem para a próxima rodada. Documento formalizado não permite alteração direta dos termos assinados. O gestor pode iniciar uma nova versão com justificativa, exigindo nova contribuição do funcionário e novas assinaturas. Todas as versões congeladas e assinaturas anteriores ficam consultáveis. O acompanhamento mantém histórico separado do conteúdo congelado; durante a elaboração da revisão, atualizações de andamento ficam pausadas até a formalização.
7. Após a formalização, gestor e funcionário registram andamento, observações e evidências. Conclusão exige evidência anexada; cancelamento é atribuição do gestor e exige justificativa. Percentual é opcional, de 0 a 100; quando preenchido, conclusão exige 100%.
8. Gestor agenda e conclui verificações intermediárias. RH consulta todo o processo sem substituir as partes na elaboração ou na assinatura.

## Acompanhamento e notificações

- Tela de acompanhamento filtra ciclos e ações abertas, próximas do vencimento, atrasadas, concluídas e canceladas. Cada ação mantém seu prazo independente.
- Atraso é calculado pela data em `America/Sao_Paulo`, sem sobrescrever o status acordado. Próximo do vencimento significa até sete dias.
- Notificações internas são calculadas ao abrir a tela, incluindo prazos, verificações e eventos de outros usuários. Leitura é individual e persistida. Não há e-mail, polling ou serviço externo.
- Evidências de até 2 MB por arquivo são armazenadas no PostgreSQL com hash e autoria. Download autenticado, com as mesmas permissões do plano, sempre como anexo e sem execução inline.
- Histórico inclui autor, horário e conteúdo de cada atualização. Controle de versão rejeita gravações concorrentes desatualizadas. Alterações usam transação e o mesmo lock da Fase 2.

## Segurança e limites

Notas nunca são editadas pelo feedback. Respostas individuais respeitam a política original: RH e gestor responsável consultam as avaliações; funcionário consulta suas próprias respostas. A divergência usa o limite do ciclo e não classifica desempenho inadequado.

Assinatura usa bcrypt, limite de tentativas por usuário, CSRF, verificação de versão/hash e conferência do resultado e responsável atuais. Senhas não são persistidas no histórico ou auditoria. O limitador é em memória, como a instalação de instância única existente. O registro é uma assinatura interna por senha; não acrescenta certificado digital ou serviço de assinatura externo.

A continuação dos requisitos foi incorporada: ciência sem concordância presumida, proteção de senhas e novas versões com novas assinaturas. Tipos implementados: ciência do gestor e do funcionário sobre o documento conjunto de feedback/PDI. A migration 004 acrescenta armazenamento das versões congeladas, mantendo a migration 003 intacta.

## Validação

```powershell
npm run check
npm run build
npm test
$env:RUN_DEVELOPMENT_DB_TESTS='1'
node --test tests/development-integration.test.js
node scripts/verify-preservation.js
```

O teste de integração usa PostgreSQL real, cria dados temporários em transação e executa rollback ao final. Sequências podem avançar, sem persistir registros fictícios. Valida autorização, liberação, contribuição, concorrência, senha incorreta, assinatura dupla, reabertura, preservação de conteúdo assinado, anexos, verificações e notificações. Execução opcional de navegador usa `DEVELOPMENT_PLAYWRIGHT_MODULE` (URL de importação do Playwright instalado fora do projeto), `DEVELOPMENT_BROWSER_PATH` e `DEVELOPMENT_SCREENSHOT_DIR`.

Para instalar em outra base, executar `npm run migrate` e `npm run build`, reiniciando o processo Node conforme a operação existente. Não executar seed ou recriar o banco.

## Resultado da execução local

- Migrations 003 e 004 aplicadas; build e verificação de sintaxe aprovados.
- 29 testes aprovados, incluindo integração HTTP/PostgreSQL com rollback dos registros de teste.
- Navegador Chrome: telas de feedback e acompanhamento carregadas, sem erros JavaScript; larguras de 1440 e 390 pixels verificadas, sem transbordamento horizontal no celular.
- Imediatamente após a migration 003, as 28 tabelas originais estavam idênticas à referência. Na conferência final, as 27 tabelas fora de `sessions` e os arquivos 001/002 continuaram idênticos. `sessions` apresentou hash diferente, mantendo uma sessão; a atividade mais recente é posterior à captura. A referência não foi substituída e nenhuma sessão foi restaurada ou removida. A conferência estrita informa essa diferença; `node scripts/verify-preservation.js --business-only` verifica separadamente as demais tabelas e relata a diferença operacional.
