# API do painel e do agente

O agente no Windows abre conexões **HTTPS de saída** para a API do Web App Node.js. O painel consulta o MySQL da Hostinger por meio dessa API; a nuvem não inicia conexão ao Windows. O contrato recebe **somente chave e metadados estruturados**. XML, PDF, PFX, senha de certificado e URLs para buscar documentos não são aceitos nos lotes nem persistidos no MySQL.

## Autenticação e escopo

Cada instalação recebe um token exclusivo, exibido uma vez ao administrador. O banco guarda apenas seu SHA-256, associado aos CNPJs e fontes permitidos; o agente envia `Authorization: Bearer <token>`. O painel usa login humano e cookie de sessão separados. Revogue o agente no painel se precisar interromper seu acesso. O instalador protege o token com DPAPI e ACL NTFS; consulte [WINDOWS-INSTALL.md](WINDOWS-INSTALL.md).

Cada rota de NFS-e por empresa exige login, permissão no módulo Fiscal **e** acesso ao CNPJ consultado. A API valida novamente autorização e dados recebidos do agente; o token do agente não concede login no painel.

## Endpoints do agente

| Método e rota | Resposta / corpo | Uso |
| --- | --- | --- |
| `GET /healthz` | `{ "ok": true }` | Saúde básica da aplicação. |
| `GET /v1/agent/jobs` | `{ "jobs": [{ "id", "companyCnpj", "source", "startNsu", "lastCommittedNsu", "enabled" }] }` | Vínculos de coleta autorizados. Não são comandos arbitrários. |
| `POST /v1/agent/heartbeat` | `{ "hostname", "version", "queuedBatches" }` | Último sinal e tamanho da fila. |
| `POST /v1/agent/batches` | Lote abaixo → `{ "ok", "batchId", "committedThroughNsu" }` | Transação MySQL que grava metadados, eventos, lote e checkpoint. `201` novo, `200` reenvio idêntico. |

Exemplo **fictício** de lote NFS-e de emissão (substitua CNPJ/chave/dados por valores válidos da fonte autorizada):

```json
{
  "batchId": "b7ec75a1-993e-4a36-a332-0507022f537d",
  "companyCnpj": "11222333000181",
  "source": "NFSE",
  "firstNsu": "1",
  "lastNsu": "1",
  "documents": [
    {
      "nsu": "1",
      "documentKey": "00000000000000000000000000000000000000000000000000",
      "number": "123",
      "issuedAt": "2026-11-23T10:00:00-03:00",
      "competence": "2026-11",
      "providerCnpj": "11222333000181",
      "recipientCnpj": null,
      "amountCents": 125000,
      "status": "active",
      "municipalityCode": "3106200",
      "eventType": "issued"
    }
  ]
}
```

`documentKey` deve ter **50 dígitos para `NFSE`** e **44 para `NFE`**. Para emissão, `number`, data ISO, competência `AAAA-MM`, partes, valor em centavos, situação e tipo de evento são campos validados; prestador ou tomador deve corresponder ao CNPJ do lote. `providerCnpj`/`recipientCnpj` podem ser CPF (11 dígitos), CNPJ (14) ou `null`, conforme a fonte. `status` aceita `active`, `cancelled`, `substituted` ou `unknown`. `eventType` aceita `issued`, `cancelled`, `substituted` ou `other`. Eventos sem dados da nota podem conter só `nsu`, `documentKey`, `eventType` e `status` coerente; um evento de cancelamento pode chegar antes da nota, sem que a API invente valor ou número.

O lote aceita de 1 a 20 itens e até 1 MB de JSON; o NSU vai como string decimal, em sequência sem lacunas entre `firstNsu` e `lastNsu`, exatamente um item por NSU. O primeiro lote começa em `startNsu + 1`; os próximos começam após o último checkpoint confirmado. O conector deve adaptar os retornos da fonte a esse contrato e **não avançar** quando um item não puder ser interpretado. A mesma chave pode reaparecer em um evento posterior: o registro corrente é atualizado por chave/CNPJ/fonte e cada NSU mantém um evento próprio. `batchId` repetido com o mesmo conteúdo recebe o ACK anterior; conteúdo diferente recebe `409 BATCH_CONFLICT`. Se o ACK se perder, o agente reenvia sem perder a fila.

## Endpoints do painel para cada empresa

| Método e rota | Parâmetros | Resultado |
| --- | --- | --- |
| `GET /v1/platform/companies/:cnpj/nfse` | `month=AAAA-MM`, `role=issued\|received`, `status=active\|cancelled\|substituted\|unknown`, `page=1`, `limit=50` (até 100) | NFS-e da empresa com chave, dados, situação e paginação. |
| `GET /v1/platform/companies/:cnpj/nfse/summary` | `from=AAAA-MM&to=AAAA-MM` opcionais | Totais de prestadas e tomadas, valores ativos e cancelamentos, consolidados e por competência. |
| `GET /v1/platform/companies/:cnpj/nfse/coverage` | Nenhum | Último NSU e horário confirmado para a empresa/fonte, ou `never_collected`. |

Os filtros e o resumo permitem comparar competências, prestadas e tomadas **dentro dos dados recebidos**. `coverage` é um sinal de sincronização, não uma prova de que todos os municípios, períodos ou tipos de nota foram consultados. Não conclua que uma NFS-e não existe apenas porque ela não aparece no painel. Conciliação com uma segunda fonte, relatório do cliente ou sistema contábil ainda exige integração específica.

## Operação

- MySQL deve estar disponível para o Web App; o aplicativo cria as tabelas na inicialização inicial. Use usuário próprio e backups periódicos com restauração testada.
- O agente só apaga o lote local após ACK que confirme `batchId` e `committedThroughNsu`. Fila inválida fica em quarentena para análise; não pule checkpoints manualmente.
- NFS-e automática via ADN e municípios depende de conector habilitado e homologado, certificado/procuração com permissões reais e regras da fonte. O agente de transporte por si só não consulta portais nem emite/cancela notas.
- O banco guarda metadados e histórico de eventos, não o documento fiscal completo. Se a operação exigir guardar XML/PDF ou cumprir outra obrigação de retenção documental, defina armazenamento e política próprios antes de usar este fluxo para esse fim.
