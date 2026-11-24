/**
 * Borda da ponte, versao "fumaca + giro 10 s" (aprovada pelo usuário em 21/10/2026;
 * prototipo e medicoes em _archive\tmp\borda-comet-laranja\demo.html, variante C 10 s).
 *
 * Um unico shader WebGL2 num <canvas> em meia resolucao, `position:fixed`,
 * `pointer-events:none`: fumaca laranja correndo pelo contorno + anel de brilho que
 * da uma volta a cada 10 s. Fundo claro ou escuro muda o ganho (lido a cada 2 s, nao
 * por quadro).
 *
 * Ciclo de vida (o indicador roda o tempo todo em que o agente trabalha, entao nao
 * pode sobrar nada depois):
 *   - o canvas e o contexto WebGL nascem em `montarBordaFumaca` (ao ligar);
 *   - `destruir()` cancela o rAF, solta os listeners, deleta o programa, perde o
 *     contexto de proposito (WEBGL_lose_context) e tira canvas e estilo do shadow;
 *   - aba oculta (`document.hidden`) ou indicador escondido para screenshot
 *     (`pausar()`): o rAF e cancelado, volta ao mostrar;
 *   - prefers-reduced-motion: um quadro estatico, sem rAF;
 *   - sem WebGL2 (ou shader que nao compila): devolve null e `borda.ts` monta a borda
 *     CSS de ondas (borda-css.ts).
 *
 * Tudo vive no shadow root que o chamador passa (ver agent-indicator.content.ts);
 * canvas nao tem texto, entao nada entra em innerText.
 */

import type { Borda, OpcoesBorda } from './borda-css';

