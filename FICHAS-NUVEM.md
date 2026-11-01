# Fichas editáveis AD&D 2e — edição pública

Ver Personagens contém cinco espaços com quatro páginas cada: atributos/combate, equipamentos/perícias e dois tomos de magia. Os campos são manuais; o app não calcula regras automaticamente. A ficha de referência é apenas um modelo; o PDF original e os dados dos jogadores não são publicados no repositório.

## Salvar e recuperar

Cada edição é guardada primeiro no armazenamento deste navegador e, após uma pausa na digitação, enviada ao servidor. “Salvar agora” força a sincronização. O aviso de status informa falhas; não descarte a cópia do aparelho quando houver erro. Para guardar uma cópia independente, use “Baixar cópia” (JSON) e depois “Importar cópia”. O JSON contém a chave privada de edição da ficha e deve ser guardado com cuidado.

Em outro dispositivo, abra o MESMO link da sala, entre na mesa, abra Ver Personagens e escolha o jogador. Selecione “Recuperar acesso” e informe a chave de edição que está disponível no primeiro aparelho. Sem ela, a ficha pode ser consultada, mas não modificada. Quem possui o link da sala consegue visualizar as fichas; não há cadastro de contas. Não coloque dados pessoais sensíveis nas fichas.

O salvamento é protegido contra versões antigas: se dois aparelhos alteram a mesma ficha ao mesmo tempo, o segundo recebe um conflito e sua cópia local é preservada. Baixe essa cópia antes de reabrir a versão da sala.

## Ativar persistência independente do Render

Sem banco externo, os documentos do servidor usam `MESA_DATA_DIR/characters`. Em Render Free isso é temporário. O backup do navegador sobrevive ao reinício do Render, mas não à limpeza do navegador nem à perda do aparelho.

Para recuperação em qualquer aparelho após reinícios:

1. Crie um projeto Free em https://supabase.com/dashboard (não é necessário colocar cartões ou contratar plano pago para este recurso).
2. Abra **SQL Editor** e execute o conteúdo de `supabase-characters.sql`. Isso cria a tabela e bloqueia o acesso direto por clientes anônimos.
3. No painel do projeto, copie a URL HTTPS do projeto e uma chave de servidor (`sb_secret_...`, ou a chave legada `service_role`). Nunca use `anon`/`publishable` para este backend.
4. Em **Render > mesa-sombria > Environment**, configure os seguintes segredos:
   - `MESA_SUPABASE_URL`: URL HTTPS do projeto.
   - `MESA_SUPABASE_SERVICE_KEY`: chave secreta do servidor.
5. Salve e aguarde o deploy/reinício. Abra Ver Personagens e confira “Salvamento em nuvem ativo”. Salve uma ficha antes de testar no segundo aparelho.

A chave de serviço fica apenas no servidor Python; não deve aparecer no HTML, JavaScript, GitHub ou chat. Este banco armazena somente fichas editáveis, não os uploads anteriores, livros ou MP3s.

Projetos Supabase Free podem pausar por inatividade; reative o projeto pelo painel se necessário. Guarde também cópias JSON. A nuvem não substitui backups.


## NPCs e imagens

A biblioteca de NPCs começa com uma ficha e permite criar outras pelo botão **Criar novo NPC**. Cada NPC tem documento, chave e versão próprios. O servidor utiliza um namespace separado no mesmo banco Supabase, sem alterar as cinco fichas dos jogadores e sem exigir migração de tabela.

As imagens dos personagens são convertidas para JPEG de até 800 pixels e salvas dentro do documento da ficha. Assim, também são recuperadas em outro aparelho e após reinícios do servidor. Envio e exclusão respeitam a chave de edição da ficha. A miniatura abre uma janela de visualização local.

**Abrir pasta** envia músicas da pasta e das subpastas em MP3, WAV, OGG, M4A, AAC, FLAC e WebM. Arquivos de outros tipos são ignorados. São mantidos os limites de 40 músicas, 50 MB por arquivo e 500 MB por sala; a reprodução de cada formato depende do navegador utilizado. Em aparelhos sem seletor de pastas, o botão permite selecionar vários arquivos.


## Exclusão de NPC e fundo enviado

**Excluir NPC** remove a ficha selecionada e sua imagem mediante confirmação e validação da chave de edição. Um registro mínimo de exclusão, sem os campos da ficha nem imagem, impede que cópias desatualizadas recriem o NPC automaticamente. Outras fichas permanecem independentes.

Em **Opções da mesa → Planos de fundos → Enviar plano**, é possível escolher JPG, PNG ou WebP do dispositivo. A imagem é otimizada e guardada como preferência deste navegador. **Meu plano enviado** reaplica a imagem, e os fundos originais continuam disponíveis.


## Biblioteca e campos adicionais

**Adicionar mais**, ao lado das capas, cria um espaço de livro por vez até 99. A navegação numérica identifica os livros de 1 a 99; as setas avançam ou recuam os grupos de números, mantendo até três capas na tela. Os espaços novos são compartilhados com os participantes da sala. As capas são carregadas apenas para os livros visíveis.

No leitor de PDF, **←** e **→** navegam pelas páginas. Os atalhos não interferem quando o foco está nos campos de página ou busca.

Nas fichas de jogadores e NPCs, **Adicionar mais armas** adiciona uma linha à tabela de armas. Em **Magias II**, **Adicionar mais magias** acrescenta uma ficha de magia. Quantidade e preenchimento são salvos junto ao personagem; os espaços anteriores são mantidos.


## Salvar livros na nuvem

Depois de enviar um PDF, abra-o e clique em **Salvar**, ao lado de **Excluir livro**. A indicação **Salvo na nuvem** aparece somente após a confirmação do armazenamento. O envio inicial continua temporário até essa ação.

O servidor guarda os PDFs em um bucket privado `mesa-books-private` do Supabase, usando as credenciais privadas já configuradas no Render. Partes de até 4 MiB permitem manter o limite de PDF de 100 MB sem depender de um arquivo único grande. O índice dos livros usa um namespace separado na tabela privada existente, sem alterar fichas de jogadores ou NPCs.

Após reinícios do Render, o índice é recuperado da nuvem; o PDF é reconstruído e verificado por SHA-256 quando aberto. O servidor envia o PDF ao navegador sem revelar chaves nem caminhos privados do armazenamento.

**Excluir livro** remove também a cópia da nuvem. Erros de armazenamento são exibidos e não confirmam um salvamento incompleto. A disponibilidade continua sujeita ao espaço e ao funcionamento do projeto Supabase; nenhum plano pago é ativado pelo aplicativo.


## Janela da Trilha da Party

O botão **Minimizar** recolhe o player; **Restaurar** devolve os controles. Essa ação é local e não pausa nem reinicia a trilha. O estado recolhido é lembrado neste navegador, e a posição do chat móvel acompanha a altura do player.

A música continua em seu elemento de áudio próprio. Os controles de volume da chamada não modificam o volume da trilha, e o áudio da música não é enviado pelo processamento de voz do microfone. Filtros de voz aplicados aos alto-falantes pelo Windows ou pelo fabricante do PC ficam fora do controle do site e podem suprimir instrumentos; devem ser verificados nas configurações do aparelho.
