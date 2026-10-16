/* =====================================================================
   RADAR DAS BALEIAS — MOTOR (versão celular)
   Faz no navegador o que o monitor.py faz no PC: busca os dados da
   Binance, Hyperliquid, Coinbase etc., mantém o fluxo ao vivo, roda o
   SOPR, o Laboratório e o sinal direto, e responde às chamadas /api/*
   do painel (sem servidor nenhum).
   ===================================================================== */
(function () {
"use strict";
const C = window.Calc;

// ------------------------------------------------------------ ajustes (ficam no celular)
const PADRAO = {
  moedas: [
    {simbolo: "BTCUSDT", quantidade: 0, preco_medio: 0, trade_grande_usd: 500000},
    {simbolo: "ETHUSDT", quantidade: 0, preco_medio: 0, trade_grande_usd: 250000},
    {simbolo: "PENDLEUSDT", quantidade: 0, preco_medio: 0, trade_grande_usd: 50000},
    {simbolo: "NEARUSDT", quantidade: 0, preco_medio: 0, trade_grande_usd: 50000},
    {simbolo: "RENDERUSDT", quantidade: 0, preco_medio: 0, trade_grande_usd: 50000},
  ],
  janela_minutos: 60, intervalo_indicadores: 60, fluxo_ao_vivo: true, hyperliquid: true,
  hl_contas: 60, hl_saldo_min: 1000000, notificacoes: false, som: true,
  avisos_simples: true,
  mais_corretoras: true,  // somar Bybit, OKX e Coinbase ao fluxo da Binance   // notificar só mudanças do sinal direto, em linguagem simples
  oi_variacao_pct: 5, funding_extremo_pct: 0.05, liquidacoes_usd: 1000000, faixa_livro_pct: 2,
};
const ls = {
  get(k, p) { try { const v = localStorage.getItem(k); return v == null ? p : JSON.parse(v); } catch (e) { return p; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
const AJ = Object.assign({}, PADRAO, ls.get("radar_ajustes", {}));

const BN = {spot: "https://api.binance.com", fut: "https://fapi.binance.com",
  wsSpot: "wss://stream.binance.com:9443/stream", wsFut: "wss://fstream.binance.com/stream"};
const HL_INFO = "https://api.hyperliquid.xyz/info", HL_RANKING = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";
const agoraS = () => Date.now() / 1000;
const dormir = ms => new Promise(r => setTimeout(r, ms));
const hm = () => new Date().toLocaleString("pt-BR", {day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"}).replace(",", "");

async function http(url, params, opcoes = {}) {
  const u = new URL(url);
  if (params) for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), opcoes.timeout || 20000);
  try {
    const r = await fetch(u.toString(), {...opcoes, signal: ctl.signal});
    if (!r.ok) throw new Error(`${u.hostname} HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`${u.hostname}: tempo esgotado`);
    if (e instanceof TypeError) throw new Error(`${u.hostname}: sem conexão ou bloqueado`);
    throw e;
  } finally { clearTimeout(t); }
}
const hlPost = corpo => http(HL_INFO, null, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(corpo)});

// ------------------------------------------------------------ estado do motor
const M = {
  inicio: Date.now() / 1000,
  moedas: new Map(), status: {spot: "conectando", futuros: "conectando", corretoras: "aguardando", indicadores: "aguardando", sopr: "aguardando", lab: "aguardando", externo: "aguardando"},
  sopr_atualizado: 0, sopr_intervalo: 3600, lab: {}, lab_atualizado: 0, lab_vivo: {dias: 0, moedas: {}},
  externo: {hl_mercado: {}, baleias_hl: {}, coinbase: {}, etf: {}, medo: {}, dominancia: {}, stable: null, opcoes: {}, atualizado: {}, erros: {}},
  mapas: {}, corretoras: {},
  forca: {}, sinais: {}, alertas: ls.get("radar_alertas", []), placarAnt: {}, tomAnt: {}, hlAnt: {}, ultimoAviso: {},
  estab: new C.Estabilizador(Math.max(2, Math.ceil(120 / AJ.intervalo_indicadores))),
  ws: {},
};
function criarMoedas() {
  M.moedas.clear();
  for (const m of AJ.moedas) M.moedas.set(m.simbolo.toUpperCase(), new C.EstadoMoeda({
    simbolo: m.simbolo.toUpperCase(), quantidade: +m.quantidade || 0, preco_medio: +m.preco_medio || 0,
    trade_grande_usd: +m.trade_grande_usd || 100000, janela_seg: AJ.janela_minutos * 60}));
}
const nomeHL = s => s.replace("USDT", "");

// ------------------------------------------------------------ alertas
let somCtx = null;
function bipe() {
  if (!AJ.som) return;
  try { somCtx = somCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = somCtx.createOscillator(), g = somCtx.createGain(); o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g); g.connect(somCtx.destination); o.start(); o.stop(somCtx.currentTime + 0.18); } catch (e) {}
}
async function notificar(titulo, texto) {
  if (!AJ.notificacoes || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.showNotification(titulo, {body: texto, icon: "./icone-192.png", badge: "./icone-192.png"});
    else new Notification(titulo, {body: texto, icon: "./icone-192.png"});
  } catch (e) {}
}
function emitir(simbolo, tipo, texto, {espera = 600, importante = true, tom = "neutro", amigavel = null} = {}) {
  const k = simbolo + ":" + tipo, t = agoraS();
  if (t - (M.ultimoAviso[k] || 0) < espera) return;
  M.ultimoAviso[k] = t;
  M.alertas.push({ts: t, hora: hm(), moeda: simbolo.replace("USDT", ""), tipo, texto, importante, tom});
  M.alertas = M.alertas.slice(-200);
  ls.set("radar_alertas", M.alertas.slice(-80));
  if (!importante) return;
  // no modo simples, só avisa o que tem texto amigável (mudanças do sinal direto)
  if (AJ.avisos_simples && !amigavel) return;
  bipe(); notificar(`${simbolo.replace("USDT", "")} · Radar das Baleias`, amigavel || texto);
}

// ------------------------------------------------------------ WebSockets (fluxo ao vivo)
function tratarTrade(msg, origem) {
  const d = msg.data || msg;
  if (d.e === "aggTrade") {
    const est = M.moedas.get(d.s); if (!est) return;
    const ev = est.registrarTrade(+d.p, +d.q, d.m, origem, d.T / 1000);
    if (ev) emitir(est.simbolo, "baleia_" + ev.lado,
      `Baleia ${ev.lado === "compra" ? "COMPROU" : "VENDEU"} ${C.fmtUsd(ev.valor)} a mercado (${origem}) a ${C.fmtPreco(ev.preco)}`,
      {espera: 0, importante: ev.valor >= est.trade_grande_usd * 3, tom: ev.lado === "compra" ? "alta" : "baixa"});
  } else if (d.e === "forceOrder") {
    const o = d.o, est = M.moedas.get(o.s); if (!est) return;
    const ev = est.registrarLiquidacao(+(o.ap || o.p), +(o.z || o.q), o.S);
    const tot = est.liquidacoes.soma(ev.lado);
    if (tot >= AJ.liquidacoes_usd) emitir(est.simbolo, "liq_" + ev.lado, `${C.fmtUsd(tot)} em ${ev.lado.toUpperCase()}S liquidados na última janela`,
      {tom: ev.lado === "short" ? "alta" : "baixa"});
  }
}
function abrirWS(nome, base, streams, origem) {
  const atual = M.ws[nome];
  if (atual && (atual.readyState === 0 || atual.readyState === 1)) return;
  if (!streams.length) { M.status[nome] = "indisponível"; return; }
  let espera = M.ws[nome + "_espera"] || 2000;
  const ws = new WebSocket(base + "?streams=" + streams.join("/"));
  M.ws[nome] = ws;
  ws.onopen = () => { M.status[nome] = "ok"; M.ws[nome + "_espera"] = 2000; };
  ws.onmessage = ev => { try { tratarTrade(JSON.parse(ev.data), origem); } catch (e) {} };
  ws.onclose = () => {
    if (!AJ.fluxo_ao_vivo) { M.status[nome] = "desligado"; return; }
    if (M.pausado) { M.status[nome] = "pausado"; return; }
    M.status[nome] = "reconectando";
    M.ws[nome + "_espera"] = Math.min(espera * 2, 60000);
    setTimeout(() => { if (document.visibilityState === "visible") abrirWS(nome, base, streams, origem); }, espera);
  };
  ws.onerror = () => { M.status[nome] = "erro: conexão recusada"; };
}
function ligarFluxo() {
  if (!AJ.fluxo_ao_vivo) { M.status.spot = M.status.futuros = "desligado"; return; }
  const l = [...M.moedas.keys()].map(s => s.toLowerCase());
  const fut = [...M.moedas.values()].filter(e => e.futuros_disponivel).map(e => e.simbolo.toLowerCase());
  abrirWS("spot", BN.wsSpot, l.map(s => s + "@aggTrade"), "spot");
  abrirWS("futuros", BN.wsFut, [...fut.map(s => s + "@aggTrade"), ...fut.map(s => s + "@forceOrder")], "futuros");
  if (AJ.mais_corretoras) for (const n of Object.keys(EXTRAS)) abrirExtra(n);
}
// ---------- outras corretoras (Bybit, OKX, Coinbase): só fluxo e baleias
const EXTRAS = {
  bybit_spot: {url: "wss://stream.bybit.com/v5/public/spot", origem: "spot", corretora: "bybit",
    subs: ss => ss.map(s => JSON.stringify({op: "subscribe", args: ["publicTrade." + s]})), ping: () => JSON.stringify({op: "ping"}), intervalo: 20000,
    tratar(d) { if (!d.topic?.startsWith("publicTrade.")) return; for (const t of d.data || []) entradaExtra(t.s, +t.p, +t.v, t.S === "Sell", "spot", t.T / 1000, "bybit"); }},
  bybit_fut: {url: "wss://stream.bybit.com/v5/public/linear", origem: "futuros", corretora: "bybit",
    subs: ss => ss.map(s => JSON.stringify({op: "subscribe", args: ["publicTrade." + s]})), ping: () => JSON.stringify({op: "ping"}), intervalo: 20000,
    tratar(d) { if (!d.topic?.startsWith("publicTrade.")) return; for (const t of d.data || []) entradaExtra(t.s, +t.p, +t.v, t.S === "Sell", "futuros", t.T / 1000, "bybit"); }},
  okx: {url: "wss://ws.okx.com:8443/ws/v5/public", origem: "spot", corretora: "okx",
    subs: ss => ss.map(s => JSON.stringify({op: "subscribe", args: [{channel: "trades", instId: s.replace("USDT", "-USDT")}]})), ping: () => "ping", intervalo: 25000,
    tratar(d) { if (d.arg?.channel !== "trades") return; for (const t of d.data || []) entradaExtra(t.instId.replace("-", ""), +t.px, +t.sz, t.side === "sell", "spot", +t.ts / 1000, "okx"); }},
  coinbase: {url: "wss://ws-feed.exchange.coinbase.com", origem: "spot", corretora: "coinbase",
    subs: ss => ss.map(s => JSON.stringify({type: "subscribe", product_ids: [s.replace("USDT", "-USD")], channels: ["matches"]})), ping: null,
    // na Coinbase, "side" é o lado de quem deixou a ordem parada: side "buy" = o agressor VENDEU
    tratar(d) { if (d.type !== "match") return; entradaExtra(d.product_id.replace("-USD", "USDT"), +d.price, +d.size, d.side === "buy", "spot", Date.parse(d.time) / 1000, "coinbase"); }},
};
function entradaExtra(simbolo, preco, qtd, vendedor, origem, ts, corretora) {
  const est = M.moedas.get(simbolo); if (!est || !(preco > 0) || !(qtd > 0)) return;
  M.corretoras[corretora] = agoraS();
  const ev = est.registrarTrade(preco, qtd, vendedor, origem, ts, corretora);
  if (ev) emitir(est.simbolo, "baleia_" + ev.lado, `Baleia ${ev.lado === "compra" ? "COMPROU" : "VENDEU"} ${C.fmtUsd(ev.valor)} a mercado (${corretora} ${origem}) a ${C.fmtPreco(ev.preco)}`,
    {espera: 0, importante: ev.valor >= est.trade_grande_usd * 3, tom: ev.lado === "compra" ? "alta" : "baixa"});
}
function abrirExtra(nome) {
  const cfg = EXTRAS[nome], atual = M.ws[nome];
  if (atual && (atual.readyState === 0 || atual.readyState === 1)) return;
  const espera = M.ws[nome + "_espera"] || 3000;
  let ws; try { ws = new WebSocket(cfg.url); } catch (e) { return; }
  M.ws[nome] = ws;
  ws.onopen = () => { M.ws[nome + "_espera"] = 3000; for (const msg of cfg.subs([...M.moedas.keys()])) ws.send(msg);
    if (cfg.ping) M.ws[nome + "_ping"] = setInterval(() => { try { ws.send(cfg.ping()); } catch (e) {} }, cfg.intervalo); };
  ws.onmessage = ev => { if (typeof ev.data !== "string" || ev.data === "pong") return; try { cfg.tratar(JSON.parse(ev.data)); } catch (e) {} };
  ws.onclose = () => { clearInterval(M.ws[nome + "_ping"]);
    if (M.pausado || !AJ.fluxo_ao_vivo || !AJ.mais_corretoras) return;
    M.ws[nome + "_espera"] = Math.min(espera * 2, 120000);
    setTimeout(() => { if (document.visibilityState === "visible" && !M.pausado) abrirExtra(nome); }, espera); };
  ws.onerror = () => {};
}
function statusCorretoras() {
  if (!AJ.fluxo_ao_vivo || !AJ.mais_corretoras) { M.status.corretoras = "desligado"; return; }
  const t = agoraS(), nomes = {bybit: "Bybit", okx: "OKX", coinbase: "Coinbase"};
  const vivas = Object.keys(nomes).filter(c => t - (M.corretoras[c] || 0) < 180);
  M.status.corretoras = vivas.length === 3 ? "ok" : vivas.length ? "parcial: só " + vivas.map(c => nomes[c]).join(", ") : (t - M.inicio < 60 ? "conectando" : "parcial: nenhuma respondeu");
}
setInterval(statusCorretoras, 5000);
function desligarFluxo() { for (const n of ["spot", "futuros", ...Object.keys(EXTRAS)]) { try { M.ws[n]?.close(); } catch (e) {} M.ws[n] = null; } }

// ------------------------------------------------------------ verificação inicial
async function verificarSimbolos() {
  for (const s of [...M.moedas.keys()]) {
    try { await http(BN.spot + "/api/v3/ticker/price", {symbol: s}); }
    catch (e) { if (/HTTP 400/.test(e.message)) { emitir(s, "invalido", `Par ${s} não existe no spot da Binance; removido.`, {importante: false}); M.moedas.delete(s); } else throw e; }
  }
  await Promise.all([...M.moedas.values()].map(async e => {
    try { await http(BN.fut + "/fapi/v1/premiumIndex", {symbol: e.simbolo}); e.futuros_disponivel = true; }
    catch (err) { e.futuros_disponivel = false; }
  }));
}

// ------------------------------------------------------------ indicadores (livro, funding, OI...)
let ultimoRsi = 0;
async function atualizarMoeda(est, comRsi) {
  const s = est.simbolo;
  const [t24, livro] = await Promise.all([http(BN.spot + "/api/v3/ticker/24hr", {symbol: s}), http(BN.spot + "/api/v3/depth", {symbol: s, limit: 500})]);
  est.preco = +t24.lastPrice; est.variacao_24h = +t24.priceChangePercent; est.vwap_24h = +t24.weightedAvgPrice;
  est.atualizarLivro(livro.bids, livro.asks, AJ.faixa_livro_pct);
  if (comRsi) { const v = await http(BN.spot + "/api/v3/klines", {symbol: s, interval: "1h", limit: 100}); est.rsi_1h = C.rsi(v.map(k => +k[4])); }
  if (est.futuros_disponivel) {
    const r = await Promise.allSettled([
      http(BN.fut + "/fapi/v1/premiumIndex", {symbol: s}),
      http(BN.fut + "/futures/data/openInterestHist", {symbol: s, period: "5m", limit: 13}),
      http(BN.fut + "/futures/data/topLongShortPositionRatio", {symbol: s, period: "5m", limit: 1}),
      http(BN.fut + "/futures/data/takerlongshortRatio", {symbol: s, period: "5m", limit: 1})]);
    const [prem, oih, tls, tkr] = r.map(x => (x.status === "fulfilled" ? x.value : null));
    if (prem) est.funding_pct = +prem.lastFundingRate * 100;
    if (oih?.length) { const a = +oih[oih.length - 1].sumOpenInterestValue, b = +oih[0].sumOpenInterestValue; est.oi_usd = a; est.oi_var_1h_pct = b ? (a / b - 1) * 100 : null; }
    if (tls?.length) est.top_long_short = +tls[tls.length - 1].longShortRatio;
    if (tkr?.length) est.taker_buy_sell = +tkr[tkr.length - 1].buySellRatio;
  }
  checarAlertas(est);
}
function checarAlertas(est) {
  if (est.oi_var_1h_pct != null && Math.abs(est.oi_var_1h_pct) >= AJ.oi_variacao_pct)
    emitir(est.simbolo, "oi", `Open interest ${est.oi_var_1h_pct > 0 ? "subiu" : "caiu"} ${C.br(est.oi_var_1h_pct, 1, true)}% em 1h`);
  if (est.funding_pct != null && Math.abs(est.funding_pct) >= AJ.funding_extremo_pct)
    emitir(est.simbolo, "funding", `Funding extremo: ${C.br(est.funding_pct, 3, true)}%`, {espera: 3600});
  const [p, mot] = est.pontuacao(), ant = M.placarAnt[est.simbolo];
  if (ant != null) for (const lim of [40, -40]) {
    const cruzou = lim > 0 ? ant < lim && lim <= p : ant > lim && lim >= p;
    if (cruzou) emitir(est.simbolo, "placar" + lim, `${C.leituraTexto(p)} (${p > 0 ? "+" : ""}${p}): ${mot.slice(0, 3).join("; ")}`, {tom: p > 0 ? "alta" : "baixa"});
  }
  M.placarAnt[est.simbolo] = p;
}
async function rodadaIndicadores() {
  const erros = [], comRsi = agoraS() - ultimoRsi > 300;
  for (const est of M.moedas.values()) { try { await atualizarMoeda(est, comRsi); } catch (e) { erros.push(`${est.simbolo}: ${e.message}`); } }
  if (comRsi && !erros.length) ultimoRsi = agoraS();
  M.status.indicadores = erros.length ? "erro: " + erros.join(" | ").slice(0, 150) : "ok";
  atualizarSinais();
}

// ------------------------------------------------------------ SOPR / ciclo
async function rodadaCiclo() {
  const erros = [];
  for (const est of M.moedas.values()) {
    try {
      const [d1, h4] = await Promise.all([http(BN.spot + "/api/v3/klines", {symbol: est.simbolo, interval: "1d", limit: 1000}),
        http(BN.spot + "/api/v3/klines", {symbol: est.simbolo, interval: "4h", limit: 1000})]);
      est.ciclo = C.analisarMoeda(d1, h4);
      if (!est.preco) est.preco = est.ciclo._diarias.at(-1).c;
      const tom = est.ciclo.resumo.tom, ant = M.tomAnt[est.simbolo];
      if (ant != null && tom !== ant && (tom === "lucro_extremo" || tom === "prejuizo_extremo"))
        emitir(est.simbolo, "sopr", `SOPR 7d entrou em ${est.ciclo.resumo.comportamento.toLowerCase()} (${C.br(est.ciclo.resumo.sopr7, 3)})`,
          {espera: 6 * 3600, tom: tom === "lucro_extremo" ? "baixa" : "alta"});
      M.tomAnt[est.simbolo] = tom;
    } catch (e) { erros.push(`${est.simbolo}: ${e.message}`); }
    await dormir(0);
  }
  const btc = M.moedas.get("BTCUSDT");
  if (btc?.ciclo) for (const [s, e] of M.moedas) if (s !== "BTCUSDT" && e.ciclo) M.forca[s] = C.forcaVsBtc(e.ciclo._diarias, btc.ciclo._diarias);
  M.sopr_atualizado = agoraS();
  M.status.sopr = erros.length ? "erro: " + erros.join(" | ").slice(0, 150) : "ok";
  atualizarSinais(true);
}

// ------------------------------------------------------------ Laboratório (histórico completo, a cada 6 h)
async function historicoCompleto(s, maximo = 3500) {
  let v = await http(BN.spot + "/api/v3/klines", {symbol: s, interval: "1d", limit: 1000});
  while (v.length && v.length < maximo) {
    const antes = await http(BN.spot + "/api/v3/klines", {symbol: s, interval: "1d", limit: 1000, endTime: +v[0][0] - 1});
    if (!antes.length) break; v = antes.concat(v); if (antes.length < 1000) break;
  }
  return v;
}
// histórico de funding (média por dia, em % por período), guardado no celular e atualizado só no pedaço novo
async function historicoFunding(s) {
  const k = "radar_fund_" + s, c = ls.get(k, null) || {dias: {}, ate: 0};
  let ini = c.ate ? (Math.floor(c.ate / 864e5) - 1) * 864e5 : Date.UTC(2019, 8, 1);
  const acum = {};
  for (let r = 0; r < 15; r++) {
    const l = await http(BN.fut + "/fapi/v1/fundingRate", {symbol: s, startTime: ini, limit: 1000});
    if (!Array.isArray(l) || !l.length) break;
    for (const f of l) { const d = Math.floor(+f.fundingTime / 864e5); (acum[d] ||= [0, 0]); acum[d][0] += +f.fundingRate * 100; acum[d][1]++; }
    c.ate = +l[l.length - 1].fundingTime; ini = c.ate + 1;
    if (l.length < 1000) break; await dormir(120);
  }
  for (const [d, [a, n]] of Object.entries(acum)) c.dias[d] = +(a / n).toFixed(5);
  if (!ls.set(k, c)) ls.del(k);
  return c.dias;
}
function salvarLab() {
  const leve = {};
  for (const [s, r] of Object.entries(M.lab)) leve[s] = r;
  if (!ls.set("radar_lab", {v: 4, ts: M.lab_atualizado, lab: leve})) ls.del("radar_lab");
}
async function rodadaLab(forcar = false) {
  const cache = ls.get("radar_lab", null);
  const simbolos = [...M.moedas.keys()];
  if (!forcar && cache && cache.v === 4 && agoraS() - cache.ts < 6 * 3600 && simbolos.every(s => cache.lab[s] && cache.lab[s].pesos)) {
    M.lab = cache.lab; M.lab_atualizado = cache.ts; M.status.lab = "ok";
  } else {
    M.status.lab = "calculando"; const erros = [], hist = {};
    const fund = {};
    for (const s of simbolos) { try { hist[s] = C.converter(await historicoCompleto(s)); } catch (e) { erros.push(`${s}: ${e.message}`); }
      if (M.moedas.get(s)?.futuros_disponivel !== false) try { fund[s] = await historicoFunding(s); } catch (e) {} }
    const btc = hist.BTCUSDT; let xb = null;
    for (const s of Object.keys(hist).sort((a, b) => (a === "BTCUSDT" ? -1 : b === "BTCUSDT" ? 1 : 0))) {
      try {
        await dormir(30);
        const r = s === "BTCUSDT" || !btc ? C.rodarLab(hist[s], null, null, fund[s], s === "BTCUSDT") : C.rodarLab(hist[s], btc, xb, fund[s], false);
        if (s === "BTCUSDT") xb = r._x;
        delete r._x; M.lab[s] = r;
      } catch (e) { erros.push(`${s}: ${e.message}`); }
    }
    M.lab_atualizado = agoraS(); salvarLab();
    M.status.lab = erros.length ? "erro: " + erros.join(" | ").slice(0, 150) : "ok";
  }
  try { M.lab_vivo = await testeAoVivo(); } catch (e) {}
  atualizarSinais(true);
}
function labDaMoeda(s) {
  const r = M.lab[s]; if (!r) return {};
  const resumo = r.sinais.map(x => { const h = x.horizontes["30"] || {};
    return {id: x.id, nome: x.nome, tipo: x.tipo, filtro_btc: x.filtro_btc, veredito: x.veredito, tom: x.tom, ativo_hoje: x.ativo_hoje,
      casos: h.casos, media30: h.media, ref30: h.ref_media, acerto30: h.acerto}; });
  return {dias_testados: r.dias_testados, inicio: r.inicio, resumo, ativos: resumo.filter(x => x.ativo_hoje)};
}

// ------------------------------------------------------------ teste ao vivo (fotos guardadas no celular)
function guardarFoto() {
  const fotos = ls.get("radar_fotos", []), t = Math.floor(agoraS());
  if (fotos.length && t - fotos[fotos.length - 1].t < 14 * 60) return;
  for (const e of M.moedas.values()) {
    if (!e.preco || !M.sinais[e.simbolo]) continue;
    fotos.push({t, s: e.simbolo, p: e.preco, pl: e.pontuacao()[0], si: M.sinais[e.simbolo].estado});
  }
  ls.set("radar_fotos", fotos.slice(-20000));
}
const FAIXAS = [["≥ +40", 40, 101], ["+15 a +40", 15, 40], ["-15 a +15", -15, 15], ["-40 a -15", -40, -15], ["≤ -40", -101, -40]];
const ORDEM_SINAIS = [["compra", "ZONA DE COMPRA"], ["perto_compra", "PERTO DE COMPRA"], ["aguardar", "AGUARDAR"], ["perto_venda", "PERTO DE REALIZAR"], ["venda", "ZONA DE VENDA / REALIZAR"]];
async function testeAoVivo() {
  const fotos = ls.get("radar_fotos", []);
  if (!fotos.length) return {dias: 0, moedas: {}};
  const dias = (fotos[fotos.length - 1].t - fotos[0].t) / 86400, out = {};
  for (const s of new Set(fotos.map(f => f.s))) {
    let velas; try { velas = await http(BN.spot + "/api/v3/klines", {symbol: s, interval: "1h", limit: 1000}); } catch (e) { continue; }
    const preco = new Map(velas.map(k => [Math.floor(+k[0] / 3600000), +k[4]]));
    const depois = (t, h) => preco.get(Math.floor(t / 3600) + h) ?? null;
    const fs = fotos.filter(f => f.s === s), res = {};
    for (const h of [24, 72]) {
      const grupos = Object.fromEntries(FAIXAS.map(f => [f[0], []]));
      for (const f of fs) { const p2 = depois(f.t, h); if (p2 == null) continue;
        const faixa = FAIXAS.find(([, lo, hi]) => lo <= f.pl && f.pl < hi); if (faixa) grupos[faixa[0]].push((p2 / f.p - 1) * 100); }
      const todas = Object.values(grupos).flat();
      res[String(h)] = {ref_media: todas.length ? C.media(todas) : null, faixas: FAIXAS.map(([n]) => ({faixa: n, n: grupos[n].length,
        horas_de_dados: grupos[n].length * 15 / 60, media: grupos[n].length ? C.media(grupos[n]) : null,
        acerto_alta: grupos[n].length ? grupos[n].filter(x => x > 0).length / grupos[n].length * 100 : null}))};
    }
    const sinal = {};
    for (const h of [24, 72, 168]) {
      const g = Object.fromEntries(ORDEM_SINAIS.map(([k]) => [k, []]));
      for (const f of fs) { const p2 = depois(f.t, h); if (p2 != null && g[f.si]) g[f.si].push((p2 / f.p - 1) * 100); }
      const todas = Object.values(g).flat();
      sinal[String(h)] = {ref_media: todas.length ? C.media(todas) : null, estados: ORDEM_SINAIS.map(([k, nome]) => ({estado: k, texto: nome,
        horas_de_dados: g[k].length * 15 / 60, media: g[k].length ? C.media(g[k]) : null,
        acerto_alta: g[k].length ? g[k].filter(x => x > 0).length / g[k].length * 100 : null}))};
    }
    res.sinal = sinal; out[s.replace("USDT", "")] = res;
  }
  return {dias, moedas: out};
}

// ------------------------------------------------------------ fontes externas
async function fonte(nome, fn) {
  try { const r = await fn(); delete M.externo.erros[nome]; M.externo.atualizado[nome] = agoraS(); return r; }
  catch (e) { M.externo.erros[nome] = e.message || String(e); return null; }
  finally { statusExterno(); }
}
function statusExterno() {
  const err = Object.keys(M.externo.erros), ok = Object.keys(M.externo.atualizado).filter(k => !err.includes(k));
  M.status.externo = !err.length ? "ok" : ok.length ? "parcial: fora do ar " + err.join(", ") : "erro: " + err.join(", ");
}
async function hlMercado(nomes) {
  const [meta, ctxs] = await hlPost({type: "metaAndAssetCtxs"}), out = {};
  meta.universe.forEach((u, i) => { if (nomes.includes(u.name)) { const c = ctxs[i], px = +c.markPx || 0;
    out[u.name] = {preco: px, funding_hora_pct: +c.funding * 100, funding_8h_pct: +c.funding * 800, oi_usd: +c.openInterest * px, volume_24h: +c.dayNtlVlm}; } });
  return out;
}
async function hlContas() {
  const cache = ls.get("radar_hl_contas", null);
  if (cache && agoraS() - cache.ts < 24 * 3600 && cache.contas?.length) return cache.contas;
  const d = await http(HL_RANKING, null, {timeout: 90000});
  const linhas = d.leaderboardRows || (Array.isArray(d) ? d : []), contas = [];
  for (const l of linhas) {
    const v = +l.accountValue || 0;
    if (v >= AJ.hl_saldo_min && l.ethAddress) contas.push({endereco: l.ethAddress, saldo: v});
  }
  contas.sort((a, b) => b.saldo - a.saldo);
  const top = contas.slice(0, AJ.hl_contas);
  ls.set("radar_hl_contas", {ts: agoraS(), contas: top});
  return top;
}
async function hlPosicoes(contas, nomes) {
  const pos = [];
  for (let i = 0; i < contas.length; i += 4) {
    await Promise.all(contas.slice(i, i + 4).map(async c => {
      let st; try { st = await hlPost({type: "clearinghouseState", user: c.endereco}); } catch (e) { return; }
      for (const ap of st.assetPositions || []) {
        const p = ap.position || {}, szi = +p.szi || 0;
        if (!nomes.includes(p.coin) || !szi) continue;
        pos.push({moeda: p.coin, lado: szi > 0 ? "long" : "short", valor: +p.positionValue || 0, entrada: +p.entryPx || null,
          liquidacao: p.liquidationPx ? +p.liquidationPx : null, alavancagem: p.leverage?.value ?? null, pnl: +p.unrealizedPnl || 0,
          conta: c.endereco.slice(0, 6) + "…" + c.endereco.slice(-4), conta_saldo: c.saldo});
      }
    }));
    await dormir(150);
  }
  return pos;
}
function resumirBaleias(pos, moeda, preco) {
  const ps = pos.filter(p => p.moeda === moeda), longs = ps.filter(p => p.lado === "long"), shorts = ps.filter(p => p.lado === "short");
  const mp = (l, k) => { const t = l.filter(p => p[k]).reduce((s, p) => s + p.valor, 0); return t ? l.filter(p => p[k]).reduce((s, p) => s + p[k] * p.valor, 0) / t : null; };
  const vl = longs.reduce((s, p) => s + p.valor, 0), vs = shorts.reduce((s, p) => s + p.valor, 0), zonas = new Map();
  if (preco) { const passo = preco * 0.01;
    for (const p of ps) if (p.liquidacao && p.liquidacao > 0.5 * preco && p.liquidacao < 1.5 * preco) {
      const k = Math.floor(p.liquidacao / passo); if (!zonas.has(k)) zonas.set(k, {preco: (k + 0.5) * passo, long: 0, short: 0}); zonas.get(k)[p.lado] += p.valor; } }
  const zl = [...zonas.values()].sort((a, b) => b.long + b.short - a.long - a.short).slice(0, 8).sort((a, b) => b.preco - a.preco);
  return {n_long: longs.length, n_short: shorts.length, valor_long: vl, valor_short: vs, proporcao_long: vl + vs ? vl / (vl + vs) : null,
    entrada_media_long: mp(longs, "entrada"), entrada_media_short: mp(shorts, "entrada"),
    pnl_long: longs.reduce((s, p) => s + p.pnl, 0), pnl_short: shorts.reduce((s, p) => s + p.pnl, 0),
    maiores: [...ps].sort((a, b) => b.valor - a.valor).slice(0, 10), zonas_liquidacao: zl};
}
async function rodadaHyperliquid() {
  if (!AJ.hyperliquid) return;
  const nomes = [...M.moedas.keys()].map(nomeHL);
  const mk = await fonte("hyperliquid", () => hlMercado(nomes)); if (mk) M.externo.hl_mercado = mk;
  const contas = await fonte("ranking hyperliquid", hlContas);
  if (contas?.length) {
    const pos = await fonte("baleias hyperliquid", () => hlPosicoes(contas, nomes));
    if (pos) for (const [s, est] of M.moedas) {
      const n = nomeHL(s), preco = est.preco || M.externo.hl_mercado[n]?.preco || 0, r = resumirBaleias(pos, n, preco);
      r.contas_analisadas = contas.length; M.externo.baleias_hl[n] = r; est.hl_proporcao_long = r.proporcao_long;
      const liq = r.valor_long - r.valor_short, ant = M.hlAnt[n];
      if (ant != null && Math.abs(liq - ant) >= est.trade_grande_usd * 4) { const dif = liq - ant;
        emitir(s, "hl_baleias", `Baleias da Hyperliquid ${dif > 0 ? "aumentaram a posição comprada" : "aumentaram a posição vendida"} em ${C.fmtUsd(Math.abs(dif))} (líquido agora ${C.fmtUsd(liq)})`,
          {espera: 1800, tom: dif > 0 ? "alta" : "baixa"}); }
      M.hlAnt[n] = liq;
    }
  }
}
async function rodadaMercadoGlobal() {
  const cb = await fonte("coinbase", async () => {
    const velas = async prod => { const r = await http(`https://api.exchange.coinbase.com/products/${prod}/candles`, {granularity: 3600});
      return new Map(r.map(v => [+v[0], +v[4]])); };
    const usdt = await velas("USDT-USD"), out = {};
    for (const [m, prod] of [["BTC", "BTC-USD"], ["ETH", "ETH-USD"]]) {
      const kl = await http(BN.spot + "/api/v3/klines", {symbol: m + "USDT", interval: "1h", limit: 300}), cbv = await velas(prod);
      const bn = new Map(kl.map(k => [Math.floor(+k[0] / 1000), +k[4]])), serie = [];
      for (const t of [...cbv.keys()].sort((a, b) => a - b)) if (bn.get(t) > 0) serie.push({t, premio_pct: (cbv.get(t) / (bn.get(t) * (usdt.get(t) || 1)) - 1) * 100});
      if (serie.length) { const u = serie.slice(-24).map(s => s.premio_pct); out[m] = {atual_pct: serie.at(-1).premio_pct, media_24h_pct: C.media(u), serie}; }
    }
    return out;
  });
  if (cb) M.externo.coinbase = cb;
  const md = await fonte("medo e ganância", async () => {
    const d = (await http("https://api.alternative.me/fng/", {limit: 60})).data;
    const trad = {"Extreme Fear": "Medo extremo", Fear: "Medo", Neutral: "Neutro", Greed: "Ganância", "Extreme Greed": "Ganância extrema"};
    const serie = d.map(x => ({t: +x.timestamp, valor: +x.value})).reverse();
    return {valor: +d[0].value, texto: trad[d[0].value_classification] || d[0].value_classification, media_7d: C.media(serie.slice(-7).map(x => x.valor)), serie};
  });
  if (md) M.externo.medo = md;
  const dm = await fonte("dominância", async () => { const d = (await http("https://api.coingecko.com/api/v3/global")).data;
    return {btc_pct: d.market_cap_percentage.btc, eth_pct: d.market_cap_percentage.eth, mcap_var_24h_pct: d.market_cap_change_percentage_24h_usd}; });
  if (dm) M.externo.dominancia = dm;
}

// ------------------------------------------------------------ opções (Deribit), mapa de liquidações, stablecoins
async function rodadaOpcoes() {
  for (const moeda of ["BTC", "ETH"]) {
    if (!M.moedas.has(moeda + "USDT")) continue;
    const r = await fonte("opções " + moeda + " (Deribit)", async () => {
      const livro = (await http("https://www.deribit.com/api/v2/public/get_book_summary_by_currency", {currency: moeda, kind: "option"}, {timeout: 30000})).result;
      let dvol = null;
      try { const fim = Date.now(); dvol = (await http("https://www.deribit.com/api/v2/public/get_volatility_index_data",
        {currency: moeda, start_timestamp: fim - 9 * 864e5, end_timestamp: fim, resolution: 3600})).result?.data || null; } catch (e) {}
      const a = C.analisarOpcoes(livro, dvol); if (!a) throw new Error("sem dados de opções");
      return a;
    });
    if (r) M.externo.opcoes[moeda] = r;
  }
}
async function rodadaMapas() {
  const erros = [];
  for (const est of M.moedas.values()) {
    if (!est.futuros_disponivel) continue;
    try {
      const s = est.simbolo;
      const [oi, kl, lsr] = await Promise.all([
        http(BN.fut + "/futures/data/openInterestHist", {symbol: s, period: "1h", limit: 500}),
        http(BN.fut + "/fapi/v1/klines", {symbol: s, interval: "1h", limit: 500}),
        http(BN.fut + "/futures/data/globalLongShortAccountRatio", {symbol: s, period: "1h", limit: 500}).catch(() => [])]);
      M.mapas[s] = C.mapaLiquidacoes(oi, kl, lsr, est.preco || +kl[kl.length - 1][4]);
    } catch (e) { erros.push(est.simbolo); }
    await dormir(50);
  }
  if (erros.length) M.externo.erros["mapa de liquidações"] = "falhou: " + erros.join(", "); else { delete M.externo.erros["mapa de liquidações"]; M.externo.atualizado["mapa de liquidações"] = agoraS(); }
  statusExterno();
}
async function rodadaStable() {
  const r = await fonte("stablecoins", async () => C.analisarStablecoins((await http("https://stablecoins.llama.fi/stablecoins", {includePrices: "false"}, {timeout: 30000})).peggedAssets));
  if (r) M.externo.stable = r;
}

// ------------------------------------------------------------ sinal direto
function regimeDe(e) {
  if (!e.ciclo) return {};
  const r = e.ciclo.resumo;
  return C.regimeProvavel(e.ciclo._diarias, r.sopr7, r.limites7, e.pontuacao()[0], e.funding_pct, r.custo_curto_prazo);
}
function filtroBtcAoVivo() {
  const btc = M.moedas.get("BTCUSDT"); if (!btc) return null;
  const r = regimeDe(btc); if (r.alta == null) return null;
  const ok = r.alta >= r.baixa;
  return {ok, texto: ok ? "BTC favorável (regime não está em baixa)" : `BTC em baixa (${r.baixa}% de chance): cuidado com compras de altcoins`};
}
// ------------------------------------------------------------ placar ao vivo: cada sinal mostrado fica registrado e é conferido depois
function registrarPlacar(s, est, preco) {
  const L = ls.get("radar_placar", []), ult = [...L].reverse().find(r => r.s === s);
  if (ult && ult.e === est) return;
  L.push({s, e: est, p: preco, t: Math.floor(agoraS())}); ls.set("radar_placar", L.slice(-500));
}
function placarResumo() {
  const L = ls.get("radar_placar", []), agora = agoraS(), out = {};
  for (const r of L) {
    if (!C.ESTADOS[r.e] || r.e === "aguardar") continue;
    const e = M.moedas.get(r.s), d1 = e?.ciclo?._diarias; if (!e) continue;
    const o = out[r.s] ||= {sinais: 0, ac7: 0, av7: 0, ac30: 0, av30: 0, pendentes: 0, ultimos: []};
    const lado = C.ESTADOS[r.e].ordem > 0 ? 1 : -1; o.sinais++;
    const precoEm = t => { const c = (d1 || []).find(v => v.t >= t - 43200); return c && c.t + 86400 <= agora ? c.c : (t <= agora ? e.preco : null); };
    const r7 = r.t + 7 * 86400 <= agora ? precoEm(r.t + 7 * 86400) : null, r30 = r.t + 30 * 86400 <= agora ? precoEm(r.t + 30 * 86400) : null;
    if (r7) { o.av7++; if (lado * (r7 - r.p) > 0) o.ac7++; } else o.pendentes++;
    if (r30) { o.av30++; if (lado * (r30 - r.p) > 0) o.ac30++; }
    o.ultimos.unshift({e: r.e, p: r.p, t: r.t, r7: r7 ? (r7 / r.p - 1) * 100 : null, r30: r30 ? (r30 / r.p - 1) * 100 : null});
  }
  for (const o of Object.values(out)) o.ultimos = o.ultimos.slice(0, 8);
  return out;
}
function atualizarSinais(guardar) {
  const medo = M.externo.medo?.valor ?? null;
  for (const [s, e] of M.moedas) {
    if (!e.ciclo || !e.preco) continue;
    let novo; try { novo = C.avaliar(estadoMoeda(e), medo, s === "BTCUSDT"); } catch (err) { continue; }
    const [exib, mudou] = M.estab.aplicar(s, novo); M.sinais[s] = exib;
    if (!exib.mudando_para) try { registrarPlacar(s, exib.estado, e.preco); } catch (err) {}
    if (mudou) { const o = C.ESTADOS[novo.estado].ordem, nome = s.replace("USDT", "");
      const amigavel = {compra: `🟢 ${nome}: bom momento para comprar.`, perto_compra: `🟡 ${nome}: quase bom para comprar.`,
        aguardar: `⚪ ${nome}: voltou para "esperar".`, perto_venda: `🟠 ${nome}: bom para vender uma parte.`,
        venda: `🔴 ${nome}: hora de vender uma parte (evite comprar).`}[novo.estado] +
        (novo.referencia ? ` Preço de referência: US$ ${novo.referencia.preco.toLocaleString("pt-BR", {maximumFractionDigits: novo.referencia.preco >= 100 ? 0 : 4})}.` : "");
      emitir(s, "sinal_" + novo.estado, `Sinal direto: ${novo.texto} (compra ${novo.nota_compra} × venda ${novo.nota_venda}). ${novo.acao} Motivos: ${novo.motivos.slice(0, 3).join("; ")}`,
        {espera: 7200, importante: novo.estado !== "aguardar", tom: o > 0 ? "alta" : o < 0 ? "baixa" : "neutro", amigavel}); }
  }
  guardarFoto();
}

// ------------------------------------------------------------ estado para o painel (mesmo formato do PC)
function estadoMoeda(e, PL) {
  const [p, mot] = e.pontuacao(), pnl = e.pnl, ciclo = e.ciclo || {}, sup = ciclo.suportes || {}, n = nomeHL(e.simbolo);
  const f = M.forca[e.simbolo]; let fb = null; if (f) { const {serie, ...resto} = f; fb = resto; }
  return {
    simbolo: e.simbolo, nome: n, preco: e.preco, variacao_24h: e.variacao_24h, vwap_24h: e.vwap_24h, rsi_1h: e.rsi_1h,
    funding_pct: e.funding_pct, oi_usd: e.oi_usd, oi_var_1h_pct: e.oi_var_1h_pct, top_long_short: e.top_long_short,
    taker_buy_sell: e.taker_buy_sell, livro: e.livro_desequilibrio, parede_compra: e.parede_compra, parede_venda: e.parede_venda,
    futuros: e.futuros_disponivel, baleias_compra: e.baleias.soma("compra"), baleias_venda: e.baleias.soma("venda"),
    baleias_n_compra: e.baleias.contar("compra"), baleias_n_venda: e.baleias.contar("venda"), cvd: e.cvd, fluxo_total: e.fluxo.soma(),
    liq_long: e.liquidacoes.soma("long"), liq_short: e.liquidacoes.soma("short"), placar: p, leitura: C.leituraTexto(p), motivos: mot,
    pnl: pnl ? pnl[0] : null, pnl_pct: pnl ? pnl[1] : null, quantidade: e.quantidade, preco_medio: e.preco_medio, trade_grande_usd: e.trade_grande_usd,
    ultimas_baleias: e.ultimas_baleias.slice(0, 15).map(b => ({ts: b.ts, lado: b.lado, valor: b.valor, preco: b.preco, origem: b.origem})),
    sopr: ciclo.resumo || null, extremos: ciclo.extremos || null,
    suportes: {suportes: sup.suportes || [], resistencias: sup.resistencias || []},
    regime: regimeDe(e), lab: labDaMoeda(e.simbolo),
    hl: {mercado: M.externo.hl_mercado[n] || null, baleias: M.externo.baleias_hl[n] || null},
    forca_btc: fb, filtro_btc: e.simbolo !== "BTCUSDT" ? filtroBtcAoVivo() : null, sinal: M.sinais[e.simbolo] || null,
    condutor: e.condutor(), absorcao: e.absorcao.resumo(), paredes: e.paredesResumo(),
    pesos: M.lab[e.simbolo]?.pesos || null,
    opcoes: M.externo.opcoes[n] || null, mapa_liq: M.mapas[e.simbolo] ? {...M.mapas[e.simbolo], faixas: undefined} : null,
    stable: M.externo.stable, corretoras: e.fluxo.porCorretora(),
    rigor: M.lab[e.simbolo]?.decisao?.rigor || 0, decisao: M.lab[e.simbolo]?.decisao || null, placar_radar: PL ? PL[e.simbolo] || null : undefined,
  };
}
function conclusao(moedas) {
  const com = moedas.filter(m => m.regime && m.regime.alta != null);
  if (!com.length) return {titulo: "Coletando dados...", texto: []};
  const alta = com.filter(m => m.regime.alta >= Math.max(m.regime.lateral, m.regime.baixa)).map(m => m.nome);
  const baixa = com.filter(m => m.regime.baixa > Math.max(m.regime.lateral, m.regime.alta)).map(m => m.nome);
  const lat = com.map(m => m.nome).filter(n => !alta.includes(n) && !baixa.includes(n)), t = [];
  if (alta.length) t.push(`Viés de alta: ${alta.join(", ")}.`);
  if (lat.length) t.push(`Mais provável lateral: ${lat.join(", ")}.`);
  if (baixa.length) t.push(`Viés de baixa: ${baixa.join(", ")}.`);
  const euf = com.filter(m => m.sopr?.tom === "lucro_extremo").map(m => m.nome), cap = com.filter(m => m.sopr?.tom === "prejuizo_extremo").map(m => m.nome);
  if (euf.length) t.push(`Atenção: ${euf.join(", ")} com SOPR em lucro extremo, quando costuma haver realização.`);
  if (cap.length) t.push(`${cap.join(", ")} em capitulação (SOPR muito baixo), quando historicamente aparecem fundos locais.`);
  const ab = com.filter(m => (m.sopr?.preco_vs_custo_pct || 0) < 0).map(m => m.nome);
  if (ab.length) t.push(`Abaixo do custo médio de curto prazo (quem comprou recente está no prejuízo): ${ab.join(", ")}.`);
  const v = M.externo.medo?.valor;
  if (v != null) { if (v <= 25) t.push(`Medo e ganância em ${v} (medo extremo): historicamente zona de oportunidade, mas exige paciência.`);
    else if (v >= 75) t.push(`Medo e ganância em ${v} (ganância extrema): mercado eufórico, cuidado com compras.`); }
  const cb = M.externo.coinbase?.BTC;
  if (cb) { const pm = cb.media_24h_pct; t.push(`Prêmio da Coinbase no BTC em ${C.br(pm, 3, true)}% (média 24 h): ${pm >= 0.05 ? "demanda americana forte" : pm <= -0.05 ? "demanda americana fraca" : "sem sinal claro"}.`); }
  const med = C.media(com.map(m => m.regime.alta - m.regime.baixa));
  return {titulo: med > 15 ? "Mercado com viés comprador" : med < -15 ? "Mercado com viés vendedor" : "Mercado sem direção clara", texto: t};
}
function estado() {
  let PL = {}; try { PL = placarResumo(); } catch (e) {}
  const moedas = [...M.moedas.values()].map(e => estadoMoeda(e, PL)), {baleias_hl, hl_mercado, opcoes, ...ext} = M.externo;
  return {agora: agoraS(), status: M.status, sopr_atualizado: M.sopr_atualizado, lab_atualizado: M.lab_atualizado, externo: ext,
    sopr_proximo: M.sopr_atualizado ? M.sopr_atualizado + M.sopr_intervalo : null, janela_minutos: AJ.janela_minutos,
    moedas, conclusao: conclusao(moedas), alertas: [...M.alertas].slice(-80).reverse(), versao_celular: true};
}

// ------------------------------------------------------------ o painel chama /api/*: respondemos aqui mesmo
const fetchOriginal = window.fetch.bind(window);
window.fetch = async (url, opcoes) => {
  if (typeof url === "string" && url.startsWith("/api/")) {
    const u = new URL(url, "http://local"), s = (u.searchParams.get("simbolo") || "").toUpperCase(), e = M.moedas.get(s);
    let corpo;
    switch (u.pathname) {
      case "/api/estado": corpo = estado(); break;
      case "/api/grafico": { const tf = u.searchParams.get("tf") || "1d"; corpo = e?.ciclo?.graficos[tf] || {pontos: [], limites: {}}; break; }
      case "/api/perfil": corpo = e?.ciclo ? {faixas: e.ciclo.suportes.faixas, custo: e.ciclo.resumo.custo_curto_prazo} : {faixas: []}; break;
      case "/api/lab": corpo = {lab: M.lab[s] || null, vivo: M.lab_vivo.moedas[s.replace("USDT", "")] || null, vivo_dias: M.lab_vivo.dias || 0, atualizado: M.lab_atualizado}; break;
      case "/api/forca": corpo = {serie: M.forca[s]?.serie || []}; break;
      case "/api/mapa": corpo = M.mapas[s] || {faixas: []}; break;
      case "/api/qr": corpo = {ativo: false, itens: []}; break;
      default: corpo = {};
    }
    return new Response(JSON.stringify(corpo), {headers: {"Content-Type": "application/json"}});
  }
  return fetchOriginal(url, opcoes);
};

// ------------------------------------------------------------ laços
function laco(nome, fn, intervaloS, atrasoS = 0) {
  let proxima = Date.now() + atrasoS * 1000, rodando = false;
  const tick = async () => {
    if (rodando || Date.now() < proxima) return;
    if (document.visibilityState !== "visible") return;   // celular com a tela desligada: não gasta bateria/dados
    rodando = true;
    try { await fn(); } catch (e) { console.warn(nome, e); }
    finally { rodando = false; proxima = Date.now() + (typeof intervaloS === "function" ? intervaloS() : intervaloS) * 1000; }
  };
  setInterval(tick, 1000); tick();
  return {agora() { proxima = 0; tick(); }};
}
let lacos = {};
async function iniciar() {
  criarMoedas();
  try { await verificarSimbolos(); }
  catch (e) { M.status.indicadores = "erro: " + e.message; setTimeout(iniciar, 15000); return; }
  ligarFluxo();
  lacos.indicadores = laco("indicadores", rodadaIndicadores, () => AJ.intervalo_indicadores);
  lacos.ciclo = laco("ciclo", rodadaCiclo, 3600);
  lacos.lab = laco("lab", () => (M.sopr_atualizado ? rodadaLab() : Promise.resolve()), () => (M.lab_atualizado ? 6 * 3600 : 5), 3);
  lacos.hl = laco("hyperliquid", rodadaHyperliquid, 600, 4);
  lacos.global = laco("mercado global", rodadaMercadoGlobal, 3600, 2);
  lacos.opcoes = laco("opções", rodadaOpcoes, 1800, 5);
  lacos.mapas = laco("mapa de liquidações", rodadaMapas, 3600, 6);
  lacos.stable = laco("stablecoins", rodadaStable, 6 * 3600, 3);
}
let timerPausa = null;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    // saiu do app: em 20 s desliga a conexão ao vivo para não gastar bateria nem internet
    clearTimeout(timerPausa);
    timerPausa = setTimeout(() => { if (document.visibilityState === "hidden") { M.pausado = true; desligarFluxo(); } }, 20000);
    return;
  }
  clearTimeout(timerPausa);
  if (M.pausado) { M.pausado = false; M.ws.spot_espera = M.ws.futuros_espera = 2000; }
  if (document.visibilityState === "visible") {
    // voltou para o app: reconecta e atualiza o que estiver velho
    ligarFluxo();
    if (agoraS() - M.sopr_atualizado > 3600) lacos.ciclo?.agora();
    lacos.indicadores?.agora();
  }
});

// ------------------------------------------------------------ ajustes (usado pela aba Ajustes)
window.Radar = {
  ajustes: () => JSON.parse(JSON.stringify(AJ)), padrao: () => JSON.parse(JSON.stringify(PADRAO)),
  salvar(novo) { Object.assign(AJ, novo); ls.set("radar_ajustes", AJ); location.reload(); },
  limparCache() { for (const k of ["radar_lab", "radar_hl_contas"]) ls.del(k); location.reload(); },
  limparTudo() { try { localStorage.clear(); } catch (e) {} location.reload(); },
  async pedirNotificacao() {
    if (!("Notification" in window)) return "sem_suporte";
    const r = await Notification.requestPermission();
    if (r === "granted") { AJ.notificacoes = true; ls.set("radar_ajustes", AJ); bipe(); notificar("Radar das Baleias", "Notificações ligadas ✔"); }
    return r;
  },
  recalcularLab() { rodadaLab(true); },
  fotos: () => ls.get("radar_fotos", []).length,
};
iniciar();
})();
