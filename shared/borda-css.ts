/**
 * RESERVA (v6.1): borda CSS de ondas. Quem monta a borda e `shared/borda.ts`, que usa
 * a fumaca em WebGL2 (`borda-fumaca.ts`) e cai aqui se o navegador nao der WebGL2.
 *
 * Borda da ponte: "luz que entra pelas bordas e ondula para dentro" (referencia:
 * brilho de borda do Apple Intelligence). Sinaliza, sem ambiguidade, que a aba
 * esta sendo conduzida por um agente.
 *
 * Roda o tempo todo, entao e LEVE de proposito: so CSS no compositor (translate,
 * scale, rotate e opacity), nenhum JS por quadro, nada de canvas, nada de animar
 * gradiente (isso repinta). O JS roda UMA vez ao mostrar (e uma vez por
 * redimensionamento) para montar o DOM e gerar o @keyframes do cometa.
 *
 * Camadas:
 *   a  banda   4 faixas, uma por borda: nucleo nitido de 5-6 px (ambar -> laranja)
 *              + brilho interno que entra 80-105 px e desvanece. Respira devagar.
 *   b  ondas   3 manchas de luz por borda (elipses radiais presas a borda) que
 *              crescem para dentro e recuam, deslizam ao longo da borda e mudam
 *              de opacidade, cada uma com seu periodo (7 a 13 s) e sua fase:
 *              mare, nao anel girando. 4 manchas de canto respiram ainda mais
 *              devagar.
 *   c  cometa  um brilho mais forte percorre o contorno, 12 s por volta
 *              (quadrado girando com conic-gradient estatico, visto por mascara).
 *
 * Fundo claro x escuro: detectado ao montar (e rechecado ao redimensionar ou ao
 * voltar a aba). No claro o ganho sobe e a borda ganha um filete laranja escuro
 * (#c2410c) no limite, que e o que a faz saltar sobre branco.
 *
 * Tudo vive no shadow root que o chamador passa (ver agent-indicator.content.ts).
 */

export type NivelBorda = 'media' | 'forte';

/** Ganho de alpha, profundidade do brilho e espessura do nucleo (px) por nivel. */
const NIVEIS: Record<NivelBorda, { ganho: number; prof: number; nucleo: number }> = {
  media: { ganho: 1, prof: 80, nucleo: 5 },
  forte: { ganho: 1.4, prof: 105, nucleo: 6 },
};
/** Ganho extra quando o fundo da pagina e claro. */
const GANHO_CLARO = 1.3;

export const T_COMETA = 12;

// ─── Geometria do percurso do cometa ────────────────────────────────────

export interface Percurso {
  /** Instante (0..1 da volta) e angulo do cometa (graus, horario a partir do norte). */
  pontos: { t: number; ang: number }[];
}

/**
 * Posicao do cometa ao longo do contorno retangular W x H, partindo do meio do
 * lado de cima no sentido horario. Devolve o angulo da reta centro->cabeca (e
 * isso que gira o quadrado do gradiente) em funcao do TEMPO, com velocidade
 * maior nos lados compridos.
 */
export function calcularPercurso(W: number, H: number, N = 160): Percurso {
  const P = 2 * (W + H);
  const cx = W / 2;
  const cy = H / 2;
  const ponto = (s: number): [number, number] => {
    if (s < W / 2) return [W / 2 + s, 0];
    s -= W / 2;
    if (s < H) return [W, s];
    s -= H;
    if (s < W) return [W - s, H];
    s -= W;
    if (s < H) return [0, H - s];
    s -= H;
    return [s, 0];
  };
  // Velocidade relativa por amostra: lados compridos 1,4x; suavizada nos cantos.
  const longoHorizontal = W >= H;
  const bruta: number[] = [];
  for (let i = 0; i < N; i++) {
    const s = ((i + 0.5) / N) * P;
    const [, y] = ponto(s);
    const noHorizontal = y === 0 || y === H;
    bruta.push(noHorizontal === longoHorizontal ? 1.4 : 1);
  }
  const janela = Math.max(2, Math.round(N * 0.04));
  const v = bruta.map((_, i) => {
    let soma = 0;
    for (let k = -janela; k <= janela; k++) soma += bruta[(i + k + N) % N];
    return soma / (2 * janela + 1);
  });

  const tempo = [0];
  for (let i = 0; i < N; i++) tempo.push(tempo[i] + 1 / v[i]);
  const total = tempo[N];

  let anterior = 0;
  const angDe = (s: number) => {
    const [x, y] = ponto(s);
    let a = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI; // 0 = norte, horario
    if (a < 0) a += 360;
    while (a < anterior - 180) a += 360;
    anterior = a;
    return a;
  };
  const pontos: { t: number; ang: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * P;
    pontos.push({ t: tempo[i] / total, ang: i === N ? 360 : angDe(i === 0 ? 0 : s) });
  }
  pontos[0].ang = 0;
  return { pontos };
}

