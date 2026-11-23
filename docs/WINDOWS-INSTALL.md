# Instalar o agente no servidor Windows

O agente do TRIBUTO é o **motor local**: abre conexões HTTPS de saída para a API, informa saúde, recebe somente uma lista de tarefas de leitura e entrega lotes da fila. A tarefa agendada o inicia com o Windows, sem precisar manter uma janela CMD aberta nem abrir portas de entrada. A captura de NF-e/NFS-e ainda depende dos conectores fiscais a implementar; o instalador abaixo prepara apenas o transporte.

## Antes da instalação

1. Publique a API do TRIBUTO em uma origem **HTTPS**, configure o MongoDB e emita um token exclusivo para o agente, com escopo dos CNPJs autorizados.
2. Instale Node.js 20 ou superior no Windows para todos os usuários. Abra um PowerShell como **Administrador**.
3. Extraia/clone o repositório em uma pasta temporária. Não coloque A1, senha ou `.env` no repositório.
4. Tenha o token em mãos. O instalador pede o valor de forma interativa, verifica a autenticação em `/v1/agent/jobs` e só então registra a tarefa.

No PowerShell aberto como administrador, a partir da raiz do projeto:

```powershell
.\scripts\windows\Install-TributoAgent.ps1 -ApiBaseUrl 'https://tributo.seudominio.com.br'
```

Se o Windows bloquear o script extraído da internet, examine o arquivo e use `Unblock-File` nele antes de executar. O instalador usa `C:\ProgramData\TRIBUTO` como padrão; `-InstallRoot` permite outra pasta local chamada `TRIBUTO`. Ele copia o agente e o executor para lá e cria a tarefa **TRIBUTO Agent**, que inicia no boot, roda como `NT AUTHORITY\LOCAL SERVICE` e reinicia após erro. Um gatilho diário às 03h também inicia a tarefa caso ela tenha parado; não cria outra instância se já estiver rodando. O token não aparece em argumentos da tarefa, `.cmd` ou Git: fica cifrado com DPAPI da máquina em `agent-token.dpapi`, com acesso NTFS apenas a LocalService, Administradores e SYSTEM. [A Microsoft ressalta que DPAPI `LocalMachine` pode ser decriptado por outras contas](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.dataprotectionscope); por isso, as ACLs e o controle de administradores são essenciais.

`LocalService` é uma conta compartilhada entre serviços do Windows; ela oferece menos privilégios que SYSTEM, mas não isola este agente de outros processos que usem a mesma conta. Antes de integrar certificados A1 de clientes, considere uma conta exclusiva para o coletor e configure nela a permissão da chave privada. O instalador atual prepara o transporte e não acessa certificados.

O diretório `state` contém fila, checkpoints e quarentena; `logs` contém o arquivo de registro iniciado no dia em que a tarefa entrou em execução. Ambos permitem escrita da conta do agente, ficam fora do código e devem ser incluídos em backup protegido. Arquivos XML enfileirados estão em base64 e **não possuem criptografia própria**: habilite BitLocker no disco e restrinja o acesso à máquina. Faça rotação dos logs durante as atualizações periódicas para evitar crescimento indefinido.

## Conferir funcionamento

```powershell
Get-ScheduledTask -TaskName 'TRIBUTO Agent' | Get-ScheduledTaskInfo
Get-Content 'C:\ProgramData\TRIBUTO\logs\agent-*.log' -Tail 30
```

No painel, confira a última comunicação do agente. O token pode ser revogado no servidor; se isso ocorrer, a fila local permanece e o log indicará erro de autorização. Para atualizar o código ou trocar token, execute novamente o instalador; ele verifica o novo token e recria a tarefa. Ao trocar o certificado A1 no futuro, o arquivo e a senha continuarão no servidor Windows, sob permissões da conta de serviço.

## Remover a tarefa

```powershell
.\scripts\windows\Uninstall-TributoAgent.ps1
```

A remoção apaga a tarefa, o token e os binários locais. Preserva `state` e `logs` para evitar perda de lotes ainda não transmitidos. Faça a reconciliação e backup antes de decidir apagar esses dados manualmente.

**Limite atual:** o script foi escrito e revisado para Windows PowerShell 5.1, mas não foi executado em uma máquina Windows neste ambiente. O teste final de instalação e permissões precisa ocorrer no seu servidor antes de uso com XMLs reais.
