# Mesa Sombria — servidor público

Cópia independente do aplicativo local, preparada para hospedagem Docker e Render. Não requer PC ligado, Cloudflare Tunnel ou inicializadores do Windows após o deploy.

## Publicar

1. Crie um repositório público vazio no GitHub, por exemplo `rolagem-de-dados-publico`. Envie os arquivos desta pasta, incluindo Dockerfile e render.yaml, na raiz do repositório.
2. No Render (https://dashboard.render.com), conecte o GitHub e selecione **New > Blueprint**. Escolha o repositório, confira `plan: free` e aplique a configuração.
3. Aguarde o deploy. Use o endereço HTTPS `.onrender.com` devolvido pelo Render. Abra a sala e envie o convite gerado pelo app.

O GitHub armazena o código. GitHub Pages não executa este servidor Python. Um domínio `.net` próprio é opcional e não está incluído; use inicialmente o subdomínio gratuito do provedor.

## Limites do plano gratuito

O Render pode suspender o serviço após inatividade e sua primeira abertura pode demorar. O disco gratuito é temporário: fichas, PDFs, imagens e MP3s enviados podem desaparecer quando a instância reinicia, suspende ou é substituída. As salas, o histórico e o chat também ficam em memória e são reiniciados. Esta configuração gratuita é adequada para experimentar; não prometa armazenamento permanente aos jogadores.

Para conservar uploads, use um volume persistente suportado pelo provedor e ajuste `MESA_DATA_DIR` para o ponto de montagem, ou implemente armazenamento externo antes de uso permanente. Isso não está incluído no plano gratuito deste manifesto.

## Videoconferência

Vídeo/áudio continuam usando WebRTC. Hospedar a página publicamente não cria um relay TURN. Em redes restritivas, configure no painel de ambiente do serviço `MESA_TURN_URLS` e `MESA_TURN_SHARED_SECRET` para coturn, ou `MESA_TURN_USERNAME` e `MESA_TURN_CREDENTIAL` conforme seu provedor. Nunca publique segredos no GitHub. Sem essas variáveis, o app usa STUN.

## Executar e verificar

Sem dependências Python adicionais: `python app.py`. O serviço escuta em `0.0.0.0`, usa `PORT` do provedor e fornece `/healthz` para monitoramento. Mantenha uma instância para que as salas compartilhem a mesma memória. Não aumente réplicas sem mover estado e sinalização para um serviço compartilhado.

Esta cópia não inclui fichas pessoais, uploads, segredos ou executáveis da instalação local. Os arquivos enviados às salas ficam acessíveis a quem conhece o link da sala; não há cadastro/autenticação de contas. Não publique dados sensíveis sem implementar controle de acesso.
