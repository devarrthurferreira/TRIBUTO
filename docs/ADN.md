# Conector experimental de leitura NFS-e nacional (ADN)

O módulo `src/agent/adn-connector.mjs` faz **consulta somente leitura** na API oficial de Distribuição aos Contribuintes, usando certificado A1 por TLS mútuo. Ele extrai campos da NFS-e do DF-e distribuído e devolve um lote de **chave e metadados**. Não envia XML, PDF, senha do A1 ou certificado para o Web App. Nenhum endpoint emite ou cancela nota.

> **Estado da integração:** cliente e parser conservadores, opt-in. Ainda faltam validação com resposta real em produção restrita, tratamento dos documentos `EVENTO`, agendamento e instalação do conector no servidor Windows. O agente de transporte existente não invoca este módulo sozinho. Um NSU desconhecido ou evento não processado gera erro; o cursor não deve avançar. Não indique cobertura completa ou cancelamentos confiáveis enquanto essas etapas não estiverem concluídas.

## O que é consultado

- Produção restrita: `https://adn.producaorestrita.nfse.gov.br/contribuintes/DFe/{NSU}?cnpjConsulta={CNPJ}`.
- Produção: `https://adn.nfse.gov.br/contribuintes/DFe/{NSU}?cnpjConsulta={CNPJ}`.
- A autorização usa o certificado do escritório e a procuração eletrônica do CNPJ consultado; sem outorga válida a API pode retornar `E2245`.
- O NSU é individual por inscrição interessada. Mantenha um cursor separado para cada CNPJ. O retorno do ADN é o documento fiscal, não uma lista nacional somente com chaves: o XML precisa ser recebido **temporariamente**, interpretado e descartado antes de persistir somente os metadados.

Referências oficiais: [Guia de utilização das APIs do ADN](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-municipios-apis-adn-sistema-nacional-nfs-e-v1-1-20261103.pdf/@@download/file), [endereços de produção e produção restrita](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao/apis-prod-restrita-e-producao), [documentação atual e esquemas](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/documentacao-atual).

## Integração do serviço Windows

O conector recebe `environment` (`restricted` ou `production`), `pfxPath`, `passphrase`, `companyCnpj` e **o próximo NSU**, não o último confirmado. `queryAdnDfe` estabelece TLS mútuo com somente os dois domínios oficiais fixados, desabilita redirecionamento, limita tempo e tamanho de resposta, rejeita XML com DTD/entidades e compara a chave da resposta com `infNFSe/@Id`. `interpretAdnResponse` trata `E2220`/`E2230` como ausência temporária de documentos; erros de certificado/procuração não são confundidos com ausência de notas. `batchFromAdn` cria ID de lote estável e recusa lacunas ou CNPJ sem relação com o documento.

Para agendar a coleta, um processo supervisionado no Windows deverá:

1. Ler as tarefas `NFSE` do painel e seu último NSU confirmado para **aquele CNPJ**.
2. Chamar `queryAdnDfe` com `NSU = último confirmado + 1`, com A1 protegido por uma conta de serviço dedicada; não colocar PFX ou senha no repositório, diretório de deploy, linha de comando ou logs.
3. Se houver documento reconhecido, criar o lote com `batchFromAdn`, gravá-lo duravelmente na fila local e enviar pelo agente de transporte. Só avançar após ACK remoto persistido.
4. Se vier `no_document`, registrar a última consulta e esperar **no mínimo uma hora** antes de consultar esse CNPJ novamente. Não interpretar isso como prova de que a empresa não recebeu ou emitiu nota.
5. Se vier evento, erro de autorização, formato inesperado ou falha de parse, manter o mesmo cursor e sinalizar o CNPJ para investigação. Eventos de cancelamento/substituição exigem processamento próprio para atualizar o status anterior da nota.

O código ainda **não** executa esses passos automaticamente. Antes de ativar em produção para 500 empresas, valide com procurações e respostas reais em produção restrita, cubra documentos `EVENTO`, fixe ritmo por CNPJ, confira reenvio idempotente e restauração de backup, e compare uma amostra com o portal das empresas. Municípios que não compartilham ou compartilham com atraso no ADN precisam de conectores específicos; o painel deve exibir a cobertura da fonte.