/** CSS que depende do tamanho da janela: orbita do cometa. */
export function cssDependenteDoTamanho(W: number, H: number): string {
  const { pontos } = calcularPercurso(W, H);
  const orbita = pontos
    .map((p) => `${(p.t * 100).toFixed(3)}%{transform:rotate(${p.ang.toFixed(3)}deg)}`)
    .join('');
  return `@keyframes borda-orbita{${orbita}}`;
}

// ─── Ondas (camada b): tabela deterministica ────────────────────────────

type Lado = 't' | 'r' | 'b' | 'l';
const LADOS: Lado[] = ['t', 'r', 'b', 'l'];

interface Onda {
  lado: Lado;
  /** Posicao do inicio da mancha ao longo da borda (%) e comprimento (%). */
  pos: number;
  comp: number;
  rgb: string;
  dur: number;
  atraso: number;
  /** Deslizamento ao longo da borda (px) nos dois extremos do ciclo. */
  d0: number;
  d1: number;
  /** Escala ao longo da borda (sa) e em profundidade (sp), nos dois extremos. */
  sa0: number;
  sa1: number;
  sp0: number;
  sp1: number;
  o0: number;
  o1: number;
}

/** Cores das manchas: laranja, ambar, ambar claro, laranja queimado (profundidade). */
const CORES = ['255,122,0', '255,179,71', '255,122,0', '255,210,122', '255,159,28', '194,65,12'];

function gerarOndas(): Onda[] {
  let sem = 20261020;
  const r = () => {
    sem = (Math.imul(sem, 1664525) + 1013904223) >>> 0;
    return sem / 4294967296;
  };
  const faixa = (a: number, b: number) => a + (b - a) * r();
  const out: Onda[] = [];
  for (const lado of LADOS) {
    // 3 manchas por lado, espalhadas, com periodos diferentes.
    for (let k = 0; k < 3; k++) {
      const comp = faixa(34, 50);
      const dur = faixa(7, 13);
      const dir = r() < 0.5 ? -1 : 1;
      const desl = faixa(30, 110);
      out.push({
        lado,
        pos: Math.max(0, Math.min(100 - comp, faixa(k * 28 - 6, k * 28 + 6) + 2)),
        comp,
        rgb: CORES[Math.floor(r() * CORES.length)],
        dur,
        atraso: -r() * dur,
        d0: -dir * desl * 0.5,
        d1: dir * desl * 0.5,
        sa0: faixa(0.8, 0.95),
        sa1: faixa(1.05, 1.3),
        sp0: faixa(0.28, 0.45),
        sp1: faixa(0.85, 1.1),
        o0: faixa(0.1, 0.3),
        o1: faixa(0.75, 1),
      });
    }
  }
  return out;
}
const ONDAS = gerarOndas();

/** Periodo (s) e atraso (s) da respiracao de cada banda. */
const RESPIRA: Record<Lado, [number, number]> = { t: [8, -1], r: [10, -4], b: [9, -6], l: [11, -2] };
/** Cantos: periodo e atraso. */
const CANTOS: { c: 'tl' | 'tr' | 'br' | 'bl'; dur: number; atraso: number }[] = [
  { c: 'tl', dur: 10, atraso: -2 },
  { c: 'tr', dur: 12, atraso: -7 },
  { c: 'br', dur: 9, atraso: -4 },
  { c: 'bl', dur: 11, atraso: -9 },
];