// ─── Shader (copiado literal da previa aprovada) ───────────────────────
const VS = `#version 300 es
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform vec2  uRes;     // tamanho do buffer em pixels
uniform float uScale;   // px de CSS por pixel do buffer
uniform float uTime;    // segundos
uniform float uFade;    // entrada 0..1
uniform float uDark;    // 0 claro .. 1 escuro
uniform float uSpeed;   // 1.75
uniform float uThick;   // 0.48
uniform float uSoft;    // 0.89
uniform float uAlpha;   // 0.30
uniform float uSpin;    // periodo do anel girando em s (0 = sem anel)
uniform float uBoost;   // 1 = ajustes de fundo claro + anel (modo C); 0 = fumaça original (modo A)
out vec4 outColor;

const float TAU = 6.28318530718;
const float RING_CORE = 0.62, RING_W0 = 34.0, RING_W1 = 90.0, RING_CUT = 330.0, RING_KL = 1.6, RING_KD = 1.45;

float hash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);          // quíntica: sem vincos
  float a = hash(i),                    b = hash(i + vec3(1,0,0));
  float c = hash(i + vec3(0,1,0)),      d = hash(i + vec3(1,1,0));
  float e = hash(i + vec3(0,0,1)),      g = hash(i + vec3(1,0,1));
  float h = hash(i + vec3(0,1,1)),      k = hash(i + vec3(1,1,1));
  return mix(mix(mix(a,b,f.x), mix(c,d,f.x), f.y),
             mix(mix(e,g,f.x), mix(h,k,f.x), f.y), f.z);
}
float fbm(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.0 + vec3(5.2, 1.3, 2.7); a *= 0.5; }
  return s / 0.875;
}
float sdRR(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
// composição "over" com cor pré-multiplicada
vec4 over(vec4 top, vec4 bot){ return top + bot * (1.0 - top.a); }

// anel de brilho girando: gradiente angular fract(perímetro - t/T) com 3 lóbulos macios,
// e falloff exponencial da distância à borda no lugar do blur do CSS
vec4 ringLayer(vec2 P, vec2 hs, float e, float sm, float dk, vec3 lt){
  vec2  n   = P / hs;
  vec2  ap  = abs(n);
  float u;                                                   // px ao longo do perímetro, horário a partir do topo-centro
  if (ap.y > ap.x){
    float xl = n.x / max(ap.y, 1e-4) * hs.x;
    u = (n.y > 0.0) ? xl : 2.0 * (hs.x + hs.y) - xl;
  } else {
    float yl = n.y / max(ap.x, 1e-4) * hs.y;
    u = (n.x > 0.0) ? hs.x + hs.y - yl : 3.0 * hs.x + 3.0 * hs.y + yl;
  }
  float ph0 = fract(u / (4.0 * (hs.x + hs.y)) - uTime / uSpin);

  // 3 lóbulos: realce #ffd27a, âmbar #ff9f1c, laranja #ff7a00 (larguras e forças diferentes)
  const vec3 RC[3] = vec3[3](vec3(1.000, 0.780, 0.380), vec3(1.000, 0.624, 0.110), vec3(1.000, 0.478, 0.000));
  float Lw[3] = float[3](1.00, 0.78, 0.62);
  float Lp[3] = float[3](0.00, 0.33, 0.67);
  float Lc[3] = float[3](0.075, 0.085, 0.100);
  float Is = 0.10;                                           // piso: o anel nunca apaga por completo
  vec3  Cs = RC[2] * 0.10;
  for (int k = 0; k < 3; k++){
    float pk = Lp[k] + 0.018 * sin(uTime * 0.31 + float(k) * 2.1);
    float dd = abs(fract(ph0 - pk + 0.5) - 0.5) / Lc[k];
    float g  = Lw[k] * exp(-dd * dd);
    Is += g; Cs += RC[k] * g;
  }
  vec3 rc = Cs / Is;
  rc = mix(rc, rc * lt, 1.0 - dk);

  float band = RING_CORE * exp(-e / RING_W0) + (1.0 - RING_CORE) * exp(-e / RING_W1);
  band *= 1.0 - smoothstep(RING_CUT * 0.55, RING_CUT, e);    // some de vez antes do corte: sem contorno
  float I  = Is * band * (0.72 + 0.55 * sm);                 // a fumaça modula o brilho: um só material
  float ra = 1.0 - exp(-I * mix(RING_KL, RING_KD, dk));
  return vec4(rc * ra, ra);
}

void main(){
  vec2  P  = (gl_FragCoord.xy - 0.5 * uRes) * uScale;     // px de CSS, origem no centro
  vec2  hs = 0.5 * uRes * uScale;                          // meia-largura/altura
  float T  = uTime * uSpeed;

  // distância para dentro a partir da borda da janela (retângulo arredondado)
  float d  = sdRR(P, hs + vec2(8.0), 34.0);
  float e  = max(-d, 0.0);

  float R  = uThick * min(hs.x, hs.y) * 0.30;             // alcance do corpo da fumaça
  if (e > RING_CUT || (uSpin <= 0.0 && e > R * 3.4)){ outColor = vec4(0.0); return; }   // miolo da página: nada a fazer
  if (e > R * 3.4){                                         // só o halo largo do anel (sem fumaça: barato)
    vec4 rg = ringLayer(P, hs, e, 0.5, uDark, vec3(1.0, 0.70, 0.30));
    rg.rgb += rg.rgb * 0.18 * uDark;
    rg *= uFade;
    float dn0 = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    outColor = clamp(rg + vec4(dn0), 0.0, 1.0); return;
  }

  // coordenada angular normalizada (cantos a 45 graus, igual nos lados longos e curtos)
  vec2  n   = P / hs;
  float th  = atan(n.y, n.x) / TAU + 0.5;                  // 0..1 em volta da tela
  float ang = th * TAU;
  vec2  cs  = vec2(cos(ang), sin(ang));

  // --- fumaça: ruído de valor deformado por ruído (domain warp), correndo ao longo da borda
  float drift = T * 0.020;
  vec3  q0 = vec3(cs * 4.2, 0.0);
  vec2  w;
  {
    float a1 = ang - drift * TAU;
    vec3  s1 = vec3(cos(a1), sin(a1), 0.0) * 4.2;
    w = vec2(fbm(s1 + vec3(0.0, 0.0, e / 80.0 + T * 0.10)),
             fbm(s1 + vec3(7.1, 3.3, e / 80.0 - T * 0.08)));
  }
  float aw  = ang - drift * TAU + (w.x - 0.5) * 0.9;
  float ew  = e + (w.y - 0.5) * R * 1.15;
  vec3  sp  = vec3(cos(aw), sin(aw), 0.0) * 4.2 + vec3(0.0, 0.0, ew / 62.0 + T * 0.22);
  float sm  = fbm(sp);                                      // 0..1 (centrado em ~0.5)
  float sm2 = fbm(sp * 1.7 + vec3(11.0, 4.0, T * 0.15));

  // --- máscara de borda (suave): 1 na borda, 0 em R; tendrils vêm do ew deformado
  float x    = max(ew, 0.0) / R;
  float body_ = exp(-2.3 * pow(x, mix(1.0, 1.45, uSoft)));
  float dens = smoothstep(0.18, 0.80, sm);

  // --- 5 manchas: setor angular * máscara senoidal; cada uma com cor e velocidade próprias
  const vec3 C0 = vec3(1.000, 0.478, 0.000);               // #ff7a00
  const vec3 C1 = vec3(1.000, 0.624, 0.110);               // #ff9f1c
  const vec3 C2 = vec3(1.000, 0.702, 0.278);               // #ffb347
  const vec3 C3 = vec3(1.000, 0.824, 0.478);               // #ffd27a (realce)
  vec3  col[5]  = vec3[5](C0, C1, C2, C3, C1);
  float vel[5]  = float[5](0.115, -0.070, 0.165, 0.050, -0.105);
  float ph[5]   = float[5](0.00, 0.37, 0.61, 0.18, 0.82);
  float lobe[5] = float[5](3.6, 4.4, 3.2, 5.0, 4.0);
  float rip[5]  = float[5](3.0, 5.0, 4.0, 7.0, 2.0);

  vec3 lightTint = mix(vec3(1.0, 0.82, 0.55), vec3(1.0, 0.70, 0.30), uBoost);   // fundo claro: laranja mais fundo, menos pálido
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 5; i++){
    float f   = fract(th + T * vel[i] * 0.55 + ph[i]);
    float sec = pow(max(sin(f * 3.14159265), 0.0), lobe[i]);                       // setor angular
    float sinm = 0.55 + 0.45 * sin(TAU * (th * rip[i]) + T * (0.9 + 0.35 * float(i)) + ph[i] * TAU);
    float fil  = pow(1.0 - abs(2.0 * sm2 - 1.0), 3.0);              // fios de fumaça
    float tex  = (i % 2 == 0) ? sm : mix(sm2, fil, 0.55);
    float I    = sec * sinm * body_ * (0.16 + 0.95 * pow(tex, 1.5)) * (0.45 + 0.8 * dens);
    float a    = 1.0 - exp(-max(I - 0.03, 0.0) * uAlpha * mix(mix(4.6, 5.4, uBoost), 3.2, uDark));   // compressão suave: sem platô nem contorno duro
    vec3  c    = mix(col[i], col[i] * lightTint, 1.0 - uDark) + col[3] * 0.10 * pow(tex, 3.0) * mix(0.35, 1.0, uDark);
    acc = over(vec4(c * a, a), acc);
  }

  // --- bloom leve: halo largo e baixo + realce no corpo da luz
  float halo = exp(-e / (R * 1.35)) * (0.45 + 0.55 * sm2);
  float rim  = exp(-e / (R * 0.22)) * (0.35 + 0.65 * sm) * (0.4 + 0.6 * acc.a);
  float lum  = clamp(acc.a * 1.4, 0.0, 1.0);
  vec3  glow = C1 * halo * (0.045 + 0.10 * lum);
  acc.rgb   += glow * mix(mix(1.0, 0.25, uBoost), 1.7, uDark);
  acc.a     += halo * (0.030 + 0.05 * lum) * mix(mix(1.6, 1.8, uBoost), 0.9, uDark) + rim * 0.10;
  acc.rgb   += C3 * rim * mix(mix(0.05, 0.02, uBoost), 0.16, uDark);
  acc.rgb   += acc.rgb * acc.a * mix(0.10, 0.28, uDark);   // realce: núcleo "acende"

  // --- C: anel de brilho girando, somado à fumaça
  if (uSpin > 0.0){
    float wc = 1.0 - smoothstep(R * 2.2, R * 3.4, e);          // perto da borda a fumaça modula; longe, valor neutro
    vec4 rg = ringLayer(P, hs, e, mix(0.5, sm, wc), uDark, lightTint);
    acc = over(rg, acc);
    acc.rgb += rg.rgb * 0.18 * uDark;                          // escuro: o núcleo "acende"
  }

  acc *= uFade;
  // dither: tira o degrau (banding) dos degradês suaves
  float dn = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  acc += vec4(dn);
  outColor = clamp(acc, 0.0, 1.0);
}`;

