// Conteúdo da trilha de integração do especialista: guia da marca Vero e o kit de configuração
// (WhatsApp Business e LinkedIn), com os textos prontos personalizados com os dados de Meu cadastro.
import { html } from './ui.js';

export const PALETTE = [
  ['Azul-noite', '#0D1B2A', 'Cor principal. Fundos, títulos sobre claro e o botão principal no tema claro.'],
  ['Azul-marinho', '#1B263B', 'Cartões e painéis sobre o azul-noite; segunda cor de fundo.'],
  ['Azul-ardósia', '#415A77', 'Destaques escuros, ícones e elementos de apoio.'],
  ['Azul-aço', '#778DA9', 'Destaque e links; textos secundários sobre fundo escuro.'],
  ['Aço-claro', '#A9B8CB', 'Subtítulos e detalhes sobre fundo escuro.'],
  ['Névoa', '#E0E1DD', 'Texto principal sobre fundo escuro e fundos claros.'],
];

/** Guia da marca (etapa 3): posicionamento, como queremos ser vistos, cores, tipografia e logo. */
export function brandGuide() {
  return html`<div class="ob-doc">
    <section class="ob-hero">
      <img src="img/vero-logo-dark.webp" alt="Vero Consórcios" class="ob-logo">
      <p class="ob-kicker">Manual rápido da marca</p>
      <h2>Vero: do latim <em>verus</em>, verdadeiro.</h2>
      <p>Somos uma consultoria especializada em consórcio como estratégia de planejamento patrimonial. A marca existe para transmitir confiança: transparência nos números, sofisticação sem distância e acompanhamento de verdade.</p>
    </section>

    <section><h3>Posicionamento</h3>
      <div class="ob-cards">
        <div><strong>O que fazemos</strong><span>Planejamos a conquista e a multiplicação de patrimônio com consórcio, sem juros: aquisição planejada e alavancagem patrimonial.</span></div>
        <div><strong>Para quem</strong><span>Pessoas e empresas que preferem planejar a pagar juros, e investidores que querem construir patrimônio com cartas de crédito.</span></div>
        <div><strong>Por que a Vero</strong><span>Diagnóstico antes do produto, estratégia de lance, divisão de cotas e acompanhamento até a contemplação e o uso do crédito.</span></div>
      </div>
    </section>

    <section><h3>Como a Vero quer ser vista</h3>
      <div class="ob-two">
        <div><h4>Somos</h4><ul class="ob-list ok">
          <li><strong>Consultivos:</strong> perguntamos antes de oferecer.</li>
          <li><strong>Transparentes:</strong> custos, prazos e regras explicados com números.</li>
          <li><strong>Sofisticados e próximos:</strong> elegância visual, linguagem simples.</li>
          <li><strong>Técnicos:</strong> dominamos o produto, as administradoras e os grupos.</li>
          <li><strong>Presentes:</strong> respondemos rápido e acompanhamos depois da venda.</li>
        </ul></div>
        <div><h4>Não somos</h4><ul class="ob-list no">
          <li>Vendedores de "contemplação garantida" ou de prazos que não controlamos.</li>
          <li>Insistentes ou genéricos: cada mensagem tem um motivo e o nome do cliente.</li>
          <li>Informais demais: sem gírias, figurinhas ou áudios longos no primeiro contato.</li>
          <li>Promessas de rentabilidade: falamos em cenários e premissas.</li>
        </ul></div>
      </div>
      <h4>Tom de voz</h4>
      <p class="muted">Seguro, gentil e objetivo. Frases curtas, verbos de ação, números quando ajudam. Tratamos o cliente pelo nome e por "você".</p>
      <div class="ob-quote"><span>Em vez de</span> "Consórcio é o melhor investimento, você vai ser contemplado rápido!"<br><span>Diga</span> "Pelo seu objetivo, o consórcio pode sair mais barato que o financiamento. Vou te mostrar os números e os cenários de contemplação do grupo."</div>
    </section>

    <section><h3>Cores principais</h3>
      <div class="ob-swatches">${PALETTE.map(([n, hex, use]) => html`<div class="ob-swatch"><span style="background:${hex}"></span><strong>${n}</strong><code>${hex}</code><small>${use}</small></div>`)}</div>
      <p class="hint">Base escura (azul-noite e marinho) com textos em névoa. Os azuis aço e ardósia fazem os destaques. Evite cores fora da paleta (vermelho, laranja, verde) nas suas peças, exceto para avisos.</p>
    </section>

    <section><h3>Tipografia</h3>
      <div class="ob-cards">
        <div><strong style="font-family:var(--font-display);font-size:1.6rem">Famels</strong><span>Títulos e destaques (fonte da marca). Sem ela instalada, use <strong>Manrope</strong>.</span></div>
        <div><strong style="font-family:var(--font);font-size:1.6rem;font-weight:500">Poppins</strong><span>Textos, apresentações, propostas e mensagens longas. Pesos 300 a 600.</span></div>
      </div>
    </section>

    <section><h3>Logo e imagem pessoal</h3>
      <ul class="ob-list">
        <li>Use a versão com letras claras sobre fundo escuro e a versão escura sobre fundo claro. Nunca distorça, recolora ou aplique sombra.</li>
        <li>Deixe um respiro ao redor do logo de, no mínimo, a altura da letra "V".</li>
        <li>Foto de perfil (CRM, WhatsApp e LinkedIn): rosto bem iluminado, fundo neutro, roupa social, sorriso natural. A mesma foto em todos os canais.</li>
        <li>Nome de exibição padrão: <strong>Seu nome | Vero Consórcios</strong>.</li>
      </ul>
    </section>
  </div>`;
}

