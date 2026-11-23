# Contrato inicial: painel/API ↔ coletor

## Topologia

O serviço no Windows da Maximum abre conexões HTTPS de saída para a API. O painel lê dados no banco da API. Não há conexão iniciada pela nuvem para o Windows. Certificados A1, senhas e procurações não trafegam nesses endpoints.

O MVP implementa **o transporte confiável**, sem consultar SEFAZ ou ADN. O coletor apenas lê tarefas e transmite lotes que um conector futuro colocar em sua fila local. Nenhum endpoint emite notas, cancela notas, manifesta destinatários, executa comandos ou recebe uma URL para acessar.

## Autenticação

Cada instalação recebe um segredo aleatório exclusivo. A API guarda somente seu SHA-256 em `AGENT_TOKENS_JSON`, associado a CNPJs e fontes permitidas. O coletor guarda o segredo no servidor Windows e envia `Authorization: Bearer <segredo>` por HTTPS. Para revogar ou girar, retire/substitua o hash na configuração da API e reinicie o serviço. **Não use credenciais de login do painel como token do agente.**

Provisionamento inicial (PowerShell, em janela restrita):

```powershell
$bytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$token = [Convert]::ToHexString($bytes).ToLowerInvariant()
$hash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($token))).ToLowerInvariant()
# Guarde $token somente no servidor Windows; configure $hash na API.
```

O token em variável de ambiente é uma etapa inicial; para uso contínuo, instalar o serviço sob conta restrita e guardar o segredo no gerenciador de credenciais/DPAPI do Windows. Nunca publicar `AGENT_TOKEN`, `.env`, PFX ou senha no GitHub. A API requer uma chave `XML_ENCRYPTION_KEY` base64 de 32 bytes para cifrar XMLs com AES-256-GCM antes de gravar no MongoDB. Guarde e faça backup seguro dessa chave separadamente: perdê-la impede recuperar os XMLs já armazenados.

## Endpoints

| Método e rota | Corpo / resposta | Finalidade |
| --- | --- | --- |
| `GET /healthz` | `{ok:true}` | Estado básico da API, sem dados internos. |
| `GET /v1/agent/jobs` | `{jobs:[{id,companyCnpj,source,startNsu,lastCommittedNsu,enabled}]}` | Tarefas de leitura autorizadas; não contém comandos arbitrários. |
| `POST /v1/agent/heartbeat` | `{hostname,version,queuedBatches}` → `{ok,serverTime}` | Saúde do serviço, hora do servidor e fila. |
| `POST /v1/agent/batches` | Lote abaixo → `{ok,batchId,committedThroughNsu}` | Grava XMLs e checkpoint em transação; HTTP 201 no primeiro envio e 200 na repetição idêntica. |

Exemplo de lote (substituir por XML real, base64 e SHA-256 correspondentes):

```json
{
  "batchId": "b7ec75a1-993e-4a36-a332-0507022f537d",
  "companyCnpj": "12345678000190",
  "source": "NFE",
  "firstNsu": "1",
  "lastNsu": "1",
  "documents": [
    { "nsu": "1", "documentKey": "12345678901234567890123456789012345678901234", "xmlBase64": "PE5GZT5waWxvdG88L05GZT4=", "sha256": "CALCULE_O_HASH_REAL_DO_XML" }
  ]
}
```

`source` aceita `NFE` ou `NFSE`. O servidor valida hash do XML, tarefa ativa para o par CNPJ/fonte, limites do lote (até 20 documentos, 1 MB no total) e tamanho de cada XML (até 300 kB nesta versão). Os NSUs no lote precisam cobrir **cada número consecutivo** de `firstNsu` a `lastNsu`, e o primeiro precisa ser exatamente `startNsu + 1` no primeiro lote ou o próximo ao checkpoint remoto nos seguintes. Lacunas geram erro; a captura oficial deverá adaptar a sequência real da fonte a esse contrato. `batchId` repetido com o mesmo conteúdo devolve o ACK anterior; com conteúdo diferente, `409 BATCH_CONFLICT`. Lotes são aceitos somente após commit majoritário da transação no MongoDB. A coleção `documents` mantém o XML cifrado; nesta etapa cada CNPJ/fonte/NSU é imutável. Atualizações do resumo para XML integral exigirão uma evolução explícita do protocolo antes de ativar o conector NF-e. Ainda não há visor de notas no painel.

## Recuperação

O coletor conserva o lote localmente até receber `ok: true`, `batchId` igual e `committedThroughNsu` igual ou maior que `lastNsu`. Se o ACK se perder após o commit, o mesmo lote é reenviado e recebe resposta idempotente. A consulta futura às fontes fiscais precisa respeitar NSU e seus limites específicos; este contrato não determina sozinho que uma sequência fiscal esteja completa. Não se deve avançar o NSU na fonte antes de confirmar a persistência. Sem tarefa ativa no painel, o lote não será aceito, mesmo se já estiver na fila local.

## Operação e lacunas

- API requer MongoDB com suporte a transações (por exemplo, Atlas replica set), conexão TLS ao banco em produção, backups e `XML_ENCRYPTION_KEY` estável. Rotação da chave exige migração dos XMLs antes de trocar o valor.
- A API deve ficar atrás de HTTPS público; o agente rejeita HTTP fora de `localhost`.
- Em produção, configurar autenticação humana e permissões do painel separadamente, gerenciamento seguro das chaves e retenção/backup dos XMLs antes de liberar usuários.
- Ainda faltam conectores NF-e/NFS-e, validação fiscal de schema/assinatura, armazenamento externo de XML para escala, interface de notas e solicitação de cancelamento.