// ─── CSS estatico ───────────────────────────────────────────────────────

const ANEL = (px: string) => `
  padding:${px};
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;
  mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0);`;

/** Mascara larga para o brilho do cometa: entra --prof px em cada borda. */
const FACE_SUAVE = ['to bottom', 'to top', 'to right', 'to left']
  .map((d) => `linear-gradient(${d},#000,rgba(0,0,0,.4) 6px,transparent calc(var(--prof) * .7))`)
  .join(',');

const A = (alpha: number, rgb = '255,122,0') => `rgba(${rgb},calc(${alpha} * var(--g)))`;

/** Gradiente da banda: nucleo nitido + brilho que desvanece, na direcao `dir`. */
function gradBanda(dir: string): string {
  return `linear-gradient(${dir},
    ${A(1, '255,226,170')} 0,
    ${A(1, '255,179,71')} 1.5px,
    ${A(1, '255,122,0')} calc(var(--nuc) - 1px),
    ${A(0.5, '255,122,0')} calc(var(--nuc) + 1.5px),
    ${A(0.26, '255,140,20')} calc(var(--nuc) + 9px),
    ${A(0.1, '255,160,50')} calc(var(--prof) * .5),
    rgba(255,179,71,0) var(--prof))`;
}

function gradOnda(lado: Lado): string {
  const pos = { t: '50% 0', b: '50% 100%', l: '0 50%', r: '100% 50%' }[lado];
  const raio = lado === 't' || lado === 'b' ? '50% 100%' : '100% 50%';
  return `radial-gradient(ellipse ${raio} at ${pos},
    rgba(var(--rgb),calc(.7 * var(--g))) 0,
    rgba(var(--rgb),calc(.34 * var(--g))) 42%,
    rgba(var(--rgb),calc(.1 * var(--g))) 72%,
    rgba(var(--rgb),0) 100%)`;
}

