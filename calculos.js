/* =====================================================================
   RADAR DAS BALEIAS — CÁLCULOS (versão para navegador)
   Tradução fiel de analise.py, sopr.py, laboratorio.py e decisao.py.
   Funciona no navegador e no Node (para testes).
   ===================================================================== */
(function (raiz) {
"use strict";

// ------------------------------------------------------------ utilidades
function pyRound(x) {             // arredondamento igual ao Python (meio para o par)
  const f = Math.floor(x), d = x - f;
  if (Math.abs(d - 0.5) < 1e-12) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
function br(v, casas = 1, sinal = false) {
  const s = Math.abs(v).toLocaleString("pt-BR", {minimumFractionDigits: casas, maximumFractionDigits: casas});
  return (v < 0 ? "-" : sinal ? "+" : "") + s;
}
function fmtUsd(v) {
  if (v == null) return "-";
  const s = v < 0 ? "-" : "", a = Math.abs(v);
  if (a >= 1e9) return `${s}$${br(a / 1e9, 2)}B`;
  if (a >= 1e6) return `${s}$${br(a / 1e6, 2)}M`;
  if (a >= 1e3) return `${s}$${br(a / 1e3, 1)}k`;
  return `${s}$${br(a, 2)}`;
}
function fmtPreco(v) {
  if (v >= 1000) return Math.round(v).toLocaleString("pt-BR");
  if (v >= 1) return v.toFixed(3).replace(".", ",");
  return v.toFixed(5).replace(".", ",");
}
const media = a => a.reduce((x, y) => x + y, 0) / a.length;
function mediana(a) { const v = [...a].sort((x, y) => x - y), n = v.length;
  return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2; }
const lim01 = x => Math.max(0, Math.min(1, x));

// ------------------------------------------------------------ fluxo ao vivo
class Janela {   // eventos dos últimos N segundos com somas mantidas incrementalmente
  constructor(seg) { this.seg = seg; this.ev = []; this.ini = 0; this.s = {}; this.n = {}; }
  _mexe(e, sinal) {
    const k = e.lado + "|" + e.origem + "|" + (e.corretora || "binance");
    this.s[k] = (this.s[k] || 0) + sinal * e.valor;
    this.n[e.lado] = (this.n[e.lado] || 0) + sinal;
  }
  add(e) { this.ev.push(e); this._mexe(e, 1); this.limpar(e.ts); }
  limpar(agora) {
    const lim = (agora ?? Date.now() / 1000) - this.seg;
    while (this.ini < this.ev.length && this.ev[this.ini].ts < lim) this._mexe(this.ev[this.ini++], -1);
    if (this.ini > 5000 && this.ini > this.ev.length / 2) { this.ev = this.ev.slice(this.ini); this.ini = 0; }
  }
  soma(lado, origem, corretora) {
    this.limpar(Math.max(Date.now() / 1000, this.ev.length ? this.ev[this.ev.length - 1].ts : 0));
    let t = 0;
    for (const [k, v] of Object.entries(this.s)) {
      const [l, o, c] = k.split("|");
      if ((lado == null || l === lado) && (origem == null || o === origem) && (corretora == null || c === corretora)) t += v;
    }
    return Math.max(0, t);
  }
  porCorretora() {
    this.soma(); const out = {};
    for (const [k, v] of Object.entries(this.s)) { const [l, , c] = k.split("|"); out[c] = out[c] || {compra: 0, venda: 0}; out[c][l] += Math.max(0, v); }
    return out;
  }
  contar(lado) { this.soma(); return lado == null ? Object.values(this.n).reduce((a, b) => a + b, 0) : (this.n[lado] || 0); }
}

// Absorção: muita agressão de um lado num minuto, mas o preço não anda.
// Ex.: vendas fortes e o preço não cai = alguém grande comprando com ordens escondidas (acumulação).
class Absorcao {
  constructor(seg) { this.seg = seg; this.atual = null; this.hist = []; this.eventos = []; }
  add(ts, preco, valor, lado) {
    const m = Math.floor(ts / 60);
    if (!this.atual || this.atual.m !== m) { if (this.atual && m > this.atual.m) this._fechar(this.atual); if (!this.atual || m > this.atual.m) this.atual = {m, o: preco, c: preco, compra: 0, venda: 0}; }
    if (m < this.atual.m) return;              // negócio atrasado: ignora
    this.atual.c = preco; this.atual[lado] += valor;
  }
  _fechar(b) {
    const vol = b.compra + b.venda;
    const ant = this.hist.slice(-60).map(x => x.vol).sort((a, c) => a - c);
    this.hist.push({m: b.m, vol}); if (this.hist.length > 180) this.hist.shift();
    if (ant.length < 20 || !b.o) return;
    const med = ant[Math.floor(ant.length / 2)];
    if (!(vol >= 2.5 * med && vol > 0)) return;
    const liq = (b.compra - b.venda) / vol, mov = (b.c - b.o) / b.o;
    let tipo = null;
    if (liq <= -0.4 && mov >= -0.0005) tipo = "vendas_absorvidas";       // vendedores batendo e o preço segurando = comprador escondido
    else if (liq >= 0.4 && mov <= 0.0005) tipo = "compras_absorvidas";   // compradores batendo e o preço travado = vendedor escondido
    if (tipo) this.eventos.push({ts: b.m * 60 + 60, tipo, valor: tipo === "vendas_absorvidas" ? b.venda : b.compra, preco: b.c, vezes_normal: vol / med});
  }
  resumo(agora) {
    const lim = (agora ?? Date.now() / 1000) - this.seg;
    this.eventos = this.eventos.filter(e => e.ts >= lim);
    const va = this.eventos.filter(e => e.tipo === "vendas_absorvidas"), ca = this.eventos.filter(e => e.tipo === "compras_absorvidas");
    let leitura = null, tom = "neutro";
    if (va.length > ca.length) { leitura = `vendas fortes sendo absorvidas sem derrubar o preço (${va.length}x na última hora): comprador grande escondido`; tom = "alta"; }
    else if (ca.length > va.length) { leitura = `compras fortes sendo absorvidas sem subir o preço (${ca.length}x na última hora): vendedor grande escondido`; tom = "baixa"; }
    return {pronto: this.hist.length >= 20, n_vendas_absorvidas: va.length, n_compras_absorvidas: ca.length, saldo: va.length - ca.length, leitura, tom,
      eventos: this.eventos.slice(-8).reverse()};
  }
}

class EstadoMoeda {
  constructor({simbolo, quantidade = 0, preco_medio = 0, trade_grande_usd = 100000, janela_seg = 3600}) {
    Object.assign(this, {simbolo, quantidade, preco_medio, trade_grande_usd, janela_seg});
    this.preco = 0; this.variacao_24h = 0; this.vwap_24h = 0; this.rsi_1h = null;
    this.funding_pct = null; this.oi_usd = null; this.oi_var_1h_pct = null;
    this.top_long_short = null; this.taker_buy_sell = null; this.livro_desequilibrio = null;
    this.parede_compra = null; this.parede_venda = null; this.futuros_disponivel = true;
    this.hl_proporcao_long = null;
    this.fluxo = new Janela(janela_seg); this.baleias = new Janela(janela_seg); this.liquidacoes = new Janela(janela_seg);
    this.ultimas_baleias = []; this.ciclo = null;
    this.precos = [];                         // amostras de preço (a cada 20 s) para saber a variação na janela
    this.absorcao = new Absorcao(janela_seg);
    this.paredes = new Map();                 // paredes do livro acompanhadas entre leituras (anti-paredes falsas)
    this.paredes_sumidas = [];                // paredes grandes que sumiram rápido (suspeitas)
    this.leituras_livro = 0;
  }
  registrarTrade(preco, qtd, vendedorAgressor, origem, ts, corretora = "binance") {
    ts = ts || Date.now() / 1000;
    const ev = {ts, valor: preco * qtd, lado: vendedorAgressor ? "venda" : "compra", origem, preco, corretora};
    this.fluxo.add(ev);
    if (corretora !== "binance") {             // outras corretoras: entram no fluxo e nas baleias, não no preço
      if (ev.valor >= this.trade_grande_usd) { this.baleias.add(ev); this.ultimas_baleias.unshift(ev); if (this.ultimas_baleias.length > 25) this.ultimas_baleias.pop(); return ev; }
      return null;
    }
    if (origem === "spot") {
      this.preco = preco;
      const u = this.precos[this.precos.length - 1];
      if (!u || ts - u.ts >= 20) { this.precos.push({ts, p: preco}); while (this.precos.length && this.precos[0].ts < ts - this.janela_seg - 60) this.precos.shift(); }
    }
    this.absorcao.add(ts, preco, ev.valor, ev.lado);
    if (ev.valor >= this.trade_grande_usd) {
      this.baleias.add(ev); this.ultimas_baleias.unshift(ev);
      if (this.ultimas_baleias.length > 25) this.ultimas_baleias.pop();
      return ev;
    }
    return null;
  }
  registrarLiquidacao(preco, qtd, ladoOrdem, ts) {
    const ev = {ts: ts || Date.now() / 1000, valor: preco * qtd, lado: ladoOrdem.toUpperCase() === "SELL" ? "long" : "short", origem: "futuros"};
    this.liquidacoes.add(ev); return ev;
  }
  atualizarLivro(bids, asks, faixaPct, ts) {
    if (!bids?.length || !asks?.length) return;
    ts = ts || Date.now() / 1000;
    let b = bids.map(([p, q]) => [+p, +q]), a = asks.map(([p, q]) => [+p, +q]);
    const meio = (b[0][0] + a[0][0]) / 2;
    b = b.filter(([p]) => p >= meio * (1 - faixaPct / 100));
    a = a.filter(([p]) => p <= meio * (1 + faixaPct / 100));
    this.leituras_livro++;
    // 1) candidatas a parede: níveis com valor >= 4x a mediana dos níveis
    const valores = [...b, ...a].map(([p, q]) => p * q).sort((x, y) => x - y);
    const med = valores[Math.floor(valores.length / 2)] || 0, corte = med * 4;
    const passo = meio * 0.001, vistas = new Set();
    const marcar = (lista, lado) => { for (const [p, q] of lista) { const v = p * q; if (v < corte) continue;
      const k = lado + ":" + Math.round(p / passo), w = this.paredes.get(k);
      if (w) { w.vistas = w.ultima_leitura === this.leituras_livro - 1 ? w.vistas + 1 : 1; w.valor = v; w.preco = p; }
      else this.paredes.set(k, {lado, preco: p, valor: v, vistas: 1, desde: ts});
      const ww = this.paredes.get(k); ww.ultima_leitura = this.leituras_livro; ww.ts = ts; vistas.add(k); } };
    marcar(b, "compra"); marcar(a, "venda");
    // 2) paredes que sumiram: se ficaram pouco tempo e o preço nem chegou nelas, eram suspeitas
    for (const [k, w] of this.paredes) {
      if (vistas.has(k)) continue;
      const tocou = w.lado === "compra" ? meio <= w.preco * 1.001 : meio >= w.preco * 0.999;
      if (w.vistas <= 2 && !tocou) this.paredes_sumidas.push({ts, lado: w.lado, preco: w.preco, valor: w.valor});
      this.paredes.delete(k);
    }
    this.paredes_sumidas = this.paredes_sumidas.filter(x => x.ts >= ts - this.janela_seg);
    // 3) desequilíbrio do livro sem contar paredes ainda não confirmadas (podem ser falsas)
    const novas = new Set([...this.paredes.values()].filter(w => w.vistas < 3).map(w => w.lado + ":" + Math.round(w.preco / passo)));
    const soma = (l, lado) => l.reduce((t, [p, q]) => t + (novas.has(lado + ":" + Math.round(p / passo)) ? 0 : p * q), 0);
    const vb = soma(b, "compra"), va = soma(a, "venda");
    if (vb + va > 0) this.livro_desequilibrio = (vb - va) / (vb + va);
    // 4) paredes "reais" = vistas em 3 leituras seguidas ou mais
    const reais = lado => [...this.paredes.values()].filter(w => w.lado === lado && w.vistas >= 3).sort((x, y) => y.valor - x.valor);
    const rc = reais("compra"), rv = reais("venda");
    this.parede_compra = rc.length ? [rc[0].preco, rc[0].valor] : null;
    this.parede_venda = rv.length ? [rv[0].preco, rv[0].valor] : null;
  }
  paredesResumo() {
    const reais = [...this.paredes.values()].filter(w => w.vistas >= 3).map(w => ({lado: w.lado, preco: w.preco, valor: w.valor, minutos: Math.round((w.ts - w.desde) / 60)}));
    const sc = this.paredes_sumidas.filter(x => x.lado === "compra").length, sv = this.paredes_sumidas.filter(x => x.lado === "venda").length;
    let leitura = null;
    if (sc + sv >= 3) leitura = sv > sc ? `${sv} paredes de venda sumiram rápido (possível blefe para segurar o preço)` : sc > sv ? `${sc} paredes de compra sumiram rápido (possível blefe para atrair compradores)` : `${sc + sv} paredes grandes sumiram rápido (livro com blefes)`;
    return {reais: reais.sort((x, y) => y.valor - x.valor).slice(0, 6), sumidas_compra: sc, sumidas_venda: sv, leitura, aquecendo: this.leituras_livro < 3};
  }
  // Quem está puxando o preço: compras/vendas à vista (spot) ou especulação (futuros)?
  condutor() {
    const g = (l, o) => this.fluxo.soma(l, o);
    const cs = g("compra", "spot"), vs = g("venda", "spot"), cf = g("compra", "futuros"), vf = g("venda", "futuros");
    const volS = cs + vs, volF = cf + vf;
    if (this.fluxo.contar() < 150 || !this.precos.length || !this.preco) return {leitura: null, tom: "neutro", pontos: 0, aquecendo: true};
    const rs = volS ? (cs - vs) / volS : 0, rf = volF ? (cf - vf) / volF : 0;
    const vr = (this.preco / this.precos[0].p - 1) * 100;
    let leitura = "sem um lado dominante", tom = "neutro", pontos = 0, tipo = "neutro";
    if (vr >= 0.3) {
      if (rs >= 0.05 && rs >= rf - 0.05) [leitura, tom, pontos, tipo] = ["alta puxada por compras à vista (mais sustentável)", "alta", 10, "alta_saudavel"];
      else if (rf > 0.05 && rs < 0.02) [leitura, tom, pontos, tipo] = ["alta puxada pela especulação nos futuros (frágil)", "alerta", -5, "alta_fragil"];
      else leitura = "alta sem um lado dominante";
    } else if (vr <= -0.3) {
      if (rs <= -0.05 && rs <= rf + 0.05) [leitura, tom, pontos, tipo] = ["queda puxada por vendas à vista (venda real)", "baixa", -10, "queda_real"];
      else if (rf < -0.05 && rs > -0.02) [leitura, tom, pontos, tipo] = ["queda puxada pelos futuros (limpeza de alavancagem, costuma passar)", "neutro", 3, "queda_futuros"];
      else leitura = "queda sem um lado dominante";
    } else {
      if (rs > 0.1 && rf < 0) [leitura, tom, pontos, tipo] = ["preço parado com compras à vista e especuladores vendendo (acumulação)", "alta", 8, "acumulacao"];
      else if (rs < -0.1 && rf > 0) [leitura, tom, pontos, tipo] = ["preço parado com vendas à vista e especuladores comprando (distribuição)", "baixa", -8, "distribuicao"];
      else leitura = "preço de lado, sem pressão clara";
    }
    return {leitura, tom, pontos, tipo, var_pct: vr, saldo_spot: rs, saldo_futuros: rf, vol_spot: volS, vol_futuros: volF};
  }
  get cvd() { return this.fluxo.soma("compra") - this.fluxo.soma("venda"); }
  get baleiasLiquido() { return this.baleias.soma("compra") - this.baleias.soma("venda"); }
  get pnl() {
    if (this.quantidade <= 0 || this.preco_medio <= 0 || this.preco <= 0) return null;
    return [(this.preco - this.preco_medio) * this.quantidade, (this.preco / this.preco_medio - 1) * 100];
  }
  pontuacao() {
    let pts = 0; const motivos = [];
    const total = this.fluxo.soma(), tb = this.baleias.soma(), cvd = this.cvd;
    if (tb > 0) { const r = this.baleiasLiquido / tb; pts += 30 * r;
      if (Math.abs(r) > 0.3) motivos.push(`baleias ${r > 0 ? "comprando" : "vendendo"} (${fmtUsd(Math.abs(this.baleiasLiquido))} líquido)`); }
    if (total > 0) { const r = cvd / total; pts += 20 * Math.max(-1, Math.min(1, r * 3));
      if (Math.abs(r) > 0.1) motivos.push(`agressão ${r > 0 ? "compradora" : "vendedora"} no fluxo`); }
    if (this.livro_desequilibrio != null) { pts += 15 * this.livro_desequilibrio;
      if (Math.abs(this.livro_desequilibrio) > 0.25) motivos.push(`livro com mais ${this.livro_desequilibrio > 0 ? "compradores" : "vendedores"} perto do preço`); }
    if (this.oi_var_1h_pct != null) { const oi = this.oi_var_1h_pct;
      if (oi > 2 && cvd > 0) { pts += 15; motivos.push(`OI subindo ${br(oi)}% com compra (dinheiro novo entrando)`); }
      else if (oi > 2 && cvd < 0) { pts -= 15; motivos.push(`OI subindo ${br(oi)}% com venda (shorts abrindo)`); }
      else if (oi < -2) motivos.push(`OI caindo ${br(oi)}% (posições sendo fechadas / realização)`); }
    if (this.funding_pct != null) {
      if (this.funding_pct > 0.03) { pts -= 10; motivos.push(`funding alto (${br(this.funding_pct, 3)}%): muita alavancagem comprada`); }
      else if (this.funding_pct < -0.01) { pts += 10; motivos.push(`funding negativo (${br(this.funding_pct, 3)}%): shorts pagando, risco de short squeeze`); } }
    if (this.top_long_short != null) {
      if (this.top_long_short > 1.5) { pts += 5; motivos.push(`maiores contas compradas (L/S ${br(this.top_long_short, 2)})`); }
      else if (this.top_long_short < 0.8) { pts -= 5; motivos.push(`maiores contas vendidas (L/S ${br(this.top_long_short, 2)})`); } }
    if (this.hl_proporcao_long != null) { const r = this.hl_proporcao_long;
      if (r >= 0.65) { pts += 10; motivos.push(`baleias da Hyperliquid ${br(r * 100, 0)}% compradas`); }
      else if (r <= 0.35) { pts -= 10; motivos.push(`baleias da Hyperliquid ${br((1 - r) * 100, 0)}% vendidas`); } }
    if (this.vwap_24h && this.preco) pts += this.preco > this.vwap_24h ? 5 : -5;
    const cd = this.condutor();
    if (cd.leitura && cd.pontos) { pts += cd.pontos; motivos.push(cd.leitura); }
    const ab = this.absorcao.resumo();
    if (ab.saldo) { pts += Math.max(-10, Math.min(10, 4 * ab.saldo)); motivos.push(ab.leitura); }
    if (this.rsi_1h != null) {
      if (this.rsi_1h > 75) { pts -= 5; motivos.push(`RSI 1h sobrecomprado (${Math.round(this.rsi_1h)})`); }
      else if (this.rsi_1h < 25) { pts += 5; motivos.push(`RSI 1h sobrevendido (${Math.round(this.rsi_1h)})`); } }
    const ll = this.liquidacoes.soma("long"), ls = this.liquidacoes.soma("short");
    if (ll + ls > 0 && Math.max(ll, ls) > 2 * Math.min(ll, ls) + 1)
      motivos.push(`${ll > ls ? "longs" : "shorts"} sendo liquidados (${fmtUsd(Math.max(ll, ls))})`);
    return [Math.max(-100, Math.min(100, pyRound(pts))), motivos];
  }
}
function leituraTexto(p) {
  if (p >= 40) return "Forte pressão compradora";
  if (p >= 15) return "Viés comprador";
  if (p > -15) return "Neutro / indefinido";
  if (p > -40) return "Viés vendedor";
  return "Forte pressão vendedora";
}
function rsi(fech, periodo = 14) {
  if (fech.length <= periodo) return null;
  const g = [], p = [];
  for (let i = 1; i < fech.length; i++) { const d = fech[i] - fech[i - 1]; g.push(Math.max(d, 0)); p.push(Math.max(-d, 0)); }
  let mg = media(g.slice(0, periodo)), mp = media(p.slice(0, periodo));
  for (let i = periodo; i < g.length; i++) { mg = (mg * (periodo - 1) + g[i]) / periodo; mp = (mp * (periodo - 1) + p[i]) / periodo; }
  return mp === 0 ? 100 : 100 - 100 / (1 + mg / mp);
}

// ------------------------------------------------------------ SOPR e ciclo
const vwap = v => (v.vol > 0 ? v.quote / v.vol : v.c);
const converter = kl => kl.map(k => ({t: Math.floor(+k[0] / 1000), o: +k[1], h: +k[2], l: +k[3], c: +k[4], vol: +k[5], quote: +k[7]}));
function agrupar(velas, tam) {
  const g = new Map();
  for (const v of velas) {
    const d = new Date(v.t * 1000);
    let ini;
    if (tam === "w") { const dia = (d.getUTCDay() + 6) % 7; ini = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia) / 1000; }
    else ini = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
    if (!g.has(ini)) g.set(ini, []);
    g.get(ini).push(v);
  }
  return [...g.entries()].sort((a, b) => a[0] - b[0]).map(([t, x]) => ({t, o: x[0].o,
    h: Math.max(...x.map(y => y.h)), l: Math.min(...x.map(y => y.l)), c: x[x.length - 1].c,
    vol: x.reduce((s, y) => s + y.vol, 0), quote: x.reduce((s, y) => s + y.quote, 0)}));
}
function soprSerie(velas, tau) {
  const decai = Math.exp(-1 / tau); let num = 0, den = 0; const out = [];
  velas.forEach((v, i) => {
    if (i < tau * 3 || den <= 0) out.push(null);
    else { const c = num / den; out.push(c > 0 ? vwap(v) / c : null); }
    num = decai * (num + vwap(v) * v.vol); den = decai * (den + v.vol);
  });
  return out;
}
function mediaPonderadaMovel(vals, pesos, n) {
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    let sp = 0, sx = 0, cnt = 0;
    for (let j = Math.max(0, i - n + 1); j <= i; j++) if (vals[j] != null) { sp += pesos[j]; sx += vals[j] * pesos[j]; cnt++; }
    out.push(cnt < n ? null : sp ? sx / sp : null);
  }
  return out;
}
function custoCurtoPrazo(velas, n) {
  const out = []; let sq = 0, sv = 0;
  velas.forEach((v, i) => {
    sq += v.quote; sv += v.vol;
    if (i >= n) { sq -= velas[i - n].quote; sv -= velas[i - n].vol; }
    out.push(i >= n - 1 && sv > 0 ? sq / sv : null);
  });
  return out;
}
function percentil(vals, p) {
  const v = vals.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = (v.length - 1) * p / 100, a = Math.floor(k), b = Math.ceil(k);
  return v[a] + (v[b] - v[a]) * (k - a);
}
function classificar(s7, lim) {
  if (s7 == null) return ["Sem dados suficientes", "neutro"];
  if (Math.abs(s7 - 1) < 0.002) return ["Equilíbrio (vendendo no custo)", "neutro"];
  if (lim.p95 && s7 >= lim.p95) return ["Lucro extremo (euforia)", "lucro_extremo"];
  if (lim.p85 && s7 >= lim.p85) return ["Realização de lucro forte", "lucro_forte"];
  if (s7 >= 1) return ["Vendendo com lucro", "lucro"];
  if (lim.p5 && s7 <= lim.p5) return ["Capitulação (prejuízo extremo)", "prejuizo_extremo"];
  return ["Vendendo com prejuízo", "prejuizo"];
}
function analisarTimeframe(velas, tau, custoN, janelaExt, suavizar = 1) {
  let s = soprSerie(velas, tau);
  if (suavizar > 1) s = mediaPonderadaMovel(s, velas.map(v => v.quote), suavizar);
  const custo = custoN ? custoCurtoPrazo(velas, custoN) : velas.map(() => null);
  const rec = s.slice(-janelaExt).filter(x => x != null);
  const lim = {p5: percentil(rec, 5), p95: percentil(rec, 95), p15: percentil(rec, 15), p85: percentil(rec, 85)};
  const pontos = velas.map((v, i) => {
    const x = s[i]; let tipo = null;
    if (x != null && lim.p95 && x >= lim.p95) tipo = "lucro_extremo";
    else if (x != null && lim.p5 && x <= lim.p5) tipo = "prejuizo_extremo";
    return {t: v.t, preco: v.c, sopr: x, custo: custo[i], extremo: tipo};
  });
  return {pontos, limites: lim};
}
function diasExtremos(velas, sopr, quantos = 6, janela = 730) {
  const base = velas.map((v, i) => [i, v, sopr[i]]).slice(-janela);
  const validos = base.filter(z => z[2] != null);
  const depois = (i, n) => (i + n < velas.length ? (velas[i + n].c / velas[i].c - 1) * 100 : null);
  const montar = l => l.map(([i, v, x]) => ({t: v.t, preco: v.c, sopr: x, ret7: depois(i, 7), ret30: depois(i, 30)}));
  const lucro = [...validos].sort((a, b) => b[2] - a[2]).slice(0, quantos);
  const prej = [...validos].sort((a, b) => a[2] - b[2]).slice(0, quantos);
  const xs = validos.map(z => z[2]), p5 = percentil(xs, 5), p95 = percentil(xs, 95);
  const med = cond => { const r = validos.filter(z => cond(z[2])).map(z => depois(z[0], 30)).filter(y => y != null);
    return r.length ? [media(r), r.length] : [null, 0]; };
  return {lucro: montar(lucro), prejuizo: montar(prej), apos_lucro_extremo: med(x => x >= p95),
    apos_prejuizo_extremo: med(x => x <= p5), apos_qualquer_dia: med(() => true)};
}
function perfilVolume(velas, preco, passoPct = 0.5, quantos = 4) {
  if (!velas.length || preco <= 0) return {suportes: [], resistencias: [], faixas: []};
  const passo = preco * passoPct / 100, f = new Map();
  for (const v of velas) {
    const a = Math.floor(v.l / passo), b = Math.floor(v.h / passo), n = b - a + 1;
    for (let k = a; k <= b; k++) f.set(k, (f.get(k) || 0) + v.quote / n);
  }
  const ks = [...f.keys()].sort((a, b) => a - b), nos = [];
  for (const k of ks) { const viz = [-2, -1, 1, 2].map(d => f.get(k + d) || 0);
    if (f.get(k) >= Math.max(...viz)) nos.push([k * passo + passo / 2, f.get(k)]); }
  let total = 0; for (const x of f.values()) total += x; total = total || 1;
  const fmt = l => l.map(([p, vol]) => ({preco: p, peso_pct: vol / total * 100, distancia_pct: (p / preco - 1) * 100})).sort((a, b) => b.preco - a.preco);
  const abaixo = nos.filter(n => n[0] < preco).sort((a, b) => b[1] - a[1]).slice(0, quantos);
  const acima = nos.filter(n => n[0] > preco).sort((a, b) => b[1] - a[1]).slice(0, quantos);
  return {suportes: fmt(abaixo), resistencias: fmt(acima),
    faixas: ks.filter(k => k * passo >= preco * 0.7 && k * passo <= preco * 1.3).map(k => ({preco: k * passo + passo / 2, volume: f.get(k)}))};
}
const sma = (v, n) => (v.length >= n ? media(v.slice(-n)) : null);
function regimeProvavel(diarias, s7, lim7, placar, funding, custo) {
  const fech = diarias.map(v => v.c);
  if (fech.length < 60) return {alta: 33, lateral: 34, baixa: 33, motivos: ["histórico curto"]};
  const preco = fech[fech.length - 1], motivos = []; let d = 0;
  const m20 = sma(fech, 20), m50 = sma(fech, 50), m50a = media(fech.slice(-60, -10));
  let tend = (preco > m20 ? 0.4 : -0.4) + (preco > m50 ? 0.3 : -0.3) + (m50 > m50a ? 0.3 : -0.3);
  d += 0.35 * tend;
  motivos.push(`preço ${preco > m50 ? "acima" : "abaixo"} da média de 50 dias, que está ${m50 > m50a ? "subindo" : "caindo"}`);
  if (s7 != null) {
    d += 0.25 * Math.max(-1, Math.min(1, (s7 - 1) / 0.03));
    if (lim7.p5 && s7 <= lim7.p5) { d += 0.15; motivos.push("SOPR em capitulação (historicamente perto de fundos)"); }
    else if (lim7.p95 && s7 >= lim7.p95) { d -= 0.15; motivos.push("SOPR em lucro extremo (historicamente perto de topos)"); }
  }
  if (custo) { d += preco > custo ? 0.15 : -0.15; motivos.push(`preço ${preco > custo ? "acima" : "abaixo"} do custo médio de curto prazo`); }
  d += 0.20 * placar / 100;
  if (Math.abs(placar) >= 15) motivos.push(`fluxo ao vivo com viés ${placar > 0 ? "comprador" : "vendedor"} (${placar >= 0 ? "+" : ""}${placar})`);
  if (funding != null) { if (funding > 0.03) d -= 0.05; else if (funding < -0.01) d += 0.05; }
  d = Math.max(-1, Math.min(1, d));
  const rets = []; for (let i = Math.max(1, fech.length - 90); i < fech.length; i++) rets.push(Math.abs(fech[i] / fech[i - 1] - 1));
  const volRec = media(rets.slice(-14)), volRef = [...rets].sort((a, b) => a - b)[Math.floor(rets.length / 2)] || 1e-9;
  const compressao = lim01(1 - (volRec / volRef - 0.6)), colado = Math.max(0, 1 - Math.abs(preco / m20 - 1) / 0.05);
  const lat = 0.15 + 0.45 * (0.5 * compressao + 0.5 * colado) * (1 - Math.abs(d));
  if (lat > 0.4) motivos.push("volatilidade baixa e preço perto da média de 20 dias (cara de lateral)");
  const a = pyRound((1 - lat) * (1 + d) / 2 * 100), b = pyRound((1 - lat) * (1 - d) / 2 * 100);
  return {alta: a, lateral: 100 - a - b, baixa: b, motivos};
}
function forcaVsBtc(alt, btc) {
  const pb = new Map(btc.map(v => [v.t, v.c]));
  const serie = alt.filter(v => pb.has(v.t) && pb.get(v.t) > 0).map(v => [v.t, v.c / pb.get(v.t)]);
  if (serie.length < 60) return null;
  const r = serie.map(x => x[1]), m50 = media(r.slice(-50)), u = r[r.length - 1];
  const vr = n => (r.length > n ? (u / r[r.length - 1 - n] - 1) * 100 : null);
  const v30 = vr(30), acima = u > m50;
  let txt, tom;
  if (acima && (v30 || 0) > 0) [txt, tom] = ["Ganhando força contra o BTC", "alta"];
  else if (!acima && (v30 || 0) < 0) [txt, tom] = ["Perdendo força contra o BTC", "baixa"];
  else [txt, tom] = ["Força igual à do BTC / indefinido", "neutro"];
  return {var7_pct: vr(7), var30_pct: v30, var90_pct: vr(90), acima_media50: acima, texto: txt, tom,
    serie: serie.slice(-365).map(([t, x]) => ({t, razao: x}))};
}
function analisarMoeda(kl1d, kl4h) {
  const d1 = converter(kl1d), h4 = converter(kl4h), sem = agrupar(d1, "w"), mes = agrupar(d1, "m");
  const diario = analisarTimeframe(d1, 3, 155, 730);
  const s1 = diario.pontos.map(p => p.sopr);
  const s7 = mediaPonderadaMovel(s1, d1.map(v => v.quote), 7);
  const rec7 = s7.slice(-730).filter(x => x != null);
  const lim7 = {p5: percentil(rec7, 5), p85: percentil(rec7, 85), p95: percentil(rec7, 95)};
  diario.pontos.forEach((p, i) => (p.sopr7 = s7[i]));
  const h4r = analisarTimeframe(h4, 18, null, 1000);
  const custoDia = new Map(diario.pontos.map(p => [Math.floor(p.t / 86400), p.custo]));
  h4r.pontos.forEach(p => (p.custo = custoDia.get(Math.floor(p.t / 86400)) ?? null));
  const semanal = analisarTimeframe(sem, 1.5, 22, 260), mensal = analisarTimeframe(mes, 1, 5, 120);
  const trs = []; for (let i = 1; i < d1.length; i++) trs.push(Math.max(d1[i].h, d1[i - 1].c) - Math.min(d1[i].l, d1[i - 1].c));
  const atr = trs.length >= 14 ? media(trs.slice(-14)) : null, ult90 = d1.slice(-90);
  const ult = arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
  const custoAtual = (() => { for (let i = diario.pontos.length - 1; i >= 0; i--) if (diario.pontos[i].custo) return diario.pontos[i].custo; return null; })();
  const s7a = ult(s7), [texto, tom] = classificar(s7a, lim7), fim = d1[d1.length - 1];
  return {
    graficos: {"4h": h4r, "1d": diario, "1w": semanal, "1M": mensal},
    resumo: {sopr7: s7a, sopr_dia: ult(s1), limites7: lim7, comportamento: texto, tom,
      custo_curto_prazo: custoAtual, preco_vs_custo_pct: custoAtual ? (fim.c / custoAtual - 1) * 100 : null,
      historico_dias: d1.length, atr14: atr, atr14_pct: atr && fim ? atr / fim.c * 100 : null,
      max90: ult90.length ? Math.max(...ult90.map(v => v.h)) : null, min90: ult90.length ? Math.min(...ult90.map(v => v.l)) : null},
    extremos: diasExtremos(d1, s1),
    suportes: perfilVolume(h4.slice(-540), fim ? fim.c : 0),
    _diarias: d1,
  };
}

// ------------------------------------------------------------ LABORATÓRIO
const HORIZONTES = [7, 30, 90], INTERVALO = 10, MIN_CASOS = 6, SORTEIOS = 3000;
function preparar(d1) {
  const n = d1.length, fech = d1.map(v => v.c);
  const s1 = soprSerie(d1, 3), s7 = mediaPonderadaMovel(s1, d1.map(v => v.quote), 7), custo = custoCurtoPrazo(d1, 155);
  const p5 = Array(n).fill(null), p95 = Array(n).fill(null), p85 = Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const j = s7.slice(Math.max(0, i - 365), i).filter(x => x != null);
    if (j.length >= 180) { j.sort((a, b) => a - b);
      const q = p => { const k = (j.length - 1) * p / 100, a = Math.floor(k), b = Math.ceil(k); return j[a] + (j[b] - j[a]) * (k - a); };
      p5[i] = q(5); p95[i] = q(95); p85[i] = q(85); }
  }
  const r = Array(n).fill(null);
  if (n > 15) {
    const g = [], p = [];
    for (let i = 1; i < n; i++) { g.push(Math.max(fech[i] - fech[i - 1], 0)); p.push(Math.max(fech[i - 1] - fech[i], 0)); }
    let mg = media(g.slice(0, 14)), mp = media(p.slice(0, 14));
    for (let i = 14; i < n - 1; i++) { mg = (mg * 13 + g[i]) / 14; mp = (mp * 13 + p[i]) / 14; r[i + 1] = mp === 0 ? 100 : 100 - 100 / (1 + mg / mp); }
  }
  const sma50 = Array(n).fill(null);
  for (let i = 49; i < n; i++) sma50[i] = media(fech.slice(i - 49, i + 1));
  const regime = Array(n).fill(null);
  for (let i = 90; i < n; i++) if (s7[i] != null && custo[i] != null)
    regime[i] = regimeProvavel(d1.slice(Math.max(0, i - 120), i + 1), s7[i], {p5: p5[i], p95: p95[i]}, 0, null, custo[i]);
  return {d1, fech, s7, custo, p5, p95, p85, rsi: r, sma50, regime};
}
const um = n => Array(n).fill(1);
const cruzouAcima = (a, b, i) => i > 0 && a[i] != null && a[i - 1] != null && b[i] != null && b[i - 1] != null && a[i - 1] < b[i - 1] && a[i] >= b[i];
const cruzouAbaixo = (a, b, i) => i > 0 && a[i] != null && a[i - 1] != null && b[i] != null && b[i - 1] != null && a[i - 1] >= b[i - 1] && a[i] < b[i];
const SINAIS = [
  {id: "cap", tipo: "compra", nome: "Capitulação no SOPR", desc: "SOPR 7d no nível de prejuízo extremo (5% mais baixos do último ano): quem comprou recente está vendendo em desespero.",
    f: (x, i) => x.s7[i] != null && x.p5[i] != null && x.s7[i] <= x.p5[i]},
  {id: "cap_custo", tipo: "compra", nome: "Capitulação + abaixo do custo", desc: "Capitulação no SOPR com o preço abaixo do custo médio de curto prazo.",
    f: (x, i) => x.s7[i] != null && x.p5[i] != null && x.s7[i] <= x.p5[i] && x.custo[i] != null && x.fech[i] < x.custo[i]},
  {id: "sopr_volta", tipo: "compra", nome: "SOPR volta acima de 1", desc: "O SOPR 7d estava abaixo de 1 e voltou para cima: vendedores pararam de realizar prejuízo.",
    f: (x, i) => cruzouAcima(x.s7, x._um || (x._um = um(x.s7.length)), i)},
  {id: "recupera_custo", tipo: "compra", nome: "Preço recupera o custo de curto prazo", desc: "O preço fecha o dia de volta acima do custo médio de quem comprou nos últimos 155 dias.",
    f: (x, i) => cruzouAcima(x.fech, x.custo, i)},
  {id: "reteste_custo", tipo: "compra", nome: "Reteste do custo em tendência de alta", desc: "Média de 50 dias subindo, mínima do dia encosta no custo de curto prazo (até 1% acima) e o fechamento fica acima dele.",
    f: (x, i) => i >= 10 && x.custo[i] != null && x.sma50[i] != null && x.sma50[i - 10] != null && x.sma50[i] > x.sma50[i - 10] && x.d1[i].l <= x.custo[i] * 1.01 && x.fech[i] > x.custo[i]},
  {id: "rsi_baixo", tipo: "compra", nome: "RSI diário sobrevendido (< 30)", desc: "Indicador clássico de queda exagerada no curto prazo.",
    f: (x, i) => x.rsi[i] != null && x.rsi[i] < 30},
  {id: "regime_alta", tipo: "compra", nome: "Regime de alta dominante", desc: "O regime provável (sem o fluxo ao vivo) passa a ter 50% ou mais de alta.",
    f: (x, i) => x.regime[i] != null && x.regime[i].alta >= 50},
  {id: "euforia", tipo: "venda", nome: "Lucro extremo no SOPR", desc: "SOPR 7d no nível de lucro extremo (5% mais altos do último ano): muita gente realizando lucro.",
    f: (x, i) => x.s7[i] != null && x.p95[i] != null && x.s7[i] >= x.p95[i]},
  {id: "sopr_perde", tipo: "venda", nome: "SOPR perde 1", desc: "O SOPR 7d estava acima de 1 e caiu para baixo: compradores recentes começam a vender no prejuízo.",
    f: (x, i) => cruzouAbaixo(x.s7, x._um || (x._um = um(x.s7.length)), i)},
  {id: "perde_custo", tipo: "venda", nome: "Preço perde o custo de curto prazo", desc: "O preço fecha o dia abaixo do custo médio de quem comprou nos últimos 155 dias.",
    f: (x, i) => cruzouAbaixo(x.fech, x.custo, i)},
  {id: "rsi_alto", tipo: "venda", nome: "RSI diário sobrecomprado (> 70)", desc: "Indicador clássico de alta exagerada no curto prazo.",
    f: (x, i) => x.rsi[i] != null && x.rsi[i] > 70},
  {id: "regime_baixa", tipo: "venda", nome: "Regime de baixa dominante", desc: "O regime provável (sem o fluxo ao vivo) passa a ter 50% ou mais de baixa.",
    f: (x, i) => x.regime[i] != null && x.regime[i].baixa >= 50},
];
function rng(semente) {   // gerador aleatório com semente (mulberry32)
  let a = semente >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function chanceDeSorte(ev, base, tipo, aleat) {
  const n = ev.length;
  if (n < 2 || base.length < n * 2) return null;
  const alvo = media(ev), idx = base.map((_, i) => i); let melhor = 0;
  for (let s = 0; s < SORTEIOS; s++) {
    let soma = 0;
    for (let k = 0; k < n; k++) { const j = k + Math.floor(aleat() * (idx.length - k)); [idx[k], idx[j]] = [idx[j], idx[k]]; soma += base[idx[k]]; }
    const m = soma / n;
    if ((tipo === "compra" && m >= alvo) || (tipo === "venda" && m <= alvo)) melhor++;
  }
  return melhor / SORTEIOS * 100;
}
function veredito(r, r90) {
  if (r.casos < MIN_CASOS || r.sorte == null) return ["Poucos casos", "neutro"];
  const v = r.vantagem, ok = r.acerto > r.acerto_ref, v90 = r90?.vantagem, consist = v90 == null || v90 > 0;
  if (v > 0 && r.sorte <= 5 && ok && consist) return ["Funcionou", "bom"];
  if (v > 0 && r.sorte <= 20) return ["Indício fraco", "fraco"];
  if (v < 0 && r.sorte >= 95) return ["Funcionou ao contrário", "ruim"];
  return ["Sem vantagem", "neutro"];
}
function avaliarSinal(x, sinal, inicio, filtro) {
  const {d1, fech} = x, n = fech.length, tipo = sinal.tipo, aleat = rng(7);
  const eventos = []; let ultimo = -1e9, ativoHoje = false;
  for (let i = inicio; i < n; i++) {
    let on = false; try { on = !!sinal.f(x, i); } catch (e) { on = false; }
    if (on && filtro) on = filtro[i];
    if (i === n - 1) ativoHoje = on;
    if (on) { if (i - ultimo >= INTERVALO) eventos.push(i); ultimo = i; }
  }
  const ret = (i, h) => (i + h < n ? (fech[i + h] / fech[i] - 1) * 100 : null);
  const pior = (i, h) => { const fim = Math.min(n - 1, i + h); if (fim <= i) return null;
    const fat = d1.slice(i + 1, fim + 1);
    return tipo === "compra" ? (Math.min(...fat.map(v => v.l)) / d1[i].c - 1) * 100 : (Math.max(...fat.map(v => v.h)) / d1[i].c - 1) * 100; };
  const res = {id: sinal.id + (filtro ? "_btc" : ""), nome: sinal.nome, desc: sinal.desc, tipo, filtro_btc: !!filtro, ativo_hoje: ativoHoje, horizontes: {}};
  for (const h of HORIZONTES) {
    const base = []; for (let i = inicio; i < n; i++) { const r = ret(i, h); if (r != null) base.push(r); }
    if (!base.length) continue;
    const ev = eventos.map(i => [i, ret(i, h)]), ok = ev.filter(e => e[1] != null).map(e => e[1]);
    const acRef = base.filter(r => (tipo === "compra" ? r > 0 : r < 0)).length / base.length * 100;
    const hz = {casos: ok.length, ref_media: media(base), acerto_ref: acRef, media: null, mediana: null, acerto: null, vantagem: null, sorte: null, pior_medio: null};
    if (ok.length) {
      hz.media = media(ok); hz.mediana = mediana(ok);
      hz.acerto = ok.filter(r => (tipo === "compra" ? r > 0 : r < 0)).length / ok.length * 100;
      const dif = hz.media - hz.ref_media; hz.vantagem = tipo === "compra" ? dif : -dif;
      hz.sorte = chanceDeSorte(ok, base, tipo, aleat);
      const ps = ev.filter(e => e[1] != null).map(e => pior(e[0], h)).filter(p => p != null);
      hz.pior_medio = ps.length ? media(ps) : null;
    }
    res.horizontes[String(h)] = hz;
  }
  const h30 = res.horizontes["30"];
  [res.veredito, res.tom] = h30 ? veredito(h30, res.horizontes["90"]) : ["Poucos casos", "neutro"];
  res.eventos = eventos.map(i => ({t: d1[i].t, preco: fech[i], r7: ret(i, 7), r30: ret(i, 30), r90: ret(i, 90)}));
  return res;
}
function inicioValido(x) { for (let i = 0; i < x.fech.length; i++) if (x.p5[i] != null && x.custo[i] != null && x.regime[i] != null) return i; return x.fech.length; }
function filtroBtc(xa, xb) {
  const m = new Map(); xb.d1.forEach((v, i) => { const r = xb.regime[i]; if (r) m.set(Math.floor(v.t / 86400), r.alta >= r.baixa); });
  return xa.d1.map(v => m.get(Math.floor(v.t / 86400)) ?? false);
}
// ------------------------------------------------------------ PESOS AJUSTADOS PELO HISTÓRICO
// Para cada fator do sinal direto que tem histórico, mede a correlação (por posição/rank)
// entre o valor do fator num dia e o retorno do preço 30 dias depois.
// Treino = primeiros 70% dos dias; teste = 30% finais (o ajuste nunca viu esse período).
// O peso só muda se o efeito aparece no treino E se confirma no teste.
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = Array(a.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const m = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = m; i = j + 1; }
  return r;
}
function spearman(x, y) {
  if (x.length < 30) return null;
  const rx = ranks(x), ry = ranks(y), mx = media(rx), my = media(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) { const a = rx[i] - mx, b = ry[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}
const NOMES_FATORES = {sopr_c: "SOPR (sinal de compra)", sopr_v: "SOPR (sinal de venda)", regime_c: "Tendência (compra)", regime_v: "Tendência (venda)",
  btc_c: "Filtro do BTC (compra)", btc_v: "BTC em baixa (venda)", forca_c: "Força contra o BTC"};
function calibrarPesos(x, xb) {
  const n = x.fech.length, H = 30, ser = {};
  for (const k of Object.keys(NOMES_FATORES)) ser[k] = Array(n).fill(null);
  let filtro = null, forcaTom = null;
  if (xb) {
    filtro = filtroBtc(x, xb);
    const pb = new Map(xb.d1.map(v => [v.t, v.c])), raz = x.d1.map(v => (pb.get(v.t) ? v.c / pb.get(v.t) : null));
    forcaTom = raz.map((r, i) => { if (r == null || i < 50) return null; const ja = raz.slice(i - 49, i + 1); if (ja.some(z => z == null)) return null;
      const m50 = media(ja), r30 = raz[i - 30]; if (r30 == null) return null; const v30 = r / r30 - 1;
      return r > m50 && v30 > 0 ? 1 : r <= m50 && v30 < 0 ? 0 : 0.5; });
  }
  for (let i = 0; i < n; i++) {
    if (x.s7[i] != null && x.p5[i] != null && x.custo[i] != null) {
      const [, tom] = classificar(x.s7[i], {p5: x.p5[i], p85: x.p85[i], p95: x.p95[i]}), pvc = x.fech[i] / x.custo[i] - 1;
      let v = ({prejuizo_extremo: 1, prejuizo: 0.5, neutro: 0.35, lucro: 0.2, lucro_forte: 0.05, lucro_extremo: 0})[tom] ?? 0.3;
      if (pvc < 0 && (tom === "prejuizo" || tom === "prejuizo_extremo")) v = Math.min(1, v + 0.2);
      ser.sopr_c[i] = v; ser.sopr_v[i] = ({lucro_extremo: 1, lucro_forte: 0.75, lucro: 0.35})[tom] ?? 0;
    }
    const r = x.regime[i];
    if (r) { ser.regime_c[i] = lim01((r.alta - r.baixa + 30) / 60); ser.regime_v[i] = lim01((r.baixa - r.alta + 30) / 60); }
    if (filtro && x.regime[i]) { ser.btc_c[i] = filtro[i] ? 1 : 0; ser.btc_v[i] = filtro[i] ? 0 : 1; }
    if (forcaTom && forcaTom[i] != null) ser.forca_c[i] = forcaTom[i];
  }
  const fut = x.fech.map((c, i) => (i + H < n ? (x.fech[i + H] / c - 1) * 100 : null));
  const out = {};
  for (const [k, serie] of Object.entries(ser)) {
    const dias = []; for (let i = 0; i < n; i++) if (serie[i] != null && fut[i] != null) dias.push(i);
    if (dias.length < 150) continue;
    const corte = Math.floor(dias.length * 0.7), tr = dias.slice(0, corte), te = dias.slice(corte);
    const sinal = k.endsWith("_v") ? -1 : 1;
    const icTr = spearman(tr.map(i => serie[i]), tr.map(i => fut[i])), icTe = spearman(te.map(i => serie[i]), te.map(i => fut[i]));
    if (icTr == null || icTe == null) continue;
    const a = sinal * icTr, b = sinal * icTe;
    let mult = 1, leitura = "mantido: sem evidência clara no histórico";
    if (a > 0.03 && b > 0) { mult = Math.min(2, 1 + 5 * a); leitura = "reforçado: funcionou no treino e se confirmou no teste"; }
    else if (a < -0.03 && b < 0) { mult = Math.max(0.25, 1 + 5 * a); leitura = "reduzido: funcionou ao contrário no treino e no teste"; }
    else if (a > 0.03 && b <= 0) leitura = "mantido: funcionou no treino mas não se confirmou no teste";
    out[k] = {nome: NOMES_FATORES[k], mult, ic_treino: a, ic_teste: b, dias_treino: tr.length, dias_teste: te.length, leitura};
  }
  return out;
}

function rodarLab(d1, d1Btc, xBtc) {
  const x = preparar(d1), ini = inicioValido(x);
  const sinais = SINAIS.map(s => avaliarSinal(x, s, ini, null));
  let xb = null;
  if (d1Btc) { xb = xBtc || preparar(d1Btc); const f = filtroBtc(x, xb);
    for (const s of SINAIS) if (s.tipo === "compra") sinais.push(avaliarSinal(x, s, ini, f)); }
  const pesos = calibrarPesos(x, xb);
  return {dias_testados: x.fech.length - ini, inicio: ini < d1.length ? d1[ini].t : null, fim: d1.length ? d1[d1.length - 1].t : null,
    sinais, pesos, precos: d1.slice(ini).map(v => ({t: v.t, preco: v.c})), _x: x};
}

// ------------------------------------------------------------ OPÇÕES (Deribit, BTC e ETH)
const MESES_DERIBIT = {JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11};
function analisarOpcoes(livro, dvol, agoraMs) {
  agoraMs = agoraMs || Date.now();
  const ops = [];
  for (const o of livro || []) {
    const m = /^[A-Z]+-(\d{1,2})([A-Z]{3})(\d{2})-([\d.]+)-([CP])$/.exec(o.instrument_name || ""); if (!m) continue;
    const venc = Date.UTC(2000 + +m[3], MESES_DERIBIT[m[2]], +m[1], 8);
    ops.push({venc, strike: +m[4], tipo: m[5], oi: +o.open_interest || 0, iv: o.mark_iv != null ? +o.mark_iv : null, und: +o.underlying_price || null});
  }
  if (!ops.length) return null;
  const preco = ops.find(o => o.und)?.und;
  const oiC = ops.filter(o => o.tipo === "C").reduce((s, o) => s + o.oi, 0), oiP = ops.filter(o => o.tipo === "P").reduce((s, o) => s + o.oi, 0);
  // vencimento principal: o de maior interesse em aberto entre 2 e 45 dias
  const porVenc = new Map(); for (const o of ops) porVenc.set(o.venc, (porVenc.get(o.venc) || 0) + o.oi);
  const cand = [...porVenc.entries()].filter(([v]) => v - agoraMs > 2 * 864e5 && v - agoraMs < 45 * 864e5);
  const venc = (cand.length ? cand : [...porVenc.entries()].filter(([v]) => v > agoraMs)).sort((a, b) => b[1] - a[1])[0]?.[0];
  let maxDor = null, skew = null, dias = null;
  if (venc) {
    dias = (venc - agoraMs) / 864e5;
    const ov = ops.filter(o => o.venc === venc), ks = [...new Set(ov.map(o => o.strike))].sort((a, b) => a - b);
    let melhor = Infinity;
    for (const K of ks) {   // preço em que os compradores de opções perdem mais (e os vendedores ganham mais)
      const dor = ov.reduce((s, o) => s + o.oi * (o.tipo === "C" ? Math.max(0, K - o.strike) : Math.max(0, o.strike - K)), 0);
      if (dor < melhor) { melhor = dor; maxDor = K; }
    }
    if (preco) {
      const ivs = (tipo, a, b) => ov.filter(o => o.tipo === tipo && o.iv != null && o.strike >= preco * a && o.strike <= preco * b).map(o => o.iv);
      const pu = ivs("P", 0.85, 0.95), ca = ivs("C", 1.05, 1.15);
      if (pu.length && ca.length) skew = media(pu) - media(ca);   // >0: proteção contra queda mais cara (medo)
    }
  }
  const pc = oiC ? oiP / oiC : null;
  let leitura = "profissionais de opções sem posição clara", tom = "neutro";
  if ((pc != null && pc > 1.1) || (skew != null && skew > 5)) [leitura, tom] = ["profissionais comprando proteção contra queda nas opções (medo)", "medo"];
  else if (pc != null && pc < 0.6 && (skew == null || skew < 0)) [leitura, tom] = ["profissionais apostando na alta nas opções (otimismo)", "otimismo"];
  const dv = dvol?.length ? dvol : null;
  return {preco, put_call: pc, oi_calls: oiC, oi_puts: oiP, vencimento: venc ? venc / 1000 : null, dias_vencimento: dias,
    max_dor: maxDor, max_dor_dist_pct: maxDor && preco ? (maxDor / preco - 1) * 100 : null, skew, leitura, tom,
    dvol: dv ? dv[dv.length - 1][4] : null, dvol_var7_pct: dv && dv.length > 168 ? (dv[dv.length - 1][4] / dv[dv.length - 169][4] - 1) * 100 : null};
}

// ------------------------------------------------------------ MAPA ESTIMADO DE LIQUIDAÇÕES (Binance futuros)
// Cada aumento do open interest numa hora = posições novas abertas naquele preço. Dividimos entre
// compradas/vendidas pela proporção de contas, espalhamos por alavancagens típicas e calculamos onde
// seriam liquidadas. Posições fechadas (OI caindo) e níveis já atingidos pelo preço saem do mapa.
const ALAVANCAGENS = [[5, 0.15], [10, 0.3], [25, 0.3], [50, 0.15], [100, 0.1]];
function mapaLiquidacoes(oiHist, velas, lsHist, precoAtual) {
  const oi = new Map(oiHist.map(x => [Math.floor(+x.timestamp / 36e5), +x.sumOpenInterestValue]));
  const ls = new Map((lsHist || []).map(x => [Math.floor(+x.timestamp / 36e5), +x.longAccount]));
  const vs = velas.map(k => ({h: Math.floor(+k[0] / 36e5), alta: +k[2], baixa: +k[3], c: +k[4]})).filter(v => oi.has(v.h));
  if (vs.length < 24 || !precoAtual) return null;
  let pos = [], aberto = 0, ant = oi.get(vs[0].h);
  for (const v of vs.slice(1)) {
    const atual = oi.get(v.h), d = atual - ant; ant = atual;
    if (d > 0) {
      const fl = ls.get(v.h) ?? 0.5;
      for (const [lev, peso] of ALAVANCAGENS) {
        pos.push({lado: "long", preco: v.c * (1 - 1 / lev + 0.005), valor: d * fl * peso});
        pos.push({lado: "short", preco: v.c * (1 + 1 / lev - 0.005), valor: d * (1 - fl) * peso});
      }
      aberto += d;
    } else if (d < 0 && aberto > 0) {
      const f = Math.max(0, 1 + d / aberto); for (const p of pos) p.valor *= f; aberto *= f;
    }
    // níveis já atingidos pelo preço: essas posições já foram liquidadas
    pos = pos.filter(p => (p.lado === "long" ? p.preco < v.baixa : p.preco > v.alta));
  }
  const passo = precoAtual * 0.005, bins = new Map();
  for (const p of pos) { if (p.preco < precoAtual * 0.75 || p.preco > precoAtual * 1.25) continue;
    const k = Math.round(p.preco / passo); if (!bins.has(k)) bins.set(k, {preco: k * passo, long: 0, short: 0}); bins.get(k)[p.lado] += p.valor; }
  const faixas = [...bins.values()].sort((a, b) => a.preco - b.preco);
  const soma = (lado, a, b) => faixas.filter(f => f.preco >= a && f.preco <= b).reduce((s, f) => s + f[lado], 0);
  const acima = soma("short", precoAtual, precoAtual * 1.05), abaixo = soma("long", precoAtual * 0.95, precoAtual);
  const maior = (lado, filtro) => faixas.filter(filtro).sort((a, b) => b[lado] - a[lado])[0];
  const imaAcima = maior("short", f => f.preco > precoAtual), imaAbaixo = maior("long", f => f.preco < precoAtual);
  const razao = acima + abaixo > 0 ? acima / (acima + abaixo) : null;
  let leitura = null, tom = "neutro";
  if (razao != null && razao >= 0.65 && imaAcima) [leitura, tom] = [`muitas apostas na queda seriam liquidadas acima, perto de ${fmtPreco(imaAcima.preco)}: o preço pode ser puxado para cima`, "alta"];
  else if (razao != null && razao <= 0.35 && imaAbaixo) [leitura, tom] = [`muitas apostas na alta seriam liquidadas abaixo, perto de ${fmtPreco(imaAbaixo.preco)}: o preço pode ser puxado para baixo`, "baixa"];
  return {faixas, acima_5pct: acima, abaixo_5pct: abaixo, razao_acima: razao, ima_acima: imaAcima?.preco ?? null, ima_abaixo: imaAbaixo?.preco ?? null,
    valor_ima_acima: imaAcima?.short ?? null, valor_ima_abaixo: imaAbaixo?.long ?? null, leitura, tom};
}

// ------------------------------------------------------------ STABLECOINS (dinheiro novo no mercado)
function analisarStablecoins(peggedAssets) {
  const alvo = (peggedAssets || []).filter(a => a.symbol === "USDT" || a.symbol === "USDC");
  if (!alvo.length) return null;
  const tot = k => alvo.reduce((s, a) => s + (+(a[k]?.peggedUSD) || 0), 0);
  const agora = tot("circulating"), sem = tot("circulatingPrevWeek"), mes = tot("circulatingPrevMonth");
  const v7 = sem ? (agora / sem - 1) * 100 : null, v30 = mes ? (agora / mes - 1) * 100 : null;
  let leitura = "dinheiro em stablecoins estável", tom = "neutro";
  if (v7 != null && v7 >= 0.3) [leitura, tom] = [`dinheiro novo entrando no mercado cripto (+${fmtUsd(agora - sem).replace("$", "US$ ")} em stablecoins na semana)`, "alta"];
  else if (v7 != null && v7 <= -0.3) [leitura, tom] = [`dinheiro saindo do mercado cripto (${fmtUsd(agora - sem).replace("$", "US$ ")} em stablecoins na semana)`, "baixa"];
  return {total: agora, var7_pct: v7, var30_pct: v30, var7_usd: agora - sem, var30_usd: agora - mes, leitura, tom,
    detalhe: alvo.map(a => ({simbolo: a.symbol, total: +a.circulating?.peggedUSD || 0, var7_pct: a.circulatingPrevWeek?.peggedUSD ? (a.circulating.peggedUSD / a.circulatingPrevWeek.peggedUSD - 1) * 100 : null}))};
}

// ------------------------------------------------------------ SINAL DIRETO
const ESTADOS = {
  compra: {texto: "ZONA DE COMPRA", tom: "compra_forte", ordem: 2},
  perto_compra: {texto: "PERTO DE COMPRA", tom: "compra", ordem: 1},
  aguardar: {texto: "AGUARDAR", tom: "neutro", ordem: 0},
  perto_venda: {texto: "PERTO DE REALIZAR", tom: "venda", ordem: -1},
  venda: {texto: "ZONA DE VENDA / REALIZAR", tom: "venda_forte", ordem: -2},
};
function niveis(m) {
  const p = m.preco || 0, s = m.sopr || {};
  let sup = ((m.suportes || {}).suportes || []).map(x => x.preco), res = ((m.suportes || {}).resistencias || []).map(x => x.preco);
  const c = s.custo_curto_prazo;
  if (c) (c < p ? sup : res).push(c);
  if (m.parede_compra) sup.push(m.parede_compra[0]);
  if (m.parede_venda) res.push(m.parede_venda[0]);
  if (s.max90) res.push(s.max90);
  return [sup.filter(x => x < p).sort((a, b) => b - a), res.filter(x => x > p).sort((a, b) => a - b), s.atr14];
}
function avaliar(m, medo, ehBtc) {
  const p = m.preco || 0, s = m.sopr || {}, r = m.regime || {}, hl = m.hl?.baleias?.proporcao_long ?? null;
  const fl = m.filtro_btc ?? null, fb = m.forca_btc, placar = m.placar || 0, ativos = m.lab?.ativos || [];
  let [sup, res, atr] = niveis(m); atr = atr || p * 0.03;
  const compra = [], venda = [], PS = m.pesos || {};
  // cada fator pode ter peso ajustado pelo histórico da moeda (Laboratório → pesos)
  const C_ = (w, v, t, k) => compra.push([w * (k && PS[k] ? PS[k].mult : 1), v, t, k]);
  const V_ = (w, v, t, k) => venda.push([w * (k && PS[k] ? PS[k].mult : 1), v, t, k]);
  const tom = s.tom, pvc = s.preco_vs_custo_pct;
  if (tom) {
    let v = ({prejuizo_extremo: 1, prejuizo: 0.5, neutro: 0.35, lucro: 0.2, lucro_forte: 0.05, lucro_extremo: 0})[tom] ?? 0.3;
    if (pvc != null && pvc < 0 && (tom === "prejuizo" || tom === "prejuizo_extremo")) v = Math.min(1, v + 0.2);
    C_(20, v, v >= 0.6 ? "SOPR em capitulação/prejuízo: vendedores desistindo" : null, "sopr_c");
    const vv = ({lucro_extremo: 1, lucro_forte: 0.75, lucro: 0.35})[tom] ?? 0;
    V_(25, vv, vv >= 0.75 ? "SOPR em realização forte/euforia" : null, "sopr_v");
  }
  const prox = d => (d <= 0.5 ? 1 : d <= 1 ? 0.6 : d <= 2 ? 0.25 : 0);
  if (p && sup.length) { const v = prox((p - sup[0]) / atr); C_(15, v, v >= 0.6 ? `preço encostado no suporte ${fmtPreco(sup[0])}` : null, "suporte_c"); }
  if (p && res.length) { const v = prox((res[0] - p) / atr); V_(15, v, v >= 0.6 ? `preço encostado na resistência ${fmtPreco(res[0])}` : null, "resistencia_v"); }
  if (r.alta != null) { const a = r.alta, b = r.baixa;
    C_(15, lim01((a - b + 30) / 60), a - b >= 20 ? "regime com viés de alta" : null, "regime_c");
    V_(15, lim01((b - a + 30) / 60), b - a >= 20 ? "regime com viés de baixa" : null, "regime_v"); }
  if (!ehBtc && fl) { C_(10, fl.ok ? 1 : 0, fl.ok ? "BTC favorável" : null, "btc_c"); V_(5, fl.ok ? 0 : 1, fl.ok ? null : "BTC em baixa", "btc_v"); }
  if (!ehBtc && fb) { const v = ({alta: 1, neutro: 0.5, baixa: 0})[fb.tom] ?? 0.5; C_(5, v, v === 1 ? "ganhando força contra o BTC" : null, "forca_c"); }
  // quem está puxando o preço (à vista x futuros)
  const cd = m.condutor;
  if (cd && cd.leitura && !cd.aquecendo) {
    const vc = ({alta_saudavel: 1, acumulacao: 1, queda_futuros: 0.6, neutro: 0.4, alta_fragil: 0.2, queda_real: 0, distribuicao: 0})[cd.tipo] ?? 0.4;
    const vv = ({alta_fragil: 0.8, distribuicao: 1, queda_real: 1, neutro: 0.3})[cd.tipo] ?? 0;
    C_(10, vc, vc >= 1 ? cd.leitura : null, "condutor_c"); V_(10, vv, vv >= 0.8 ? cd.leitura : null, "condutor_v");
  }
  // opções (só BTC e ETH): leitura contrária, como o medo e ganância
  const op = m.opcoes;
  if (op && op.tom) {
    C_(5, ({medo: 0.8, neutro: 0.4, otimismo: 0.2})[op.tom], op.tom === "medo" ? op.leitura : null, "opcoes_c");
    V_(5, ({otimismo: 0.8, neutro: 0.3, medo: 0.1})[op.tom], op.tom === "otimismo" ? op.leitura : null, "opcoes_v");
    if (op.dias_vencimento != null && op.dias_vencimento <= 7 && op.max_dor_dist_pct != null && Math.abs(op.max_dor_dist_pct) >= 3) {
      const t = `vencimento de opções em ${Math.max(1, Math.round(op.dias_vencimento))} dia(s) com "preço de máxima dor" em ${fmtPreco(op.max_dor)}`;
      if (op.max_dor_dist_pct > 0) C_(5, 1, t, "maxdor_c"); else V_(5, 1, t, "maxdor_v");
    }
  }
  // mapa de liquidações: o preço costuma ser atraído para onde há mais liquidações acumuladas
  const ml = m.mapa_liq;
  if (ml && ml.razao_acima != null) {
    C_(10, lim01((ml.razao_acima - 0.35) / 0.3), ml.tom === "alta" ? ml.leitura : null, "liq_c");
    V_(10, lim01((0.65 - ml.razao_acima) / 0.3), ml.tom === "baixa" ? ml.leitura : null, "liq_v");
  }
  // dinheiro novo entrando no mercado (stablecoins)
  const st = m.stable;
  if (st && st.var7_pct != null) {
    C_(5, lim01(0.5 + st.var7_pct), st.tom === "alta" ? st.leitura : null, "stable_c");
    V_(5, lim01(0.5 - st.var7_pct), st.tom === "baixa" ? st.leitura : null, "stable_v");
  }
  // absorção (comprador ou vendedor grande escondido)
  const ab = m.absorcao;
  if (ab && ab.pronto) {
    C_(10, ab.saldo > 0 ? Math.min(1, 0.5 + 0.25 * ab.saldo) : ab.saldo < 0 ? 0 : 0.3, ab.saldo > 0 ? ab.leitura : null, "absorcao_c");
    V_(10, ab.saldo < 0 ? Math.min(1, 0.5 - 0.25 * ab.saldo) : ab.saldo > 0 ? 0 : 0.3, ab.saldo < 0 ? ab.leitura : null, "absorcao_v");
  }
  const sp = (placar >= 0 ? "+" : "") + placar;
  compra.push([10, lim01((placar + 15) / 45), placar >= 25 ? `fluxo comprador ao vivo (${sp})` : null]);
  venda.push([10, lim01((-placar + 15) / 45), placar <= -25 ? `fluxo vendedor ao vivo (${sp})` : null]);
  if (hl != null) {
    compra.push([10, lim01((hl - 0.35) / 0.35), hl >= 0.65 ? `baleias da Hyperliquid ${Math.round(hl * 100)}% compradas` : null]);
    venda.push([10, lim01((0.65 - hl) / 0.35), hl <= 0.35 ? `baleias da Hyperliquid ${Math.round((1 - hl) * 100)}% vendidas` : null]); }
  if (m.funding_pct != null) venda.push([10, lim01((m.funding_pct - 0.01) / 0.04), m.funding_pct >= 0.04 ? "funding alto: muita alavancagem comprada" : null]);
  if (m.rsi_1h != null) venda.push([5, lim01((m.rsi_1h - 60) / 20), m.rsi_1h >= 75 ? `RSI 1h esticado (${Math.round(m.rsi_1h)})` : null]);
  const bc = ativos.filter(x => x.tipo === "compra" && (x.tom === "bom" || x.tom === "fraco"));
  const bv = ativos.filter(x => x.tipo === "venda" && (x.tom === "bom" || x.tom === "fraco"));
  compra.push([10, bc.some(x => x.tom === "bom") ? 1 : bc.length ? 0.6 : 0, bc.length ? "histórico: " + bc[0].nome : null]);
  venda.push([10, bv.some(x => x.tom === "bom") ? 1 : bv.length ? 0.6 : 0, bv.length ? "histórico: " + bv[0].nome : null]);
  if (medo != null) {
    compra.push([5, medo <= 30 ? 1 : medo <= 50 ? 0.6 : medo <= 75 ? 0.3 : 0, medo <= 30 ? `medo no mercado (${medo})` : null]);
    venda.push([5, medo >= 80 ? 1 : medo >= 70 ? 0.6 : 0, medo >= 70 ? `ganância no mercado (${medo})` : null]); }
  const pertoSup = !!(p && sup.length && (p - sup[0]) / atr <= 1), pertoRes = !!(p && res.length && (res[0] - p) / atr <= 1);
  const ancC = pertoSup || tom === "prejuizo" || tom === "prejuizo_extremo" || ativos.some(x => x.tipo === "compra" && x.tom === "bom");
  const ancV = pertoRes || tom === "lucro_forte" || tom === "lucro_extremo" || ativos.some(x => x.tipo === "venda" && x.tom === "bom");
  const nota = l => { const pe = l.reduce((s, [w, v]) => s + (v != null ? w : 0), 0);
    return pe ? pyRound(l.reduce((s, [w, v]) => s + (v != null ? w * v : 0), 0) / pe * 100) : 0; };
  const nc = nota(compra), nv = nota(venda);
  let estado, trava = null;
  if (nc >= 72 && nc - nv >= 30) { estado = ancC ? "compra" : "perto_compra"; if (!ancC) trava = "momento bom, mas o preço não está num ponto de compra (suporte/desconto)"; }
  else if (nc >= 58 && nc - nv >= 15) estado = "perto_compra";
  else if (nv >= 72 && nv - nc >= 30) { estado = ancV ? "venda" : "perto_venda"; if (!ancV) trava = "momento fraco, mas o preço não está num ponto de realização (resistência/euforia)"; }
  else if (nv >= 58 && nv - nc >= 15) estado = "perto_venda";
  else estado = "aguardar";
  if (estado === "compra" && !ehBtc && fl && !fl.ok) { estado = "perto_compra"; trava = "BTC em baixa: rebaixado de ZONA DE COMPRA"; }
  const ordem = ESTADOS[estado].ordem, lado = ordem > 0 ? compra : ordem < 0 ? venda : [];
  let motivos = [...lado].sort((a, b) => b[0] * (b[1] || 0) - a[0] * (a[1] || 0)).filter(x => x[2]).map(x => x[2]).slice(0, 4);
  if (estado === "aguardar") motivos = [Math.abs(nc - nv) < 15 ? "compra e venda equilibradas" : nc > nv ? "leve viés de compra, sem confirmação" : "leve viés de venda, sem confirmação"];
  if (trava) motivos.push(trava);
  const disp = [...compra, ...venda].filter(x => x[1] != null).length;
  const labOk = (ordem > 0 && bc.length > 0) || (ordem < 0 && bv.length > 0), dif = Math.abs(nc - nv);
  const confianca = dif >= 35 && disp >= 14 && labOk ? "alta" : dif >= 20 ? "média" : "baixa";
  let referencia = null;
  if (ordem >= 0 && sup.length) referencia = {tipo: "zona de compra", preco: sup[0]};
  else if (res.length) referencia = {tipo: "zona de realização", preco: res[0]};
  const pos = (m.quantidade || 0) > 0;
  const acao = {compra: "Condições a favor de comprar (de preferência em partes — veja a aba Plano).",
    perto_compra: "Quase lá: dá para começar com uma parte pequena ou esperar o preço chegar na zona de compra.",
    aguardar: "Sem vantagem clara agora. Melhor esperar.",
    perto_venda: pos ? "Considere realizar uma parte do lucro." : "Evite comprar agora.",
    venda: pos ? "Bom momento para realizar parte da posição." : "Evite comprar agora: risco de correção."}[estado];
  return {estado, ...ESTADOS[estado], nota_compra: nc, nota_venda: nv, motivos, confianca, referencia, acao};
}
class Estabilizador {
  constructor(n = 4) { this.n = n; this.atual = {}; this.cand = {}; }
  aplicar(s, novo) {
    const at = this.atual[s];
    if (!at) { this.atual[s] = novo; return [novo, false]; }
    if (novo.estado === at.estado) { delete this.cand[s]; this.atual[s] = novo; return [novo, false]; }
    const [c, k] = this.cand[s] || [null, 0], cont = c === novo.estado ? k + 1 : 1;
    this.cand[s] = [novo.estado, cont];
    if (cont >= this.n) { delete this.cand[s]; this.atual[s] = novo; return [novo, true]; }
    return [{...at, mudando_para: novo.texto}, false];
  }
}

const API = {pyRound, br, fmtUsd, fmtPreco, media, Janela, EstadoMoeda, leituraTexto, rsi, converter, agrupar, soprSerie,
  mediaPonderadaMovel, custoCurtoPrazo, percentil, classificar, analisarTimeframe, diasExtremos, perfilVolume, regimeProvavel,
  forcaVsBtc, analisarMoeda, preparar, calibrarPesos, analisarOpcoes, mapaLiquidacoes, analisarStablecoins, spearman, Absorcao, SINAIS, avaliarSinal, rodarLab, ESTADOS, avaliar, Estabilizador};
if (typeof module !== "undefined" && module.exports) module.exports = API;
else raiz.Calc = API;
})(typeof window !== "undefined" ? window : globalThis);
