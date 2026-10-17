# Radar das Baleias — versão celular

Esta versão roda **inteira no navegador do celular**: busca os dados direto da Binance, Hyperliquid,
Coinbase e outras fontes públicas e faz todos os cálculos no próprio aparelho. Não precisa de PC
ligado, servidor, cartão de crédito nem pagamento.

Ela só precisa ficar hospedada em algum lugar para você abrir pelo link. Vamos usar o **GitHub Pages**
(gratuito, só pede e-mail).

## Publicar (uma vez só, ~10 minutos — mais fácil pelo computador)

1. **Crie uma conta** em https://github.com (botão *Sign up*). Só e-mail e senha.
2. **Crie um repositório**: no canto superior direito, clique em **+** → **New repository**.
   - *Repository name*: `radar`
   - Marque **Public** (o GitHub Pages gratuito exige repositório público — veja "Privacidade" abaixo)
   - Clique em **Create repository**.
3. **Envie os arquivos**: na página do repositório, clique no link **uploading an existing file**.
   - Descompacte o `radar_celular.zip` no computador.
   - Arraste **todos os arquivos de dentro da pasta** `radar_celular` (index.html, motor.js,
     calculos.js, sw.js, manifest.json, os ícones etc.) para a área indicada.
   - Clique em **Commit changes**.
4. **Ligue o site**: no repositório, vá em **Settings** → **Pages** (menu da esquerda).
   - Em *Source*, escolha **Deploy from a branch**.
   - Em *Branch*, escolha **main** e a pasta **/ (root)** → **Save**.
   - Espere 1 a 2 minutos e recarregue a página: aparece o endereço do seu radar, no formato
     `https://SEU-USUARIO.github.io/radar/`.
5. **No celular**, abra esse endereço e:
   - Android (Chrome): menu **⋮** → **Adicionar à tela inicial** (ou "Instalar app").
   - iPhone (Safari): botão **Compartilhar** → **Adicionar à Tela de Início**.
   Pronto: o radar vira um ícone como qualquer app.

## Duas telas

- **Tela inicial (limpa)**: o clima do mercado em uma linha e um cartão por moeda com só o essencial:
  o veredito (🟢 comprar, 🟡 quase, ⚪ esperar, 🟠 vender uma parte, 🔴 hora de vender uma parte), uma
  frase dizendo o que fazer e, quando faz sentido, o motivo principal. Toque em **Detalhes** para ver
  o que pesa a favor e contra, o plano (compra em partes, saída e alvos) e **se o radar funciona
  nessa moeda**. O "?" no topo explica as cores.
- **📊 Modo completo** (botão na barra de baixo): o painel com todos os indicadores, gráficos e o Laboratório.

## 🌊 Capitulação (previsão antecipada)

Capitulação é quando muita gente desiste e vende no prejuízo ao mesmo tempo (SOPR no nível mais
baixo do último ano). Costuma acontecer perto dos fundos. Nesta seção, para cada moeda:

- **Chance de capitulação nas próximas 3 semanas**, comparada com a chance de um dia qualquer
  (o traço na barra). Vem de um modelo treinado no histórico de todas as moedas com o que aparecia
  nas semanas antes de cada capitulação: SOPR se aproximando do extremo, preço abaixo do custo
  médio, queda desde a máxima, queda da semana, funding, RSI e dias seguidos no prejuízo.
- **Fase**: risco baixo, aumentando, alto, acontecendo agora ou recuperando, com o que fazer em cada uma.
- **Zona provável do fundo**: faixa de preço calculada pela distância entre o fundo e o custo médio
  nas capitulações passadas daquela moeda.
- **Detalhes**: o que está empurrando agora (inclui sinais ao vivo como liquidações, baleias e
  medo, marcados "agora"), quantas capitulações o alerta avisou antes e as últimas capitulações,
  com o fundo e quanto o preço subiu 30 dias depois.
- No topo aparece o acerto no **teste** (período mais recente, que o modelo não usou para aprender).
  O app avisa quando o risco fica alto ou a capitulação começa.

## 💱 Operar (ordens prontas + diário)

- Em **Ajustar**, defina o orçamento total, o risco por operação (quanto aceita perder se bater na
  saída; 1% a 2% é o usual) e o máximo por moeda.