export function cssEstatico(): string {
  const bandas = (
    [
      ['t', 'to bottom', 'top:0;left:0;right:0;height:var(--prof);box-shadow:inset 0 1.5px 0 rgba(194,65,12,var(--rim))'],
      ['b', 'to top', 'bottom:0;left:0;right:0;height:var(--prof);box-shadow:inset 0 -1.5px 0 rgba(194,65,12,var(--rim))'],
      ['l', 'to right', 'left:0;top:0;bottom:0;width:var(--prof);box-shadow:inset 1.5px 0 0 rgba(194,65,12,var(--rim))'],
      ['r', 'to left', 'right:0;top:0;bottom:0;width:var(--prof);box-shadow:inset -1.5px 0 0 rgba(194,65,12,var(--rim))'],
    ] as const
  )
    .map(
      ([l, dir, geo]) =>
        `.banda.${l}{${geo};background:${gradBanda(dir)};animation-duration:${RESPIRA[l][0]}s;animation-delay:${RESPIRA[l][1]}s}`,
    )
    .join('\n    ');

  const ondasGeo = `
    .onda{position:absolute;opacity:0;
      animation-duration:var(--dur);animation-delay:var(--atraso);animation-timing-function:cubic-bezier(.45,.05,.55,.95);animation-iteration-count:infinite}
    .onda.t,.onda.b{width:var(--comp);height:var(--prof);left:var(--pos);animation-name:borda-onda-h}
    .onda.l,.onda.r{height:var(--comp);width:var(--prof);top:var(--pos);animation-name:borda-onda-v}
    .onda.t{top:0;transform-origin:50% 0;background:${gradOnda('t')}}
    .onda.b{bottom:0;transform-origin:50% 100%;background:${gradOnda('b')}}
    .onda.l{left:0;transform-origin:0 50%;background:${gradOnda('l')}}
    .onda.r{right:0;transform-origin:100% 50%;background:${gradOnda('r')}}
    @keyframes borda-onda-h{
      0%,100%{translate:var(--d0) 0;scale:var(--sa0) var(--sp0);opacity:var(--o0)}
      50%{translate:var(--d1) 0;scale:var(--sa1) var(--sp1);opacity:var(--o1)}}
    @keyframes borda-onda-v{
      0%,100%{translate:0 var(--d0);scale:var(--sp0) var(--sa0);opacity:var(--o0)}
      50%{translate:0 var(--d1);scale:var(--sp1) var(--sa1);opacity:var(--o1)}}`;

  const cantos = (['tl', 'tr', 'br', 'bl'] as const)
    .map((c) => {
      const [v, h] = c.split('') as [string, string];
      const origem = `${h === 'l' ? '0' : '100%'} ${v === 't' ? '0' : '100%'}`;
      return `.canto.${c}{${v === 't' ? 'top' : 'bottom'}:0;${h === 'l' ? 'left' : 'right'}:0;transform-origin:${origem};
        background:radial-gradient(circle calc(var(--prof) * 2.1) at ${origem},${A(0.62, '255,179,71')} 0,${A(0.28, '255,122,0')} 40%,rgba(255,122,0,0) 100%)}`;
    })
    .join('\n    ');

  return `
    #agent-borda{
      position:fixed;inset:0;z-index:2147483644;pointer-events:none;overflow:hidden;
      contain:layout style;
      opacity:0;transition:opacity 1400ms cubic-bezier(.4,0,.2,1);
      --g:1;--prof:80px;--nuc:5px;--rim:0;
    }
    #agent-borda.active{opacity:1}
    #agent-borda.clara{--rim:.85}
    #agent-borda *{pointer-events:none;box-sizing:border-box}

    /* a: banda = nucleo nitido + brilho interno, respira */
    .banda{position:absolute;animation:borda-respira 9s ease-in-out infinite}
    ${bandas}
    @keyframes borda-respira{0%,100%{opacity:.78}50%{opacity:1}}

    /* b: ondas + cantos */
    ${ondasGeo}
    .canto{position:absolute;width:calc(var(--prof) * 2.1);height:calc(var(--prof) * 2.1);opacity:0;
      animation:borda-canto var(--dur) cubic-bezier(.45,.05,.55,.95) var(--atraso) infinite}
    ${cantos}
    @keyframes borda-canto{
      0%,100%{scale:.55;opacity:.25}
      50%{scale:1.05;opacity:.95}}

    /* c: cometa, 12 s por volta. O anel mascara um quadrado girando. */
    .anel{position:absolute;inset:0;overflow:hidden}
    .anel.c1{${ANEL('calc(var(--nuc) + 1px)')};opacity:.9}
    .anel.bloom{-webkit-mask-image:${FACE_SUAVE};mask-image:${FACE_SUAVE};opacity:.6}
    .orb{
      position:absolute;
      width:var(--D);height:var(--D);
      left:calc(50% - var(--D) / 2);top:calc(50% - var(--D) / 2);
      background:conic-gradient(from 0deg,
        #fff1d6 0deg,
        rgba(255,210,122,.95) 1.4deg,
        rgba(255,179,71,.6) 5deg,
        rgba(255,122,0,.28) 16deg,
        rgba(255,122,0,0) 40deg,
        rgba(255,122,0,0) 280deg,
        rgba(194,65,12,.16) 305deg,
        rgba(255,122,0,.4) 332deg,
        rgba(255,159,28,.78) 350deg,
        rgba(255,210,122,.95) 357.5deg,
        #fff1d6 360deg);
      animation:borda-orbita ${T_COMETA}s linear infinite;
    }

    @media (prefers-reduced-motion:reduce){
      .banda,.onda,.canto,.orb{animation:none}
      .banda{opacity:.9}
      .onda{opacity:.45;scale:1 .7}
      .canto{opacity:.4;scale:.8}
      .anel{display:none}
    }`;
}

// ─── Fundo claro ou escuro ──────────────────────────────────────────────

/** True se o fundo da pagina for claro. Le so estilos computados (barato). */
export function fundoClaro(): boolean {
  const lerCor = (e: Element | null): [number, number, number] | null => {
    if (!e) return null;
    const m = getComputedStyle(e).backgroundColor.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (p.length >= 4 && p[3] < 0.5) return null;
    return [p[0], p[1], p[2]];
  };
  const c = lerCor(document.body) ?? lerCor(document.documentElement);
  if (!c) return !/dark/.test(getComputedStyle(document.documentElement).colorScheme || '');
  const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  return lum > 0.5;
}