/**
 * Orcamento de pixels do buffer interno: a fumaca e suave, entao desenha pouco e o CSS
 * amplia (o shader trabalha em px de CSS, entao o desenho nao muda de tamanho).
 * 1280x720 -> ~267x150. Escala nunca passa de 0,5 nem cai de 0,15 do tamanho da janela.
 */
const ORCAMENTO_PIXELS = 40_000;
const ESCALA_MAX = 0.5;
const ESCALA_MIN = 0.15;
/**
 * Quadros por segundo: a fumaca anda devagar, 30 enganam o olho e poupam GPU/CPU (medido:
 * GPU 20% -> 12% de um nucleo). Em tela de 60 Hz so ha 60, 30 e 20 de verdade; 25 cairia
 * em 20 e o anel de brilho passaria a dar passos.
 */
const FPS_ALVO = 30;
/** Primeiro quadro ja "no meio" da animacao (a fumaca nao nasce do zero). */
const T_INICIAL = 6.0;
/** Parametros da variante aprovada (C 10 s). */
const VELOCIDADE = 1.225;
const PERIODO_GIRO_S = 10;
/** Instante do quadro estatico (reduced-motion): o mesmo que a previa usa. */
const T_ESTATICO = 4.0;
/** De quanto em quanto tempo relemos a cor de fundo da pagina. */
const RELER_FUNDO_MS = 2000;

