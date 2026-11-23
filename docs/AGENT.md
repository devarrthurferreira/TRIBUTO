# Agente de transporte do TRIBUTO

Este agente Node.js 20+ roda no servidor 24 horas da contabilidade. Ele se conecta **de saída** à API do painel por HTTPS, envia batimentos de saúde, lê a lista de trabalhos e entrega lotes previamente colocados na fila local. Não há dependências npm. Não consulta SEFAZ, NFS-e nem prefeitura, não executa trabalhos recebidos e não emite, manifesta ou cancela notas. Os conectores fiscais serão componentes separados.

## Contrato com a API

| Método | Rota | Uso |
| --- | --- | --- |
| `GET` | `/v1/agent/jobs` | Lê `{ "jobs": [...] }` e registra somente a quantidade. Nenhum trabalho é executado. |
| `POST` | `/v1/agent/heartbeat` | Envia `agentId`, `hostname`, `version`, `queuedBatches`, `checkpoints` e `at`. Os checkpoints enviados são informativos; o servidor deve manter sua própria autoridade. |
| `POST` | `/v1/agent/batches` | Envia um lote completo e aguarda confirmação explícita antes de removê-lo da fila. |

Todas as chamadas usam `Authorization: Bearer <AGENT_TOKEN>`. O token é exclusivo da instalação, com escopo para os CNPJs autorizados e possibilidade de revogação e rotação na API. `API_BASE_URL` deve usar HTTPS; HTTP só é aceito para `localhost`, `127.0.0.1` ou `::1` em desenvolvimento. Não há necessidade de abrir uma porta de entrada no servidor do agente.

O lote em JSON tem este formato:

```json
{
  "batchId": "identificador-unico-do-lote",
  "companyCnpj": "00000000000000",
  "source": "NFE",
  "firstNsu": "1",
  "lastNsu": "2",
  "documents": [
    {
      "nsu": "1",
      "documentKey": "chave-do-documento",
      "xmlBase64": "Y29udGV1ZG8=",
      "sha256": "hash-sha256-hexadecimal-do-xml-decodificado"
    }
  ]
}
```

O exemplo acima **ilustra apenas o contrato**; não contém nota real nem é um lote válido para envio. Cada conector futuro deverá fornecer dados reais, conferir o SHA-256 e criar um `batchId` estável. `source` aceita `NFE` ou `NFSE`; são aceitos até 20 documentos, 300.000 bytes por XML decodificado e 1.000.000 bytes no arquivo JSON. O intervalo `firstNsu` a `lastNsu` deve conter **exatamente um documento por NSU, sem lacunas ou repetições**. A API deve aplicar os mesmos limites e verificar novamente CNPJ, escopo, hashes, documentos, autorização e duplicatas; dados do agente não devem ser considerados confiáveis sem validação.

A API confirma um lote novo ou repetido com HTTP 200/201 e:

```json
{ "ok": true, "batchId": "identificador-unico-do-lote", "committedThroughNsu": "2" }
```

O agente só atualiza seu checkpoint local quando `ok` é `true`, `batchId` coincide e `committedThroughNsu` é pelo menos `lastNsu`. A resposta deve ser enviada **depois** que os XMLs, metadados e checkpoint remoto estiverem duravelmente gravados. Se a resposta se perder, o mesmo lote será reenviado; a API deve devolver a mesma confirmação para o mesmo `batchId`, sem inserir documentos duplicados. O agente ordena lotes pendentes por fonte, CNPJ e primeiro NSU. O conector futuro deve respeitar a sequência de NSUs, limites e intervalos de cada serviço oficial.

## Configuração

| Variável | Significado |
| --- | --- |
| `API_BASE_URL` | Origem da API, por exemplo `https://tributo.exemplo.com`, sem caminho adicional. |
| `AGENT_TOKEN` | Token secreto do agente, de 32 a 256 caracteres alfanuméricos/`._~-`; jamais inclua no Git ou em argumentos de linha de comando. |
| `AGENT_STATE_DIR` | Diretório persistente da fila, identidade e checkpoints. Padrão: `.tributo-agent` na pasta do usuário do serviço. Defina um caminho absoluto em produção. |
| `AGENT_POLL_MS` | Intervalo normal entre ciclos, em milissegundos. Padrão `60000`; aceita de `10000` a `3600000`. Falhas aplicam espera progressiva até cinco minutos. |