// ─── DOM ────────────────────────────────────────────────────────────────

function el(cls: string, pai: Element, tag = 'div'): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  pai.appendChild(e);
  return e;
}

export interface Borda {
  /** Qual desenho esta na tela: fumaca (WebGL2) ou css (reserva). */
  modo: 'fumaca' | 'css';
  raiz: HTMLElement;
  /** Regenera os keyframes para o novo tamanho de janela e rechecha claro/escuro. */
  redimensionar(): void;
  /** Para de gastar enquanto a borda esta escondida (screenshot). Sem efeito no css. */
  pausar?(): void;
  retomar?(): void;
  destruir(): void;
}

export interface OpcoesBorda {
  nivel?: NivelBorda;
  /** Forca claro (true) ou escuro (false); omitido = detecta. */
  claro?: boolean;
}

/** Monta a borda dentro de `shadow` (ainda invisivel; chame `.classList.add('active')`). */
export function montarBordaCss(shadow: ShadowRoot, opcoes: OpcoesBorda = {}): Borda {
  const nivel = NIVEIS[opcoes.nivel ?? 'forte'];
  const estatico = document.createElement('style');
  estatico.textContent = cssEstatico();
  const dinamico = document.createElement('style');
  shadow.append(estatico, dinamico);

  const raiz = document.createElement('div');
  raiz.id = 'agent-borda';
  raiz.style.setProperty('--prof', `${nivel.prof}px`);
  raiz.style.setProperty('--nuc', `${nivel.nucleo}px`);
  shadow.appendChild(raiz);

  for (const l of LADOS) el(`banda ${l}`, raiz);
  for (const o of ONDAS) {
    const e = el(`onda ${o.lado}`, raiz);
    e.style.cssText =
      `--pos:${o.pos.toFixed(1)}%;--comp:${o.comp.toFixed(1)}%;--rgb:${o.rgb};--dur:${o.dur.toFixed(2)}s;--atraso:${o.atraso.toFixed(2)}s;` +
      `--d0:${o.d0.toFixed(0)}px;--d1:${o.d1.toFixed(0)}px;--sa0:${o.sa0.toFixed(2)};--sa1:${o.sa1.toFixed(2)};` +
      `--sp0:${o.sp0.toFixed(2)};--sp1:${o.sp1.toFixed(2)};--o0:${o.o0.toFixed(2)};--o1:${o.o1.toFixed(2)}`;
  }
  for (const c of CANTOS) {
    const e = el(`canto ${c.c}`, raiz);
    e.style.cssText = `--dur:${c.dur}s;--atraso:${c.atraso}s`;
  }
  el('orb', el('anel bloom', raiz));
  el('orb', el('anel c1', raiz));

  let claroAtual: boolean | null = null;
  const aplicarTema = () => {
    const claro = opcoes.claro ?? fundoClaro();
    if (claro === claroAtual) return;
    claroAtual = claro;
    raiz.classList.toggle('clara', claro);
    raiz.style.setProperty('--g', String(nivel.ganho * (claro ? GANHO_CLARO : 1)));
  };

  let ultimo = '';
  const redimensionar = () => {
    aplicarTema();
    const W = Math.max(200, window.innerWidth);
    const H = Math.max(200, window.innerHeight);
    const chave = `${W}x${H}`;
    if (chave === ultimo) return;
    ultimo = chave;
    raiz.style.setProperty('--D', `${Math.ceil(Math.hypot(W, H))}px`);
    dinamico.textContent = cssDependenteDoTamanho(W, H);
  };
  redimensionar();

  let t: number | undefined;
  const aoRedimensionar = () => {
    clearTimeout(t);
    t = window.setTimeout(redimensionar, 250);
  };
  const aoVoltar = () => {
    if (!document.hidden) aplicarTema();
  };
  window.addEventListener('resize', aoRedimensionar);
  document.addEventListener('visibilitychange', aoVoltar);

  return {
    modo: 'css',
    raiz,
    redimensionar,
    destruir() {
      window.removeEventListener('resize', aoRedimensionar);
      document.removeEventListener('visibilitychange', aoVoltar);
      clearTimeout(t);
    },
  };
}