const NOMES_UNIFORMES = [
  'uRes', 'uScale', 'uTime', 'uFade', 'uDark', 'uSpeed', 'uThick', 'uSoft', 'uAlpha', 'uSpin', 'uBoost',
] as const;
type Uniformes = Record<(typeof NOMES_UNIFORMES)[number], WebGLUniformLocation | null>;

/** Quanto o fundo da pagina e escuro: 0 claro .. 1 escuro (mesma curva da previa). */
export function escuroDoFundo(): number {
  const lerCor = (e: Element | null): [number, number, number] | null => {
    if (!e) return null;
    const m = getComputedStyle(e).backgroundColor.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (p.length >= 4 && p[3] < 0.5) return null;
    return [p[0], p[1], p[2]];
  };
  const c = lerCor(document.body) ?? lerCor(document.documentElement);
  if (!c) return /dark/.test(getComputedStyle(document.documentElement).colorScheme || '') ? 1 : 0;
  const lin = (v: number) => Math.pow(v / 255, 2.2);
  const L = 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const x = Math.min(1, Math.max(0, (0.3 - L) / 0.25)); // escuro < .05, claro > .30
  return x * x * (3 - 2 * x);
}

const CSS_FUMACA = `
  #agent-borda{position:fixed;inset:0;z-index:2147483644;pointer-events:none;overflow:hidden;
    opacity:0;transition:opacity 900ms cubic-bezier(.4,0,.2,1)}
  #agent-borda.active{opacity:1}
  #agent-borda canvas{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}`;

/**
 * Monta a borda de fumaca dentro de `shadow` (invisivel; chame `.classList.add('active')`).
 * Devolve null, sem deixar nada no shadow, se nao houver WebGL2.
 */
export interface OpcoesFumaca extends OpcoesBorda {
  /** Orcamento de pixels do buffer interno (padrao 40 000). So para medir. */
  pixels?: number;
  /** Quadros por segundo (padrao 25; >=60 = sem limite). So para medir. */
  fps?: number;
}

