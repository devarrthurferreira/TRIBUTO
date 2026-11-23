# Agente Windows do TRIBUTO

O agente Node.js roda no servidor 24 horas da Maximum. Ele se conecta **de saída** à API na Hostinger por HTTPS, envia heartbeat, lê os CNPJs/fontes atribuídos e transmite lotes de **metadados fiscais** preparados localmente. O transporte sozinho **não consulta portais nem executa trabalhos recebidos**. A coleta via ADN é um conector separado, com habilitação e homologação próprias; não pressupõe cobertura de todas as prefeituras. Ele não emite, manifesta ou cancela notas.

## Ciclo de sincronização

1. O administrador cadastra empresas e um agente no painel; define CNPJs/fontes. O token aparece uma vez.
2. O serviço Windows envia `POST /v1/agent/heartbeat` e consulta `GET /v1/agent/jobs` com `Authorization: Bearer <AGENT_TOKEN>`.
3. Um conector autorizado, quando configurado, transforma os resultados em **chave e campos mínimos** e coloca lotes JSON na fila. O arquivo da fila não deve conter XML/PDF.
4. O transporte envia `POST /v1/agent/batches`; a API grava lote, nota/eventos e checkpoint em uma transação MySQL. Só após ACK válido o arquivo local é removido e o checkpoint local é avançado.
5. Se cair a rede ou o processo reiniciar, o mesmo lote é reenviado. A API reconhece repetição idêntica sem duplicar registros.

O contrato JSON completo e as regras de NSU estão em [API.md](API.md). O token do agente é diferente da senha de login do painel. Não é necessário abrir uma porta de entrada no servidor Windows.

## Configuração

| Variável | Uso |
| --- | --- |
| `API_BASE_URL` | Origem HTTPS do painel, sem caminho, por exemplo `https://tributo.exemplo.com`. HTTP só em loopback para desenvolvimento. |
| `AGENT_TOKEN` | Token exibido uma vez no painel; nunca no Git ou nos argumentos do processo. |
| `AGENT_STATE_DIR` | Pasta persistente de identidade, fila, quarentena e checkpoints. Use caminho absoluto em produção. |
| `AGENT_POLL_MS` | Intervalo em milissegundos: padrão `60000`, permitido de `10000` a `3600000`. Falhas aplicam espera progressiva. |

Com Node.js 20+ instalado, comandos de diagnóstico/manutenção:

```text
node src/agent/agent.mjs --help
node src/agent/agent.mjs --once
node src/agent/agent.mjs
node src/agent/agent.mjs --enqueue caminho/para/lote.json
```

`--once` executa um ciclo; sem argumentos, o transporte continua em execução. `--enqueue` valida um lote já preparado e o grava na fila, **sem consultar qualquer portal**. Cada lote pode ter até 20 itens e 1 MB de JSON; `XML`/`PDF` e campos extras são rejeitados. Consulte [API.md](API.md) antes de implementar um produtor de lotes.

## Instalação no Windows

1. Instale Node.js 20+, crie um agente no painel e copie o token exibido uma vez.
2. Execute o instalador em [WINDOWS-INSTALL.md](WINDOWS-INSTALL.md), informando o endereço HTTPS e digitando o token quando solicitado. Ele testa o acesso, instala os arquivos em `C:\ProgramData\TRIBUTO` e cria tarefas para inicialização/reinício.
3. O token fica protegido com DPAPI e ACL NTFS; fila, checkpoints e logs permanecem fora do código. Restrinja acesso à pasta, faça backup e monitore disco, fila e comunicação no painel.
4. O instalador atual usa `LocalService` para **transporte**. Antes de liberar acesso a certificado A1, utilize conta de serviço dedicada e conceda somente à identidade correta acesso à chave privada. A senha e o PFX não pertencem ao Web App, MySQL ou repositório.

O arquivo `.env.example` é apenas ilustrativo; o instalador guarda o token conforme o guia Windows. O conector ADN tem configuração separada e só deve operar após os testes/homologação indicados em [ADN.md](ADN.md).

## Recuperação e limites

- Em falha de envio, o lote permanece na pasta `queue`. Um lote inválido vai para `quarantine`; outros CNPJs continuam, mas lotes posteriores do mesmo CNPJ/fonte aguardam a reconciliação.
- Não apague fila nem edite checkpoints para “destravar” uma falha. Preserve os arquivos para investigação e recupere o intervalo da fonte antes de avançar.
- O heartbeat atesta o transporte, **não** a cobertura fiscal. A ficha da empresa mostra o último checkpoint recebido; cobertura por período/município depende do conector e da fonte.
- O MySQL guarda apenas metadados. Se precisar manter XML ou PDF para outra finalidade, providencie armazenamento e política próprios; este agente não faz backup de documento integral.
