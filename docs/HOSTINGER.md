# Publicar painel e API na Hostinger Web Apps

O TRIBUTO usa **um único aplicativo Node.js**: o mesmo processo entrega o painel e as rotas da API. O agente de coleta permanece no servidor Windows da Maximum e acessa a API por HTTPS de saída. O MongoDB é externo à Hostinger Web Apps; use um cluster MongoDB com suporte a transações, TLS e backup.

## Pré-requisitos

- Plano Hostinger Business ou Cloud com Web Apps e um domínio/subdomínio com HTTPS.
- Conta GitHub com acesso ao repositório privado `devarrthurferreira/TRIBUTO`.
- MongoDB Atlas ou serviço equivalente com replica set e usuário de banco restrito à base TRIBUTO.
- Valores secretos gerados fora do repositório para `XML_ENCRYPTION_KEY` e para o token de configuração inicial.

Gere os valores em PowerShell local, separadamente. Guarde o token de configuração inicial até concluir o primeiro acesso; informe **somente o hash** à Hostinger:

```powershell
$keyBytes = [byte[]]::new(32)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($keyBytes)
$xmlEncryptionKey = [Convert]::ToBase64String($keyBytes)

$setupBytes = [byte[]]::new(32)
$rng.GetBytes($setupBytes)
$setupToken = [BitConverter]::ToString($setupBytes).Replace('-', '').ToLowerInvariant()
$sha = [Security.Cryptography.SHA256]::Create()
$setupTokenHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($setupToken))).Replace('-', '').ToLowerInvariant()
$sha.Dispose()
$rng.Dispose()
```

`$xmlEncryptionKey` é um segredo permanente: seu backup protegido é necessário para recuperar os XMLs armazenados. `$setupToken` é usado uma vez no formulário inicial e não deve ser publicado no Git.

## Configuração no hPanel

1. Em **Websites → Create site → Web App**, escolha **Import your Git repository**. Autorize a conta GitHub que tem acesso ao TRIBUTO e selecione `devarrthurferreira/TRIBUTO`, branch `main`.
2. Configure **Framework: Other**, **Root directory: /**, **Node.js: 22 ou 24**, **Entry file: `src/api/main.mjs`**. O projeto não precisa de diretório de saída nem de build do frontend; `web/` é servido pelo próprio Node. Se o painel exigir Build command, use `npm run build` conforme o `package.json`.
3. Configure as variáveis de ambiente abaixo no hPanel. Não envie `.env` ao GitHub.
4. Publique e confira `https://SEU-DOMINIO/healthz` e a tela de configuração inicial em `/`. A Hostinger pode iniciar nova publicação a cada push na branch selecionada.

| Variável | Valor |
| --- | --- |
| `MONGODB_URI` | URI TLS do cluster MongoDB, com usuário restrito. |
| `MONGODB_DB` | Nome da base, por exemplo `tributo`. |
| `XML_ENCRYPTION_KEY` | `$xmlEncryptionKey` (base64 de 32 bytes). |
| `BOOTSTRAP_ADMIN_TOKEN_SHA256` | `$setupTokenHash` (64 caracteres hex). |
| `COOKIE_SECURE` | `true` em HTTPS. |
| `HOST` | `127.0.0.1` no modo gerenciado, salvo instrução específica da sua instalação. |
| `PORT` | `3000`, salvo porta atribuída pela Hostinger. |

Depois do primeiro administrador criado, remova `BOOTSTRAP_ADMIN_TOKEN_SHA256` das variáveis da Hostinger. O cadastro inicial já fica bloqueado pelo banco; a remoção reduz o tempo de exposição do segredo. Faça backup da chave de XML separadamente do banco, sob controle administrativo.

## Agente Windows

No painel, um administrador cria um agente e define os CNPJs/fontes autorizados. Copie o token **uma única vez** para a instalação em seu servidor Windows. Execute o instalador descrito em [WINDOWS-INSTALL.md](WINDOWS-INSTALL.md) apontando para a origem HTTPS do painel. O agente faz chamadas de saída; não é preciso abrir uma porta de entrada no Windows.

## Persistência e limites

Os documentos e os dados do painel ficam no MongoDB; o estado local do agente fica no Windows. Não guarde XML, PFX, fila ou dados de usuário nas pastas da publicação: a Hostinger substitui arquivos de deploy ao publicar versões novas. O plano gerenciado também não é o local para um coletor permanente. Monitore a disponibilidade da API, do MongoDB, a última comunicação do agente e os backups antes de operar com dados reais.