export function montarBordaFumaca(shadow: ShadowRoot, opcoes: OpcoesFumaca = {}): Borda | null {
  const orcamento = opcoes.pixels ?? ORCAMENTO_PIXELS;
  const fps = opcoes.fps ?? FPS_ALVO;
  const intervaloMs = fps >= 60 ? 0 : 1000 / fps - 3; // -3 ms: folga para o jitter do vsync
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const ctx: WebGL2RenderingContext = gl;

  let prog: WebGLProgram | null = null;
  let U = {} as Uniformes;

  const compilar = (tipo: number, fonte: string): WebGLShader => {
    const s = ctx.createShader(tipo);
    if (!s) throw new Error('createShader');
    ctx.shaderSource(s, fonte);
    ctx.compileShader(s);
    if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) {
      const log = ctx.getShaderInfoLog(s);
      ctx.deleteShader(s);
      throw new Error(log || 'shader');
    }
    return s;
  };
  /** Cria o programa e fixa os uniformes que nao mudam. Lanca se algo falhar. */
  const prepararPrograma = (): void => {
    const vs = compilar(ctx.VERTEX_SHADER, VS);
    const fs = compilar(ctx.FRAGMENT_SHADER, FS);
    const p = ctx.createProgram();
    if (!p) throw new Error('createProgram');
    ctx.attachShader(p, vs);
    ctx.attachShader(p, fs);
    ctx.linkProgram(p);
    ctx.deleteShader(vs);
    ctx.deleteShader(fs);
    if (!ctx.getProgramParameter(p, ctx.LINK_STATUS)) {
      const log = ctx.getProgramInfoLog(p);
      ctx.deleteProgram(p);
      throw new Error(log || 'link');
    }
    const u = {} as Uniformes;
    for (const n of NOMES_UNIFORMES) u[n] = ctx.getUniformLocation(p, n);
    ctx.useProgram(p);
    ctx.uniform1f(u.uThick, 0.48);
    ctx.uniform1f(u.uSoft, 0.89);
    ctx.uniform1f(u.uAlpha, 0.3);
    ctx.uniform1f(u.uSpeed, VELOCIDADE);
    ctx.uniform1f(u.uSpin, PERIODO_GIRO_S);
    ctx.uniform1f(u.uBoost, 1);
    ctx.uniform1f(u.uFade, 1); // a entrada e o fade de opacidade do CSS
    ctx.disable(ctx.BLEND);
    ctx.clearColor(0, 0, 0, 0);
    prog = p;
    U = u;
  };

  const soltar = () => {
    try {
      if (prog) ctx.deleteProgram(prog);
    } catch {}
    prog = null;
    try {
      ctx.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {}
  };

  try {
    prepararPrograma();
  } catch (err) {
    console.debug('[borda] fumaca indisponivel, usando a borda CSS:', err);
    soltar();
    return null;
  }

  const estilo = document.createElement('style');
  estilo.textContent = CSS_FUMACA;
  const raiz = document.createElement('div');
  raiz.id = 'agent-borda';
  raiz.appendChild(canvas);
  shadow.append(estilo, raiz);

  const movimentoReduzido = window.matchMedia('(prefers-reduced-motion: reduce)');
  let vivo = true;
  let perdido = false;
  let escondido = false; // pausar(): screenshot
  let raf = 0;
  let ultimoQuadro = 0;
  let t = T_INICIAL; // tempo de animacao em segundos
  let ultimoDesenho = 0;
  let escuroAlvo = escuroDoFundo();
  let escuroAgora = escuroAlvo;
  let ultimaLeituraFundo = performance.now();

  const desenhar = (tempo: number, escuro: number) => {
    if (!prog || perdido) return;
    ctx.uniform1f(U.uTime, tempo);
    ctx.uniform1f(U.uDark, escuro);
    ctx.drawArrays(ctx.TRIANGLES, 0, 3);
  };

  const dimensionar = () => {
    if (!prog || perdido) return;
    const W = Math.max(1, window.innerWidth);
    const H = Math.max(1, window.innerHeight);
    const escala = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, Math.sqrt(orcamento / (W * H))));
    const w = Math.max(2, Math.round(W * escala));
    const h = Math.max(2, Math.round(H * escala));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.viewport(0, 0, w, h);
    ctx.uniform2f(U.uRes, w, h);
    ctx.uniform1f(U.uScale, W / w); // px de CSS por pixel do buffer
    // Redimensionar limpa o canvas: repinta ja, para nao piscar nem ficar em branco.
    desenhar(movimentoReduzido.matches ? T_ESTATICO : t, escuroAgora);
  };

  const quadro = (agora: number) => {
    raf = requestAnimationFrame(quadro);
    const dt = ultimoQuadro ? Math.min((agora - ultimoQuadro) / 1000, 0.25) : 0;
    ultimoQuadro = agora;
    t += dt;
    if (agora - ultimaLeituraFundo > RELER_FUNDO_MS) {
      ultimaLeituraFundo = agora;
      escuroAlvo = escuroDoFundo();
    }
    escuroAgora += (escuroAlvo - escuroAgora) * (1 - Math.exp(-dt * 7.5));
    if (intervaloMs && agora - ultimoDesenho < intervaloMs) return; // limite de fps: pula este quadro
    ultimoDesenho = agora;
    desenhar(t, escuroAgora);
  };

  const podeAnimar = () =>
    vivo && !perdido && !escondido && !document.hidden && !movimentoReduzido.matches;
  const parar = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const iniciar = () => {
    if (raf || !podeAnimar()) return;
    ultimoQuadro = 0; // o tempo parado nao conta: a animacao continua de onde estava (congelada)
    raf = requestAnimationFrame(quadro);
  };
  /** Relê o fundo agora e repinta o quadro parado, se for o caso. */
  const reler = () => {
    escuroAlvo = escuroDoFundo();
    if (!raf) escuroAgora = escuroAlvo;
    if (!raf && vivo) desenhar(movimentoReduzido.matches ? T_ESTATICO : t, escuroAgora);
  };

  let redimPendente = 0;
  const aoRedimensionar = () => {
    if (redimPendente) return;
    redimPendente = requestAnimationFrame(() => {
      redimPendente = 0;
      if (vivo) dimensionar();
    });
  };
  const aoMudarVisibilidade = () => {
    if (document.hidden) {
      parar();
    } else {
      reler();
      iniciar();
    }
  };
  const aoMudarMovimento = () => {
    if (movimentoReduzido.matches) {
      parar();
      desenhar(T_ESTATICO, escuroAgora);
    } else {
      iniciar();
    }
  };
  const aoPerderContexto = (e: Event) => {
    e.preventDefault(); // deixa o navegador restaurar
    perdido = true;
    parar();
  };
  const aoRestaurarContexto = () => {
    try {
      prepararPrograma();
    } catch {
      return; // fica transparente; nao ha o que desenhar
    }
    perdido = false;
    dimensionar();
    iniciar();
  };

  window.addEventListener('resize', aoRedimensionar);
  document.addEventListener('visibilitychange', aoMudarVisibilidade);
  movimentoReduzido.addEventListener('change', aoMudarMovimento);
  canvas.addEventListener('webglcontextlost', aoPerderContexto);
  canvas.addEventListener('webglcontextrestored', aoRestaurarContexto);

  dimensionar(); // ja pinta um quadro
  iniciar();

  return {
    modo: 'fumaca',
    raiz,
    redimensionar() {
      if (!vivo) return;
      dimensionar();
      reler();
    },
    pausar() {
      escondido = true;
      parar();
    },
    retomar() {
      escondido = false;
      reler();
      iniciar();
    },
    destruir() {
      if (!vivo) return;
      vivo = false;
      parar();
      if (redimPendente) cancelAnimationFrame(redimPendente);
      redimPendente = 0;
      window.removeEventListener('resize', aoRedimensionar);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      movimentoReduzido.removeEventListener('change', aoMudarMovimento);
      canvas.removeEventListener('webglcontextlost', aoPerderContexto);
      canvas.removeEventListener('webglcontextrestored', aoRestaurarContexto);
      soltar();
      canvas.width = 1;
      canvas.height = 1;
      raiz.remove();
      estilo.remove();
    },
  };
}
