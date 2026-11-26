# Publicar o painel e a API na Hostinger Web Apps

O TRIBUTO usa **um único Web App Node.js** para o painel e a API. O agente permanece no servidor Windows da Maximum e conecta-se à API por HTTPS de saída. Dados do painel e **metadados fiscais** ficam no **MySQL criado no hPanel da própria Hostinger**. Os lotes fiscais armazenam somente metadados. O cadastro de clientes pode guardar PFX e senha cifrados em um cofre separado do transporte do agente.

## Pré-requisitos

- Web App Node.js e domínio/subdomínio com HTTPS no plano contratado.
- Acesso do GitHub ao repositório privado `devarrthurferreira/TRIBUTO`.
- Banco MySQL criado em **Websites → Gerenciar → Bancos de dados → MySQL** (o nome da seção pode variar no hPanel), com usuário e senha exclusivos para TRIBUTO. Confirme host, porta, cota e acesso do Web App ao banco no próprio hPanel.
- Segredo de configuração inicial gerado fora do repositório.

Gere um código inicial aleatório em **PowerShell** no computador do administrador. Coloque apenas o hash no hPanel e use o código original uma vez na tela de cadastro inicial:

```powershell
$setupBytes = [byte[]]::new(32)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($setupBytes)
$setupToken = [BitConverter]::ToString($setupBytes).Replace('-', '').ToLowerInvariant()
$sha = [Security.Cryptography.SHA256]::Create()
$setupTokenHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($setupToken))).Replace('-', '').ToLowerInvariant()
$sha.Dispose()
$rng.Dispose()
```

Guarde `$setupToken` até concluir o primeiro acesso. Não inclua esse valor, a senha MySQL ou o token do agente em arquivos do Git.

## Configuração no hPanel

1. Crie o banco e o usuário MySQL. Anote **host, porta, nome do banco e usuário** exatamente como exibidos no hPanel; o host pode diferir de `127.0.0.1` conforme a infraestrutura da conta. Permita ao usuário criar tabelas e índices na primeira inicialização, pois o aplicativo prepara seu esquema automaticamente.
2. Em **Websites → Create site → Web App**, importe o repositório privado, branch `main`. Use **Framework: Other**, raiz `/`, Node.js 22/24 se disponíveis e entrada `src/api/main.mjs`. Não há diretório de saída estático; o próprio Node serve `web/`. Se for exigido comando de build, use `npm run build`.
3. Defina as variáveis na configuração do Web App. O exemplo `.env.example` serve apenas de referência local; não publique `.env`.
4. Publique e abra `https://SEU-DOMINIO/healthz` e a página inicial. Crie o administrador com `$setupToken`, configure empresas, usuários, permissões e agente.
5. Remova `BOOTSTRAP_ADMIN_TOKEN_SHA256` das variáveis após criar o primeiro administrador. O banco bloqueia uma segunda configuração inicial; a remoção reduz a exposição desnecessária do hash.

| Variável | Valor no Web App |
| --- | --- |
| `MYSQL_HOST` | Host do MySQL informado no hPanel; use `127.0.0.1` somente se for o host indicado. |
| `MYSQL_PORT` | Porta informada no hPanel, normalmente `3306`. |
| `MYSQL_USER` | Usuário exclusivo do TRIBUTO. |
| `MYSQL_PASSWORD` | Senha do usuário MySQL, configurada somente como variável secreta. |
| `MYSQL_DATABASE` | Nome exato do banco criado no hPanel. |
| `BOOTSTRAP_ADMIN_TOKEN_SHA256` | `$setupTokenHash` (64 caracteres hex), temporariamente. |
| `COOKIE_SECURE` | `true` para HTTPS. |
| `HOST` | `127.0.0.1` no modo gerenciado, salvo orientação específica para o Web App. |
| `PORT` | `3000` ou a porta atribuída pela Hostinger. |

`MONGODB_URI`, `MONGODB_DB` e `XML_ENCRYPTION_KEY` pertenciam à versão anterior e **não são usadas** nesta instalação. A troca para MySQL não migra automaticamente dados de um MongoDB usado antes; se houver dados reais lá, planeje uma migração explícita antes de desligá-lo. Nunca copie um banco de produção sem testar restauração e permissões.

## Envio e acompanhamento do CRM

1. Verifique um domínio remetente no Resend e configure `CRM_EMAIL_FROM`, `CRM_RESEND_API_KEY` e `CRM_PUBLIC_URL` no hPanel, usando a origem HTTPS da Central em `CRM_PUBLIC_URL`.
2. Configure no Resend o webhook `https://SEU-DOMINIO/v1/marketing/resend/webhook`. Use a chave de assinatura do webhook em `CRM_RESEND_WEBHOOK_SECRET` e selecione os eventos de envio, entrega, abertura, clique e falha de e-mail. Habilite o rastreamento de aberturas e cliques no domínio remetente para receber esses eventos.
3. Defina `CRM_EMAIL_PROVIDER=resend` para ativar o processamento da fila. No CRM, prepare o público antes de enfileirar uma campanha. Páginas publicadas capturam inscrições com consentimento, e sequências de automação começam após a confirmação por e-mail.

Os valores de `CRM_RESEND_API_KEY` e `CRM_RESEND_WEBHOOK_SECRET` são segredos do servidor. Exercite a fila com uma lista de teste antes de preparar campanhas para a base de assinantes.

## Agente Windows e coleta

No painel, um administrador vincula um agente aos CNPJs/fontes permitidos. O token aparece uma vez e é digitado no instalador do Windows; consulte [WINDOWS-INSTALL.md](WINDOWS-INSTALL.md). Não é preciso abrir porta de entrada no servidor. O transporte e a ficha de NFS-e estão preparados para metadados. **A consulta automática ao ADN exige configurar e homologar separadamente o conector com certificado e autorização válidos**; ela não começa apenas por marcar NFS-e no painel. O A1 e sua senha ficam no Windows.

## Limite de espaço e operação

**50 GB de armazenamento do site não são 50 GB de MySQL.** Na oferta atual do plano Unlimited, o limite de banco informado é **3 GB**; confirme a cota efetiva da sua contratação no hPanel, inclusive se é por banco ou agregada. Com 500 empresas, o tamanho depende do total de notas, eventos, índices e período retido. Exemplo apenas para ordem de grandeza: 500 × 100 notas/mês × 12 meses × 1 KB por registro ≈ 600 MB de dados brutos por ano, **sem** índices, eventos e auditoria. Com 500 notas/mês por empresa seriam ≈ 3 GB brutos por ano, antes desses adicionais. Faça um piloto, acompanhe crescimento real e estabeleça uma margem de segurança; não prometa capacidade por número de empresas isolado.

Configure backup periódico do MySQL e teste a restauração. Monitore espaço, disponibilidade da API, última comunicação do agente e checkpoints por CNPJ. Arquivos de publicação podem ser substituídos em novos deploys: não guarde XML, PDF, certificado nem fila nessas pastas. A Hostinger Web Apps hospeda o painel/API; o processo de coleta contínua roda no Windows 24 horas.

### Cofre de certificados A1

Configure `CLIENT_CERT_ENCRYPTION_KEY` nas variáveis de ambiente do Web App para habilitar uploads. Use 32 bytes aleatórios em hexadecimal (`openssl rand -hex 32`) e guarde uma cópia no gerenciador de segredos usado pela operação. A chave precisa permanecer a mesma entre implantações para os certificados existentes.