const ensure = (v, fb) => (v && String(v).trim() ? v : fb);
const waDigits = (v) => String(v || '').replace(/\D/g, '');

/** Kit do especialista (etapa 4): documento com a configuração do WhatsApp Business e do LinkedIn. */
export function kitDoc(p) {
  const name = ensure(p.name, 'Seu nome');
  const first = name.split(' ')[0];
  const wa = waDigits(p.whatsapp || p.phone);
  const waLink = wa ? `https://wa.me/${wa.length <= 11 ? `55${wa}` : wa}` : 'https://wa.me/55DDDNUMERO';
  const role = ensure(p.job_title, 'Especialista em consórcios');
  const item = (t) => html`<li><label><input type="checkbox"> <span>${t}</span></label></li>`;
  const copy = (t) => html`<div class="ob-copy"><pre>${t}</pre><button type="button" class="btn small ghost" data-copy>Copiar</button></div>`;
  return html`<div class="ob-doc ob-kit">
    <section class="ob-hero"><img src="img/vero-logo-dark.webp" alt="Vero Consórcios" class="ob-logo">
      <p class="ob-kicker">Kit do especialista</p><h2>${name}, deixe seus canais com a cara da Vero.</h2>
      <p>Siga a lista na ordem. Os textos já estão prontos com os seus dados (Meu cadastro): é só copiar e colar.</p></section>

    <section><h3>1. WhatsApp Business</h3>
      <ol class="ob-check">
        ${item('Instale o WhatsApp Business no celular com o seu número comercial (não use o pessoal).')}
        ${item(html`Nome do perfil: <strong>${name} | Vero Consórcios</strong>`)}
        ${item('Foto do perfil: a mesma foto profissional usada no CRM (rosto, fundo neutro).')}
        ${item('Categoria: "Serviços financeiros". Horário: segunda a sexta, 9h às 18h.')}
        ${item('E-mail comercial e site da Vero nos dados da empresa.')}
      </ol>
      <h4>Descrição do perfil</h4>
      ${copy(`${role} na Vero Consórcios. Planejamento para conquistar e multiplicar patrimônio com consórcio, sem juros. Imóveis, veículos e alavancagem patrimonial.`)}
      <h4>Mensagem de saudação</h4>
      ${copy(`Olá! Aqui é ${first}, da Vero Consórcios. Obrigado pelo contato! Me conta: o que você quer conquistar com o consórcio? Em instantes eu te respondo.`)}
      <h4>Mensagem de ausência</h4>
      ${copy(`Olá! Aqui é ${first}, da Vero Consórcios. No momento estou fora do horário de atendimento (seg. a sex., 9h às 18h). Assim que voltar, falo com você. Obrigado!`)}
      <h4>Respostas rápidas</h4>
      <div class="ob-quick">
        <div><code>/r1</code>${copy(`Perfeito! Vamos agendar uma conversa de 30 minutos por vídeo para entender o seu objetivo e te mostrar os números. Qual melhor dia e horário para você?`)}</div>
        <div><code>/proposta</code>${copy(`Preparei a sua proposta com base na nossa conversa. Te enviei o PDF: dá uma olhada e me diz o que achou. Posso te explicar cada ponto por vídeo.`)}</div>
        <div><code>/docs</code>${copy(`Para a adesão, preciso só de dois documentos: identificação (RG ou CNH) e comprovante de endereço. Pode ser foto ou PDF, pelo link da ficha que te enviei.`)}</div>
        <div><code>/obrigado</code>${copy(`Obrigado pela confiança! A partir de agora acompanho você em cada assembleia até a contemplação. Qualquer dúvida, é só chamar.`)}</div>
      </div>
      <h4>Etiquetas</h4>
      <p class="ob-tags"><span>Novo lead</span><span>R1 agendada</span><span>Proposta enviada</span><span>Pré-venda</span><span>Cliente</span><span>Indicação</span></p>
      <h4>Catálogo</h4>
      <p class="muted">Crie três itens: Consórcio de imóvel, Consórcio de veículo e Alavancagem patrimonial, com uma linha de descrição e a imagem da marca.</p>
      <h4>Seu link de WhatsApp</h4>
      ${copy(waLink)}
    </section>

    <section><h3>2. LinkedIn</h3>
      <ol class="ob-check">
        ${item('Foto do perfil: a mesma do WhatsApp e do CRM.')}
        ${item(html`Foto de capa: baixe a capa oficial com o logo da Vero (1584 × 396 px) no botão <strong>Baixar capa do LinkedIn</strong> e envie em Perfil › Editar capa.`)}
        ${item('Experiência: adicione "Vero Consórcios" como empresa atual, com o seu cargo, e siga a página da Vero.')}
        ${item('URL personalizada: linkedin.com/in/seu-nome.')}
        ${item('Competências: Consórcio, Planejamento financeiro, Planejamento patrimonial, Investimentos, Atendimento consultivo.')}
      </ol>
      <h4>Título (headline)</h4>
      ${copy(`${role} na Vero Consórcios | Planejamento patrimonial com consórcio | Imóveis, veículos e alavancagem`)}
      <h4>Sobre</h4>
      ${copy(`Ajudo pessoas e empresas a conquistar e multiplicar patrimônio com consórcio, sem juros e com estratégia.\n\nNa Vero Consórcios, cada cliente começa por um diagnóstico: entendemos o objetivo, o prazo e a parcela que cabe no orçamento. A partir daí, montamos a estratégia (aquisição planejada ou alavancagem patrimonial), escolhemos a administradora e o plano, e acompanhamos as assembleias até a contemplação.\n\nVamos conversar? WhatsApp: ${waLink}`)}
    </section>

    <section><h3>3. CRM e assinatura de e-mail</h3>
      <ol class="ob-check">
        ${item(html`Meu cadastro completo: foto, WhatsApp, cargo e apresentação (aparecem no modelo da R1).`)}
        ${item(html`Google Agenda conectado em Meu cadastro: a R1 sai com Google Meet e convite automático.`)}
      </ol>
      <h4>Assinatura de e-mail</h4>
      ${copy(`${name}\n${role} | Vero Consórcios\nWhatsApp: ${p.whatsapp || p.phone || '(DDD) 9 0000-0000'}\n${p.email || ''}`)}
    </section>
  </div>`;
}

