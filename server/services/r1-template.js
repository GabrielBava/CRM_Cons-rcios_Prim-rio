'use strict';
/**
 * Modelo padrão da R1 (reunião de diagnóstico) da Vero Consórcios, em HTML.
 * Funciona sem JavaScript (só HTML e CSS): slides com rolagem, campos de anotação editáveis e impressão em PDF
 * (um slide por página). O administrador pode trocar por outro modelo em Configurações › Modelo da R1, usando os
 * mesmos campos {{...}} (lista em FIELDS).
 */
const FIELDS = [
  ['especialista_nome', 'Nome completo do especialista'],
  ['especialista_primeiro_nome', 'Primeiro nome do especialista'],
  ['especialista_cargo', 'Cargo do especialista'],
  ['especialista_telefone', 'Telefone do especialista'],
  ['especialista_whatsapp', 'WhatsApp do especialista'],
  ['especialista_whatsapp_link', 'Link wa.me do WhatsApp do especialista'],
  ['especialista_email', 'E-mail do especialista'],
  ['especialista_foto', 'Foto do especialista (endereço da imagem)'],
  ['especialista_apresentacao', 'Apresentação do especialista (Meu cadastro)'],
  ['especialista_registro', 'Registro profissional do especialista'],
  ['cliente_nome', 'Nome completo do cliente'],
  ['cliente_primeiro_nome', 'Primeiro nome do cliente'],
  ['data_reuniao', 'Data da reunião (dd/mm/aaaa)'],
  ['hora_reuniao', 'Horário da reunião'],
  ['link_reuniao', 'Link da videochamada'],
  ['empresa', 'Nome da empresa'],
  ['logo', 'Logo da empresa (fundo escuro)'],
];