Com Node.js 20+ instalado:

```text
node src/agent/agent.mjs --help
node src/agent/agent.mjs --once
node src/agent/agent.mjs
node src/agent/agent.mjs --enqueue caminho/para/lote.json
```

`--once` faz um ciclo e sai, adequado para diagnóstico ou execução agendada; retorna erro se algum CNPJ/fonte teve lote sem confirmação ou **enquanto houver arquivos em quarentena**. Sem argumentos, o processo continua em execução. `--enqueue` valida e grava um lote preparado por outro componente, sem consultar portais. Em erro de envio, o lote continua no diretório `queue`: os próximos lotes **do mesmo CNPJ e fonte** aguardam, mas os demais CNPJs e fontes continuam sendo enviados. Arquivos inválidos são movidos para `quarantine`, com registro apenas do nome do arquivo; outros lotes válidos continuam. Um operador deve restaurar ou reconciliar os arquivos da quarentena a partir de um backup antes de considerar a captura completa. Nunca edite os arquivos de checkpoint manualmente nem apague a fila para “destravar” uma falha: isso pode causar lacunas na captura.

## Windows (servidor 24 horas)

1. Instale Node.js 20+ e crie um agente no painel com os CNPJs/fontes autorizados. Copie o token exibido uma vez.
2. Execute o instalador descrito em [WINDOWS-INSTALL.md](WINDOWS-INSTALL.md), informando a origem HTTPS do painel e digitando o token quando solicitado. Ele valida a credencial, copia os arquivos para `C:\ProgramData\TRIBUTO` e cria uma tarefa com início automático e reinício após falhas.
3. O token fica cifrado com DPAPI; fila, checkpoints e logs ficam fora da pasta do código, com ACL restrita. Habilite criptografia do disco (por exemplo, BitLocker), pois os XMLs enfileirados **ainda não têm criptografia própria**.
4. Confira a última comunicação no painel e acompanhe logs, espaço livre e backup. O instalador atual usa `LocalService` para o transporte; antes de permitir acesso a A1, configure uma conta de serviço dedicada e a permissão específica da chave privada.

## Linux (alternativa)

Use um usuário de serviço dedicado, diretórios de estado com permissão `0700` e disco cifrado. Um exemplo de unidade `systemd`, ajustando os caminhos:

```ini
[Unit]
Description=TRIBUTO - agente de transporte
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tributo
Group=tributo
WorkingDirectory=/opt/tributo
EnvironmentFile=/etc/tributo/agent.env
ExecStart=/usr/bin/node /opt/tributo/src/agent/agent.mjs
Restart=always
RestartSec=15
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Restrinja `/etc/tributo/agent.env` ao administrador (`0600`) e defina nele as variáveis acima; deixe o diretório de estado gravável pela conta `tributo`. Não registre o token nos logs nem em comandos publicados.

## Recuperação e limites atuais

- O agente grava lotes e checkpoints por arquivo temporário, sincronização e renomeação no mesmo diretório. Na queda de rede ou reinício, reenvia lotes sem confirmação; a API precisa ser idempotente.
- Um arquivo de fila inválido é preservado em `quarantine` para investigação. O painel/API deve rejeitar saltos de NSU entre lotes, e o operador deve recuperar o intervalo faltante antes de retomar aquela empresa/fonte.
- O heartbeat mostra atividade do transporte. Uma captura fiscal real exigirá conectores, certificados A1 e permissões adequadas, tratamento de eventos, janela de distribuição e regras próprias de cada fonte.
- `jobs` é somente leitura nesta versão; receber uma tarefa não executa comandos ou ações fiscais.
- Se a API devolver erro permanente, ACK inconsistente ou negar o token, a fila fica preservada e o painel deve alertar o operador. Monitore também vencimento de A1, validade de procurações, espaço em disco, backups e atraso de sincronização.
- Backups do diretório de estado e do armazenamento remoto devem preservar privacidade e permitir restauração testada. Arquivos de fila contêm XML em base64, **sem criptografia própria**: proteja o disco, as permissões e os backups.