- Para cada moeda, o radar monta as ordens de acordo com o sinal: compra limitada em partes (agora
  ou programadas mais abaixo), a saída (stop) e os alvos, ou vendas quando o sinal é de realizar.
  Quantidade e preço já vêm arredondados pelas regras da Binance. **Toque num número para copiar** e
  cole no app da Binance. Também mostra quanto perde se bater na saída e quanto ganha no 1º alvo.
- Depois de executar, toque em **Registrar compra no diário**. O diário acompanha cada operação
  (resultado ao vivo, vendas parciais, compras adicionais), mostra o resultado das encerradas e
  **avisa quando o preço bate na saída ou num alvo**.
- O diário fica só no celular: use **Exportar backup** de vez em quando.
- O app **não envia ordens** para a Binance: você executa lá e registra aqui.

Os **Avisos** agora ficam no sino 🔔 no topo.

## Como o radar mede o próprio acerto

- **Decisão final testada no histórico**: o Laboratório refaz o sinal inteiro dia a dia no passado
  (só com o que se sabia em cada dia) e simula seguir o radar, com taxas e saída, contra só comprar e
  segurar. Também mostra quantas vezes cada veredito acertou a direção em 7 e 30 dias.
- **Ajuste por moeda**: com esse teste o radar escolhe para cada moeda quão exigente ser e a distância
  da saída (o "Sair se fechar abaixo de" do plano). Escolhe nos primeiros 70% do histórico e só mantém
  se também funcionar nos 30% finais, que o ajuste nunca viu.
- **Gatilho de virada**: com o preço barato, o radar só indica compra quando a queda para de verdade
  (fecha acima da máxima dos 3 dias anteriores ou o SOPR volta acima de 1). Evita "pegar a faca caindo".
- **Funding no Laboratório**: o histórico de anos do funding (aposta alavancada na alta ou na queda)
  também é testado por moeda e ajusta o peso desse fator.
- **Placar ao vivo**: cada sinal que aparece no seu celular fica registrado e é conferido 7 e 30 dias
  depois. O resultado aparece no topo da tela inicial ("Placar do radar") e nos Detalhes de cada moeda.

O que não tem histórico gratuito (baleias, fluxo ao vivo, opções, liquidações) fica de fora do teste
do passado, e por isso o placar ao vivo é a medida mais completa com o tempo.

## Indicadores do "dinheiro grande"

- **Quem puxa o preço**: compara compras e vendas à vista (spot) com as dos futuros. Alta puxada à
  vista costuma ser mais firme; alta puxada só pelos futuros (especulação) costuma ser frágil.
- **Absorção**: num minuto com volume muito acima do normal, se vendem forte e o preço não cai, há um
  comprador grande escondido (e vice-versa). Começa a funcionar ~20 min depois de abrir o app.
- **Filtro de paredes falsas**: ordens grandes no livro só contam se ficam por 3 leituras seguidas;
  as que somem rápido são tratadas como blefe e ignoradas.
- **Pesos por moeda**: o Laboratório testa no histórico de cada moeda quais fatores do sinal
  realmente funcionaram (treino nos primeiros 70% dos dias, confirmação nos 30% finais) e reforça ou
  reduz o peso de cada um. Veja em Modo completo → Laboratório.

- **Outras corretoras**: além da Binance, o fluxo ao vivo soma as compras e vendas da Bybit (à vista e
  futuros), OKX e Coinbase. Assim uma baleia que opera fora da Binance também aparece. Pode desligar em
  Minhas moedas → "🏦 Somar outras corretoras" (economiza internet).
- **Opções (Deribit)** — só BTC e ETH: mostra se os profissionais estão comprando proteção contra queda
  (medo) ou apostando na alta, a "máxima dor" (preço para onde o mercado costuma ser puxado até o
  vencimento) e a volatilidade esperada. Atualiza a cada 30 min.
- **Mapa estimado de liquidações**: estima, a partir das posições abertas nos futuros da Binance, em que
  preços muitas apostas alavancadas seriam forçadas a fechar. O preço costuma ser "atraído" para essas
  regiões. É uma **estimativa** (os dados exatos não são públicos). Atualiza a cada hora.