const TEMPLATE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>R1 · {{cliente_nome}} · {{empresa}}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&family=Manrope:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--ink:#0D1B2A;--navy:#1B263B;--slate:#415A77;--steel:#778DA9;--mist:#E0E1DD;--steel-lt:#A9B8CB;--ok:#8CC5A2;
    --display:"Famels","Manrope","Segoe UI",sans-serif;--text:"Poppins","Segoe UI",Roboto,Arial,sans-serif}
  *{box-sizing:border-box}
  html{scroll-snap-type:y mandatory;scroll-behavior:smooth}
  body{margin:0;background:var(--ink);color:var(--mist);font-family:var(--text);font-weight:300;line-height:1.5}
  .slide{min-height:100vh;scroll-snap-align:start;padding:6vh 7vw;display:flex;flex-direction:column;justify-content:center;position:relative;
    background:radial-gradient(1200px 600px at 85% -10%,rgba(119,141,169,.18),transparent 60%),linear-gradient(180deg,var(--ink),#0A1622)}
  .slide:nth-child(even){background:radial-gradient(900px 500px at 0% 110%,rgba(65,90,119,.28),transparent 60%),linear-gradient(180deg,#0F1F31,var(--ink))}
  .slide .n{position:absolute;right:7vw;bottom:4vh;font-size:.75rem;letter-spacing:.2em;color:var(--steel)}
  .slide .brand{position:absolute;left:7vw;bottom:4vh;height:26px;opacity:.7}
  h1,h2,h3{font-family:var(--display);font-weight:600;margin:0 0 .4em;color:#fff;letter-spacing:.01em}
  h1{font-size:clamp(2rem,5vw,3.6rem);line-height:1.1}
  h2{font-size:clamp(1.6rem,3.4vw,2.5rem)}
  h3{font-size:1.15rem;color:var(--steel-lt)}
  .kicker{text-transform:uppercase;letter-spacing:.28em;font-size:.78rem;color:var(--steel);margin-bottom:1.2em}
  .lead{font-size:clamp(1rem,1.6vw,1.25rem);color:var(--steel-lt);max-width:62ch}
  .grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:2.2em}
  .card{background:rgba(27,38,59,.72);border:1px solid rgba(119,141,169,.22);border-radius:18px;padding:20px 22px}
  .card b{display:block;font-family:var(--display);font-size:1.05rem;color:#fff;margin-bottom:4px;font-weight:600}
  .card small{color:var(--steel-lt);font-size:.9rem}
  .num{font-family:var(--display);font-size:2rem;color:var(--steel-lt);display:block;margin-bottom:6px}
  .cover{display:grid;grid-template-columns:1.3fr 1fr;gap:6vw;align-items:center}
  .logo{height:58px;margin-bottom:5vh}
  .person{display:flex;gap:18px;align-items:center;background:rgba(27,38,59,.72);border:1px solid rgba(119,141,169,.22);border-radius:22px;padding:18px 22px}
  .person img{width:92px;height:92px;border-radius:50%;object-fit:cover;border:2px solid var(--steel)}
  .person strong{display:block;font-family:var(--display);font-size:1.25rem;color:#fff}
  .person span{display:block;color:var(--steel-lt);font-size:.92rem}
  .meta{margin-top:2.4em;display:flex;gap:28px;flex-wrap:wrap;color:var(--steel-lt);font-size:.95rem}
  .meta b{color:#fff;font-weight:500}
  ul.clean{list-style:none;padding:0;margin:1.4em 0 0}
  ul.clean li{padding:12px 0;border-bottom:1px solid rgba(119,141,169,.16);display:flex;gap:14px}
  ul.clean li::before{content:"";width:8px;height:8px;margin-top:.55em;border-radius:50%;background:var(--steel);flex:none}
  .notes{margin-top:8px;min-height:2.2em;border-bottom:1px dashed rgba(169,184,203,.45);color:#fff;outline:none;padding:4px 2px}
  .notes:empty::before{content:attr(data-ph);color:var(--slate)}
  .q{margin-top:1.6em;display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px 28px}
  .q label{font-size:.85rem;color:var(--steel-lt);text-transform:uppercase;letter-spacing:.12em}
  table{width:100%;border-collapse:collapse;margin-top:1.8em;font-size:.98rem}
  th,td{padding:12px 14px;text-align:left;border-bottom:1px solid rgba(119,141,169,.2)}
  th{font-family:var(--display);color:#fff;font-weight:600}
  td:first-child{color:var(--steel-lt)}
  .tag{display:inline-block;border:1px solid var(--steel);border-radius:999px;padding:3px 12px;font-size:.78rem;color:var(--steel-lt);margin:0 6px 6px 0}
  .disclaimer{margin-top:2em;font-size:.78rem;color:var(--steel)}
  .contact a{color:#fff;text-decoration:none;border-bottom:1px solid var(--steel)}
  .cta{display:inline-block;margin-top:1.6em;padding:12px 26px;border-radius:999px;background:var(--mist);color:var(--ink);font-weight:600;text-decoration:none}
  @media (max-width:820px){.cover{grid-template-columns:1fr}.slide{padding:8vh 6vw}}
  @media print{
    html{scroll-snap-type:none}
    body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .slide{min-height:auto;height:100vh;page-break-after:always;break-after:page}
    .notes:empty::before{content:""}
    @page{size:A4 landscape;margin:0}
  }
</style>
</head>
<body>

<section class="slide">
  <div class="cover">
    <div>
      <img class="logo" src="{{logo}}" alt="{{empresa}}">
      <div class="kicker">Reunião de diagnóstico · R1</div>
      <h1>{{cliente_primeiro_nome}}, vamos desenhar o seu próximo passo patrimonial.</h1>
      <p class="lead">Um encontro de 30 minutos para entender o seu objetivo e mostrar, com transparência, como o consórcio pode trabalhar a seu favor.</p>
      <div class="meta"><span>Cliente <b>{{cliente_nome}}</b></span><span>Data <b>{{data_reuniao}}</b></span><span>Horário <b>{{hora_reuniao}}</b></span></div>
    </div>
    <div class="person">
      <img src="{{especialista_foto}}" alt="{{especialista_nome}}">
      <div><strong>{{especialista_nome}}</strong><span>{{especialista_cargo}}</span><span>{{especialista_whatsapp}}</span><span>{{especialista_email}}</span></div>
    </div>
  </div>
  <span class="n">01</span>
</section>

<section class="slide">
  <div class="kicker">Quem somos</div>
  <h2>{{empresa}}</h2>
  <p class="lead">Somos especialistas em consórcio como ferramenta de planejamento: ajudamos pessoas e empresas a conquistar e multiplicar patrimônio sem juros, com estratégia, clareza e acompanhamento do início ao fim.</p>
  <div class="grid">
    <div class="card"><b>Planejamento antes do produto</b><small>Primeiro entendemos o seu objetivo; depois escolhemos a administradora, o plano e a estratégia.</small></div>
    <div class="card"><b>Transparência</b><small>Custos, prazos e regras de contemplação explicados com números, sem promessas.</small></div>
    <div class="card"><b>Acompanhamento</b><small>Do diagnóstico à contemplação: estratégia de lance, assembleias e uso do crédito.</small></div>
  </div>
  <img class="brand" src="{{logo}}" alt=""><span class="n">02</span>
</section>

<section class="slide">
  <div class="kicker">Nossa conversa de hoje</div>
  <h2>Agenda da reunião</h2>
  <div class="grid">
    <div class="card"><span class="num">1</span><b>Você e o seu objetivo</b><small>O que quer conquistar, em quanto tempo e com qual parcela.</small></div>
    <div class="card"><span class="num">2</span><b>Como o consórcio funciona</b><small>Grupos, assembleias, contemplação e custos.</small></div>
    <div class="card"><span class="num">3</span><b>A estratégia para você</b><small>Aquisição planejada ou alavancagem patrimonial.</small></div>
    <div class="card"><span class="num">4</span><b>Próximos passos</b><small>Proposta personalizada e apresentação.</small></div>
  </div>
  <img class="brand" src="{{logo}}" alt=""><span class="n">03</span>
</section>

<section class="slide">
  <div class="kicker">Diagnóstico</div>
  <h2>Conte para a gente, {{cliente_primeiro_nome}}</h2>
  <p class="lead">Anotações da reunião (clique para escrever):</p>
  <div class="q">
    <div><label>Objetivo (o que deseja conquistar)</label><div class="notes" contenteditable="true" data-ph="Ex.: imóvel para morar, investimento, troca de veículo…"></div></div>
    <div><label>Crédito desejado</label><div class="notes" contenteditable="true" data-ph="R$"></div></div>
    <div><label>Prazo (quando quer o crédito)</label><div class="notes" contenteditable="true" data-ph="Curto (até 3 meses), médio ou longo prazo"></div></div>
    <div><label>Parcela confortável</label><div class="notes" contenteditable="true" data-ph="R$ por mês"></div></div>
    <div><label>Recursos para lance</label><div class="notes" contenteditable="true" data-ph="Reserva, FGTS, outro bem"></div></div>
    <div><label>Quem decide junto</label><div class="notes" contenteditable="true" data-ph="Sozinho, cônjuge, sócio…"></div></div>
    <div><label>Já teve consórcio ou financiamento?</label><div class="notes" contenteditable="true" data-ph="Administradora, valor, experiência"></div></div>
    <div><label>Paga aluguel? Tem imóvel livre de ônus?</label><div class="notes" contenteditable="true" data-ph="Valor do aluguel, imóvel próprio"></div></div>
  </div>
  <img class="brand" src="{{logo}}" alt=""><span class="n">04</span>
</section>

<section class="slide">
  <div class="kicker">Como funciona</div>
  <h2>O que é o consórcio</h2>
  <p class="lead">Um grupo de pessoas com o mesmo objetivo se une para formar uma poupança coletiva. Todo mês, o fundo do grupo contempla participantes com a carta de crédito, por sorteio ou por lance, até que todos sejam contemplados.</p>
  <div class="grid">
    <div class="card"><b>Sem juros</b><small>Em vez de juros, há uma taxa de administração diluída no prazo.</small></div>
    <div class="card"><b>Fundo de reserva e seguro</b><small>Protegem o grupo e o participante; os percentuais estão no contrato.</small></div>
    <div class="card"><b>Correção anual</b><small>Crédito e parcelas são corrigidos pelo índice do plano (ex.: INCC ou IPCA), preservando o poder de compra.</small></div>
    <div class="card"><b>Poder de compra à vista</b><small>Contemplado, o crédito é usado como pagamento à vista do bem.</small></div>
  </div>
  <img class="brand" src="{{logo}}" alt=""><span class="n">05</span>
</section>

<section class="slide">
  <div class="kicker">Contemplação</div>
  <h2>Os caminhos até a sua carta de crédito</h2>
  <div class="grid">
    <div class="card"><b>Sorteio</b><small>Todo mês, na assembleia, sem custo adicional.</small></div>
    <div class="card"><b>Lance livre</b><small>Você oferta um percentual com recursos próprios; vence o maior.</small></div>
    <div class="card"><b>Lance fixo</b><small>Percentual definido pelo grupo; desempate por sorteio.</small></div>
    <div class="card"><b>Lance embutido</b><small>Usa parte do próprio crédito para ofertar o lance.</small></div>
    <div class="card"><b>Lance fidelidade</b><small>Quando o plano oferece: vale a partir do mês indicado, com as parcelas em dia.</small></div>
  </div>
  <p class="disclaimer">A contemplação depende de sorteio ou lance e não há garantia de data. Simulações variam conforme as vagas e o histórico dos grupos.</p>
  <img class="brand" src="{{logo}}" alt=""><span class="n">06</span>
</section>

<section class="slide">
  <div class="kicker">Comparativo</div>
  <h2>Consórcio x financiamento</h2>
  <table>
    <tr><th></th><th>Consórcio</th><th>Financiamento</th></tr>
    <tr><td>Custo</td><td>Taxa de administração, sem juros</td><td>Juros compostos + seguros (CET)</td></tr>
    <tr><td>Entrada</td><td>Não exige</td><td>Normalmente 20% ou mais</td></tr>
    <tr><td>Acesso ao bem</td><td>Na contemplação (sorteio ou lance)</td><td>Imediato</td></tr>
    <tr><td>Flexibilidade</td><td>Crédito para comprar à vista, inclusive com FGTS (imóvel)</td><td>Vinculado ao bem financiado</td></tr>
    <tr><td>Indicado para</td><td>Quem planeja e quer pagar menos</td><td>Quem precisa do bem agora</td></tr>
  </table>
  <img class="brand" src="{{logo}}" alt=""><span class="n">07</span>
</section>

<section class="slide">
  <div class="kicker">Estratégia</div>
  <h2>Duas formas de usar o consórcio</h2>
  <div class="grid">
    <div class="card"><b>Aquisição planejada</b><small>Para conquistar o imóvel, o veículo ou o serviço com parcela que cabe no orçamento e estratégia de lance para antecipar a contemplação.</small></div>
    <div class="card"><b>Alavancagem patrimonial</b><small>Cartas de crédito como investimento: aquisição de imóveis para renda, construção ou ampliação de patrimônio ao longo do tempo.</small></div>
    <div class="card"><b>Divisão de cotas</b><small>Dividir o crédito em cotas e grupos diferentes aumenta as oportunidades de contemplação.</small></div>
  </div>
  <p class="lead" style="margin-top:1.6em">Estratégia sugerida para você:</p>
  <div class="notes" contenteditable="true" data-ph="Anote a estratégia combinada na reunião"></div>
  <img class="brand" src="{{logo}}" alt=""><span class="n">08</span>
</section>

<section class="slide">
  <div class="kicker">Próximos passos</div>
  <h2>Daqui para frente</h2>
  <ul class="clean">
    <li><span><b>Proposta personalizada</b> com administradora, plano, prazo, parcela e estratégia de lance.</span></li>
    <li><span><b>Apresentação da proposta</b> para você (e quem decide junto) tirar todas as dúvidas.</span></li>
    <li><span><b>Adesão</b>: ficha de cadastro on-line, documentos (identificação e comprovante de endereço) e termo de adesão.</span></li>
    <li><span><b>Acompanhamento</b> das assembleias e da estratégia de lance até a contemplação.</span></li>
  </ul>
  <p class="lead" style="margin-top:1.4em">Data combinada para a apresentação da proposta:</p>
  <div class="notes" contenteditable="true" data-ph="dd/mm às hh:mm"></div>
  <img class="brand" src="{{logo}}" alt=""><span class="n">09</span>
</section>

<section class="slide">
  <div class="cover">
    <div>
      <img class="logo" src="{{logo}}" alt="{{empresa}}">
      <h2>Obrigado, {{cliente_primeiro_nome}}!</h2>
      <p class="lead">Fico à disposição para qualquer dúvida. Conte comigo em cada etapa.</p>
      <a class="cta" href="{{especialista_whatsapp_link}}">Falar no WhatsApp</a>
    </div>
    <div class="person contact">
      <img src="{{especialista_foto}}" alt="{{especialista_nome}}">
      <div><strong>{{especialista_nome}}</strong><span>{{especialista_cargo}}</span><span>WhatsApp: {{especialista_whatsapp}}</span><span><a href="mailto:{{especialista_email}}">{{especialista_email}}</a></span><span>{{especialista_registro}}</span></div>
    </div>
  </div>
  <span class="n">10</span>
</section>

</body>
</html>
`;

module.exports = { TEMPLATE, FIELDS };
