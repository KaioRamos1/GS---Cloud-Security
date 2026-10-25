# Kaio Automóveis — identidade visual

O projeto Minha Frota recebeu a marca **Kaio Automóveis** e um layout inspirado em fotografia editorial automotiva. A interface usa grafite, branco quente e verde elétrico, com foco em tecnologia e mobilidade elétrica.

## O que mudou

- Cabeçalho e rodapé com a marca Kaio Automóveis.
- Imagem de destaque ilustrativa de um carro conceito elétrico.
- Lista de veículos, busca por marca/modelo/placa e ordenação.
- Filtros para elétricos, híbridos e combustão.
- Formulário em uma janela, com edição de motorização e situação do veículo.
- Resumo de quantidade de veículos, elétricos/híbridos e custos registrados no mês.
- Agenda com até dez registros pendentes e as respectivas datas.
- Layout responsivo, rótulos acessíveis, mensagens de erro no formulário e navegação por teclado.

Não há telemetria, consulta a fabricantes, dados de bateria ou autonomia em tempo real. As contagens usam o campo `fuel` dos veículos cadastrados. Motorização não informada não é inferida a partir da marca/modelo. Um veículo com combustível não reconhecido continua visível em Todos.

## Arquivos para personalizar

| Arquivo | Responsabilidade |
| --- | --- |
| `dashboard.html` | Textos, títulos, marca e estrutura da tela |
| `static/style.css` | Cores, fontes, espaçamento e adaptação a celulares |
| `static/app.js` | Busca, filtros, cadastro, edição, exclusão e chamadas à API |
| `static/kaio-hero.png` | Imagem de destaque |
| `app.py` | API e rota autorizada para servir a nova imagem |
| `deploy/install.sh` | Instalação da imagem junto aos demais arquivos estáticos |

As cores principais ficam em `:root`, no começo do CSS. Altere `--accent` para mudar o verde e `--paper` para mudar o fundo claro. Para trocar a fotografia, use uma imagem própria/autorizada e mantenha o nome e o formato `static/kaio-hero.png`, preferencialmente com proporção 2:1. Confira os recortes no computador e no celular depois de trocar.

## Compatibilidade com o projeto original

A marca exibida mudou. O nome técnico do serviço `minhafrota`, as variáveis `MINHA_FROTA_*`, o cabeçalho `X-Requested-With: MinhaFrota`, os caminhos de implantação e o arquivo SQLite permanecem compatíveis com o projeto existente. Isso evita criar outro banco e perder a referência aos registros anteriores. A API continua usando Python, WSGI e SQLite; não foi adicionada biblioteca de frontend ou serviço externo.

O instalador desta atualização guarda cópias dos arquivos anteriores fora do repositório, altera somente a rota necessária no `app.py` existente e preserva eventuais outras edições na API. A interface HTML, CSS e JavaScript é substituída. O instalador não altera `.git`, `schema.sql` ou arquivos de banco de dados.

## Segurança e implantação

O JavaScript continua enviando o cabeçalho exigido pela proteção contra requisições de outra origem. Os textos dos veículos são inseridos no DOM como texto. A CSP e a lista explícita de rotas estáticas continuam ativas. A foto, o CSS e o JavaScript são servidos pelo próprio projeto, sem CDN. A autenticação HTTPS em produção continua dependendo da configuração Nginx documentada em `GUIA_AZURE.md`.

Depois de instalar localmente, rode `py -m unittest -v test_api.py`, confira a interface no navegador e faça o commit. Um `git push` atualiza o código no GitHub; a VM só muda após implantar os arquivos nela. O workflow original executa testes e verificações de segurança, não faz deploy automático.

## Imagem e autoria

A imagem `kaio-hero.png` foi gerada com assistência de IA como estudo visual de um veículo conceito sem marca. Não representa um automóvel real do estoque. A página a identifica como imagem ilustrativa. O redesenho e a implementação também tiveram assistência de IA; preserve essa transparência caso sua disciplina peça declaração de ferramentas utilizadas.

A autoria e as referências do projeto de origem continuam registradas em `ORIGEM.md`. Na documentação da atividade, pode-se usar “Kaio Automóveis (evolução do projeto Minha Frota)” e atualizar os prints com a interface que efetivamente rodar no seu computador ou na nuvem.

## Movimento da imagem

A foto de destaque recebeu zoom e deslocamento contínuos em CSS. No computador, há uma reação suave à posição do mouse. O texto, a navegação e os botões permanecem parados para manter a leitura estável. A imagem continua sendo um estudo visual estático animado na interface; não é vídeo do veículo em movimento.

O botão **Pausar movimento** permite congelar o efeito e retomá-lo. A preferência `prefers-reduced-motion` do sistema é respeitada. O movimento pausa com o banner fora da tela, a aba oculta ou o formulário de veículo aberto. O JavaScript altera classes e atributos de dados; a CSP existente não foi relaxada.

Os estilos ficam no fim de `static/style.css`, no bloco `kaio-hero-drift`; a duração `12s` é o tempo de cada direção do movimento. O código de interação fica no fim de `static/app.js`, em `initHeroMotion`.
