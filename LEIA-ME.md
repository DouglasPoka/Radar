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

- **Tela inicial (simples)**: o clima do mercado e um cartão por moeda dizendo, em português do dia a
  dia, se é hora de 🟢 comprar, 🟡 quase, ⚪ esperar, 🟠 vender uma parte ou 🔴 vender uma parte e evitar
  compras — com o porquê, os preços de referência e um plano simples ("Ver plano").
- **📊 Modo completo** (botão na barra de baixo): o painel com todos os indicadores, gráficos e o Laboratório.

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
- **Fluxo dos ETFs** fica só na versão do PC (o site de onde ele vem não permite acesso pelo navegador).
- **Teste ao vivo** do Laboratório: o app guarda uma "foto" do placar e do sinal a cada 15 minutos
  enquanto está aberto. Quanto mais você usar, mais confiável fica.

## Consumo de internet

- Com o **fluxo ao vivo** ligado: cerca de 10 a 20 MB por hora com o app aberto (desligue em Ajustes
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