- **Stablecoins (USDT + USDC)**: quando o total cresce, há dinheiro novo pronto para comprar cripto;
  quando cai, dinheiro saindo. Atualiza a cada 6 horas.

- **Onde o preço está (trava contra "correr atrás do preço")**: junta a alta dos últimos 7 dias, o
  RSI diário, a distância do custo médio e a posição na faixa de 90 dias. Se a moeda acabou de subir
  rápido, o radar **não indica compra**, mesmo com o resto positivo: mostra "⏳ Esperar voltar para" um
  preço de suporte de verdade. Na tela inicial aparece em "📍 Preço agora está" (com desconto, preço
  médio, caro no curto prazo ou esticado). O Laboratório testa isso no histórico de cada moeda
  ("Preço com desconto" e "Alta rápida demais").

Tudo isso entra na decisão da tela inicial e aparece em "🐋 Dinheiro grande agora" e no "Ver plano".

## Bateria

O radar só calcula com o app aberto e na tela. Ao sair do app, os cálculos param na hora e a conexão
ao vivo é desligada 20 segundos depois. Ao voltar, tudo reconecta e atualiza sozinho.

## Primeiro uso

- Toque em **💼 Minhas moedas** para colocar quanto você tem e quanto pagou (opcional) e ligar os
  **avisos**. Pode usar vírgula nos números.
- Na primeira abertura o app baixa o histórico e calcula o Laboratório (alguns segundos). Depois
  isso fica guardado no celular e só é refeito a cada 6 horas.

## Atualizar para uma versão nova

No repositório do GitHub: **Add file** → **Upload files** → arraste os arquivos novos (eles
substituem os antigos) → **Commit changes**. Em 1 a 2 minutos o app no celular já abre a versão nova.
Seus ajustes ficam no celular e não se perdem.

## O que funciona e o que muda em relação à versão do PC

Funciona igual: sinal direto, plano, smart money, baleias da Hyperliquid, SOPR e custo, suportes,
mercado global, laboratório, alertas.

Diferenças:
- **Só calcula com o app aberto.** Com o celular bloqueado ou o app fechado, o navegador pausa tudo
  (para economizar bateria). Ao abrir de novo, ele atualiza sozinho em poucos segundos.
- **Fluxo ao vivo** (baleias da Binance, CVD, liquidações) conta a partir do momento em que você abre o app.
- **Alertas e notificações** acontecem enquanto o app está aberto (ou logo depois de você sair dele).
  Não chegam com o app fechado há muito tempo.
- Se alguma fonte nova (Deribit, stablecoins ou as outras corretoras) for bloqueada pela sua internet,
  o radar continua funcionando sem ela; no Modo completo → Mercado global ela aparece com erro.
- **Fluxo dos ETFs** fica só na versão do PC (o site de onde ele vem não permite acesso pelo navegador).
- **Teste ao vivo** do Laboratório: o app guarda uma "foto" do placar e do sinal a cada 15 minutos
  enquanto está aberto. Quanto mais você usar, mais confiável fica.

## Consumo de internet

- Com o **fluxo ao vivo** ligado: cerca de 10 a 20 MB por hora (um pouco mais com as outras corretoras ligadas) com o app aberto (desligue em Ajustes
  se estiver no 4G e quiser economizar).
- Baleias da Hyperliquid: o ranking de traders é baixado uma vez por dia (alguns MB).
- Laboratório: ~3 MB a cada 6 horas.

## Privacidade

- O repositório público contém **só o programa**. Suas moedas, quantidades e preços médios ficam
  guardados **apenas no seu celular** (não vão para o GitHub nem para nenhum servidor).
- Quem tiver o link consegue abrir o radar, mas verá só os dados públicos de mercado e os próprios
  ajustes (cada aparelho tem os seus).

## Limitações importantes

- O SOPR é uma **estimativa** feita com preço e volume, não o SOPR on-chain real.
- O sinal direto, o placar e o regime são **regras automáticas**, não previsões. Use o Laboratório
  para ver se eles funcionaram para cada moeda.
- Ferramenta de acompanhamento; não é recomendação de investimento.

Gráficos: TradingView Lightweight Charts™ (licença Apache 2.0, arquivo incluído).
