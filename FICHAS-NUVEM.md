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