/** Capa do LinkedIn (1584 × 396) com o logo da Vero, gerada no navegador. */
export function linkedinCover({ name, role }) {
  return new Promise((resolve, reject) => {
    const c = document.createElement('canvas');
    c.width = 1584;
    c.height = 396;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 1584, 396);
    bg.addColorStop(0, '#0D1B2A');
    bg.addColorStop(0.6, '#1B263B');
    bg.addColorStop(1, '#22304A');
    g.fillStyle = bg;
    g.fillRect(0, 0, 1584, 396);
    // Brilho suave e linhas finas (elegância, sem poluir)
    const glow = g.createRadialGradient(1300, -40, 10, 1300, -40, 620);
    glow.addColorStop(0, 'rgba(119,141,169,0.35)');
    glow.addColorStop(1, 'rgba(119,141,169,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, 1584, 396);
    g.strokeStyle = 'rgba(169,184,203,0.12)';
    g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(560 + i * 70, 396);
      g.lineTo(980 + i * 70, 0);
      g.stroke();
    }
    const img = new Image();
    img.onload = () => {
      // Logo à direita (a foto do perfil cobre o canto inferior esquerdo da capa)
      const h = 110;
      const w = (img.naturalWidth / img.naturalHeight) * h;
      g.drawImage(img, 1584 - w - 90, 70, w, h);
      g.fillStyle = '#E0E1DD';
      g.textAlign = 'right';
      g.font = '500 34px Poppins, "Segoe UI", Arial, sans-serif';
      g.fillText('Planejamento patrimonial com consórcio', 1584 - 90, 250);
      g.fillStyle = '#A9B8CB';
      g.font = '300 26px Poppins, "Segoe UI", Arial, sans-serif';
      g.fillText(`${name} · ${role}`, 1584 - 90, 300);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível gerar a imagem.'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Não foi possível carregar o logo.'));
    img.src = new URL('img/vero-logo-dark.webp', document.baseURI).href;
  });
}

/** Página do kit para imprimir ou salvar em PDF (abre em nova guia). */
export function kitPrintable(p, docHtml) {
  const css = `body{font-family:Poppins,"Segoe UI",Arial,sans-serif;color:#0D1B2A;margin:32px;line-height:1.5}h2,h3,h4{font-family:Manrope,"Segoe UI",Arial,sans-serif;color:#0D1B2A}
    .ob-hero{background:#0D1B2A;color:#E0E1DD;padding:28px 32px;border-radius:16px}.ob-hero h2{color:#fff}.ob-logo{height:48px}.ob-kicker{text-transform:uppercase;letter-spacing:.2em;font-size:12px;color:#A9B8CB}
    section{margin:22px 0;page-break-inside:avoid}pre{white-space:pre-wrap;background:#F2F3F0;border-left:3px solid #778DA9;padding:10px 12px;border-radius:8px;font-family:inherit}
    button{display:none}.ob-check{padding-left:0;list-style:none}.ob-check li{margin:6px 0}.ob-tags span{display:inline-block;border:1px solid #778DA9;border-radius:99px;padding:2px 10px;margin:0 6px 6px 0;font-size:13px}
    code{background:#E0E1DD;padding:1px 6px;border-radius:6px}.ob-quick>div{margin:8px 0}`;
  const base = new URL('.', document.baseURI).href;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><base href="${base}"><title>Kit do especialista · ${p.name}</title><style>${css}</style></head><body>${docHtml}</body></html>`;
}

