import { useEffect, useState } from 'react';
import { Wifi, WifiOff, KeyRound, Eraser, Check, Users, Fingerprint, OctagonX, Play, BellRing, ListChecks, Gauge } from 'lucide-react';

/** Mascara o token, mostrando so os ultimos 4 caracteres. */
function mascarar(token: string): string {
  if (token.length <= 4) return '•'.repeat(token.length);
  return '•'.repeat(token.length - 4) + token.slice(-4);
}

/** Corta texto no tamanho n, com reticencias. Nunca mostra a URL inteira de aba do usuario. */
function cortar(s: string | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** "há 5 s", "há 3 min", "há 2 h". Recalculado a cada poll de 2 s, sem timer proprio. */
function haQuanto(quandoMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - quandoMs) / 1000));
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  return `há ${Math.floor(s / 3600)} h`;
}

function duracao(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0).replace('.', ',')} s`;
}

/** 598558 -> "599 mil"; 1250000 -> "1,3 mi". */
function tokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace('.', ',')} mil`;
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi`;
}

const milhar = (n: number) => n.toLocaleString('pt-BR');

interface AgentePainel {
  clientId: string;
  nome: string;
  tabId?: number;
  titulo?: string;
  site?: string;
  modo?: 'leitura' | 'acao';
  ultimoComandoEm?: number;
  ultimaAcao?: { acao: string; ok: boolean; quando: number; erro?: string };
  bloqueado: boolean;
}

interface AcaoRecente {
  quando: number;
  clientId: string;
  agente?: string;
  acao: string;
  ok: boolean;
  ms: number;
  site?: string;
  erro?: string;
}

interface Periodo {
  chamadas: number;
  chars: number;
  tokens_texto: number;
  prints: number;
  tokens_imagem: number;
  tokens: number;
}

interface ConsumoServidor {
  hoje: Periodo;
  sete_dias: Periodo;
  mes_atual: Periodo;
  mes_anterior: Periodo;
  top_tools_7d: Array<Periodo & { tool: string }>;
  erro?: string;
}

interface Painel {
  extensaoOnline: boolean;
  janelaDaPonte?: number;
  bloqueados: number;
  agentes: AgentePainel[];
  recentes: AcaoRecente[];
  consumo: {
    servidor: ConsumoServidor | null;
    sites: Array<{ site: string; chars: number; prints: number; tokens: number }>;
  };
  avisosLigados: boolean;
}

/**
 * Botao grande "Parar tudo". Dois cliques para nao disparar por engano e sem
 * dialogo: o primeiro arma o botao (4 s), o segundo para de fato. Depois da
 * parada os agentes ficam barrados ate o usuário apertar "Liberar agentes".
 */
function BotaoPararTudo({ bloqueados, aoMudar }: { bloqueados: number; aoMudar: () => void }) {
  const [armado, setArmado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  useEffect(() => {
    if (!armado) return;
    const t = setTimeout(() => setArmado(false), 4000);
    return () => clearTimeout(t);
  }, [armado]);

  const clicar = () => {
    if (!armado) {
      setArmado(true);
      return;
    }
    setArmado(false);
    setEnviando(true);
    chrome.runtime.sendMessage({ type: 'PONTE_PARAR_TUDO' }, (res) => {
      setEnviando(false);
      if (chrome.runtime.lastError || !res?.ok) {
        setResultado(`Erro ao parar: ${res?.error ?? chrome.runtime.lastError?.message ?? 'extensão fora do ar'}`);
        return;
      }
      setResultado(
        `Parado: ${res.interrompidos} comando(s) interrompido(s), ${res.abasFechadas} aba(s) da ponte fechada(s), `
        + `${res.debuggersSoltos} debugger(s) solto(s).`,
      );
      aoMudar();
    });
  };

  const liberar = () => {
    chrome.runtime.sendMessage({ type: 'PONTE_LIBERAR' }, () => {
      void chrome.runtime.lastError;
      setResultado(null);
      aoMudar();
    });
  };

  return (
    <section className="mb-3">
      <button
        type="button"
        className="btn-parar flex items-center justify-center gap-2"
        data-armado={armado}
        aria-pressed={armado}
        aria-label={enviando ? 'Parando' : armado ? 'Clique de novo para parar tudo' : 'Parar tudo'}
        onClick={clicar}
        disabled={enviando}
      >
        <OctagonX size={20} aria-hidden="true" />
        {enviando ? 'Parando…' : armado ? 'Clique de novo para PARAR TUDO' : 'Parar tudo'}
      </button>
      <div role="status" aria-live="polite">
        {resultado && <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">{resultado}</p>}
      </div>
      {bloqueados > 0 && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-[#7f1d1d] bg-[#2a0f0d] p-2">
          <p className="text-[11px] text-[#fecaca]">
            {bloqueados} agente(s) barrado(s): recebem “parado pelo usuário” em qualquer comando.
          </p>
          <button
            type="button"
            onClick={liberar}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 py-1.5 text-xs font-semibold text-black hover:bg-[var(--primary-hover)]"
          >
            <Play size={12} /> Liberar agentes
          </button>
        </div>
      )}
    </section>
  );
}

function Barra({ valor, max }: { valor: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((valor / max) * 100)) : 0;
  return (
    <div className="mt-0.5 h-1 overflow-hidden rounded bg-[var(--surface-high)]">
      <div className="h-full rounded bg-gradient-to-r from-[var(--primary)] to-[var(--amber)]" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Consumo da PONTE: o que ela devolveu aos agentes (texto = caracteres / 4; print =
 * largura x altura / 750). Nao e o gasto total do Claude. Totais e tools vem do servidor
 * (medicao.jsonl); sites, da extensao (bruto, antes do servidor enxugar a leitura).
 */
function ConsumoDaPonte({ painel }: { painel: Painel | null }) {
  const srv = painel?.consumo.servidor ?? null;
  const sites = painel?.consumo.sites ?? [];
  const linhas: Array<[string, Periodo]> = srv && !srv.erro
    ? [['Hoje', srv.hoje], ['7 dias', srv.sete_dias], ['Mês atual', srv.mes_atual], ['Mês anterior', srv.mes_anterior]]
    : [];
  const maxSite = Math.max(0, ...sites.map((x) => x.tokens));
  const maxTool = Math.max(0, ...(srv?.top_tools_7d ?? []).map((x) => x.tokens));

  return (
    <section className="card mb-3 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <Gauge size={14} className="text-[var(--amber)]" />
        <p className="text-xs font-semibold text-white">Consumo da ponte</p>
      </div>
      <p className="mb-2 rounded border border-[var(--border-subtle)] bg-[var(--primary-subtle)] px-2 py-1 text-[10px] leading-snug text-[var(--amber)]">
        É o que a ponte devolveu aos agentes, não o gasto total do Claude. Tokens estimados: texto = caracteres ÷ 4;
        print = largura × altura ÷ 750.
      </p>

      {painel === null ? (
        <p className="text-xs text-[var(--text-muted)]">verificando…</p>
      ) : linhas.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">
          {srv?.erro ? `servidor não leu a medição: ${srv.erro}` : 'sem resposta do servidor (medição indisponível)'}
        </p>
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-[10px] text-[var(--text-muted)]">
              <th className="pb-1 font-medium">Período</th>
              <th className="pb-1 text-right font-medium">Chamadas</th>
              <th className="pb-1 text-right font-medium">Caracteres</th>
              <th className="pb-1 text-right font-medium">Prints</th>
              <th className="pb-1 text-right font-medium">Tokens ~</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(([nome, p]) => (
              <tr key={nome} className="border-t border-[var(--border-subtle)]">
                <td className="py-1 text-[var(--text-secondary)]">{nome}</td>
                <td className="py-1 text-right">{milhar(p.chamadas)}</td>
                <td className="py-1 text-right">{tokens(p.chars)}</td>
                <td className="py-1 text-right">{milhar(p.prints)}</td>
                <td className="py-1 text-right font-semibold text-[var(--amber)]">{tokens(p.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mb-1 mt-3 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        Top 5 sites · 7 dias <span className="normal-case">(bruto da extensão)</span>
      </p>
      {sites.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">nenhum ainda (sites de teste locais não contam)</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sites.map((x) => (
            <li key={x.site} className="text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="truncate text-[var(--text)]">{x.site}</span>
                <span className="shrink-0 text-[var(--amber)]">{tokens(x.tokens)}{x.prints ? ` · ${x.prints} print${x.prints > 1 ? 's' : ''}` : ''}</span>
              </div>
              <Barra valor={x.tokens} max={maxSite} />
            </li>
          ))}
        </ul>
      )}

      <p className="mb-1 mt-3 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Top 5 tools · 7 dias</p>
      {!srv || srv.erro || srv.top_tools_7d.length === 0 ? (
        <p className="text-[11px] text-[var(--text-muted)]">nenhuma ainda</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {srv.top_tools_7d.map((x) => (
            <li key={x.tool} className="text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="truncate text-[var(--text)]">{x.tool}</span>
                <span className="shrink-0 text-[var(--amber)]">{tokens(x.tokens)} · {milhar(x.chamadas)}×</span>
              </div>
              <Barra valor={x.tokens} max={maxTool} />
            </li>
          ))}
        </ul>
      )}
      <ZerarContadores />
    </section>
  );
}

/** Botao discreto no fim do card Consumo: 2 cliques; o servidor arquiva o jsonl com a data, a extensao limpa os dela. */
function ZerarContadores() {
  const [armado, setArmado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!armado) return;
    const t = setTimeout(() => setArmado(false), 4000);
    return () => clearTimeout(t);
  }, [armado]);
  const clicar = () => {
    if (!armado) { setArmado(true); return; }
    setArmado(false);
    chrome.runtime.sendMessage({ type: 'PONTE_ZERAR_CONTADORES' }, (res) => {
      setMsg(chrome.runtime.lastError || !res?.ok ? 'Não consegui zerar.' : 'Contadores zerados (histórico arquivado).');
    });
  };
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
      <span role="status" aria-live="polite" className="text-[10px] text-[var(--text-muted)]">{msg}</span>
      <button
        type="button"
        onClick={clicar}
        aria-pressed={armado}
        className="shrink-0 text-[10px] text-[var(--text-muted)] underline decoration-dotted hover:text-white"
      >
        {armado ? 'Clique de novo para zerar' : 'Zerar contadores'}
      </button>
    </div>
  );
}

/** Liga/desliga o aviso do Windows quando um agente fica esperando o usuário (chrome.storage.local.avisosEspera). */
function AvisosDoWindows() {
  const [ligado, setLigado] = useState(true);
  useEffect(() => {
    chrome.storage.local.get('avisosEspera', (res) => setLigado(res.avisosEspera !== false));
  }, []);
  const trocar = (v: boolean) => {
    setLigado(v);
    chrome.storage.local.set({ avisosEspera: v });
  };
  return (
    <section className="card mb-3 p-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={ligado}
          onChange={(e) => trocar(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-xs font-medium text-white">
            <BellRing size={14} className="text-[var(--amber)]" /> Avisar no Windows quando o agente esperar por mim
          </span>
          <span className="mt-0.5 block text-[10px] text-[var(--text-muted)]">
            Captcha, ação que pede minha confirmação, login sem senha. No máximo 1 aviso por aba a cada 2 minutos;
            clicar traz a aba à frente.
          </span>
        </span>
      </label>
    </section>
  );
}

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [tokenSalvo, setTokenSalvo] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [editandoToken, setEditandoToken] = useState(false);
  const [perfilSalvo, setPerfilSalvo] = useState('');
  const [perfilInput, setPerfilInput] = useState('');
  const [editandoPerfil, setEditandoPerfil] = useState(false);
  const [perfilSalvoOk, setPerfilSalvoOk] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [limpando, setLimpando] = useState(false);
  const [resultadoLimpeza, setResultadoLimpeza] = useState<string | null>(null);
  const [painel, setPainel] = useState<Painel | null>(null);

  // Token salvo em chrome.storage.local
  useEffect(() => {
    chrome.storage.local.get('bridgeToken', (res) => {
      const t = (res.bridgeToken as string | undefined) ?? '';
      setTokenSalvo(t);
      setTokenInput(t);
    });
  }, []);

  // Perfil salvo em chrome.storage.local — vazio significa "padrao" (o que ja
  // existia antes de perfis multiplos; nada muda para quem nao mexer aqui).
  useEffect(() => {
    chrome.storage.local.get('bridgePerfil', (res) => {
      const p = (res.bridgePerfil as string | undefined) ?? '';
      setPerfilSalvo(p);
      setPerfilInput(p);
    });
  }, []);

  // Status da ponte — o bridge manda BRIDGE_STATUS ao conectar/desconectar.
  // Reconectou ou caiu: tambem pede o estado dos agentes na hora, sem esperar
  // o proximo tick do polling de 2s.
  useEffect(() => {
    const handler = (msg: { type: string; online?: boolean }) => {
      if (msg.type === 'BRIDGE_STATUS' && typeof msg.online === 'boolean') {
        setOnline(msg.online);
        pedirEstadoDosAgentes();
      }
    };
    try {
      chrome.runtime.onMessage.addListener(handler);
    } catch {
      return;
    }
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(handler);
      } catch { /* contexto pode ja ter sumido */ }
    };
  }, []);

  // Painel "Agentes agora" — poll a cada 2s enquanto o sidepanel estiver
  // aberto. O useEffect so vive enquanto o componente vive: fechar o painel
  // desmonta e o clearInterval para o polling sozinho.
  function pedirEstadoDosAgentes(): void {
    chrome.runtime.sendMessage({ type: 'PONTE_PAINEL' }, (res: Painel | undefined) => {
      if (chrome.runtime.lastError) return; // extensao dormindo/fora do ar: mantem o ultimo estado
      if (res && Array.isArray(res.agentes)) setPainel(res);
    });
  }

  useEffect(() => {
    // Ponte em repouso (hub fora do ar): abrir o painel tenta reconectar na hora.
    chrome.runtime.sendMessage({ type: 'PONTE_RECONECTAR' }, () => { void chrome.runtime.lastError; });
    pedirEstadoDosAgentes();
    const intervalo = setInterval(pedirEstadoDosAgentes, 2000);
    return () => clearInterval(intervalo);
  }, []);

  // O estado do painel (poll de 2 s) tambem diz se a extensao esta ligada ao hub: vale quando o BRIDGE_STATUS ainda nao chegou.
  const conectado = online ?? painel?.extensaoOnline ?? null;

  const handleSalvarToken = () => {
    chrome.storage.local.set({ bridgeToken: tokenInput.trim() }, () => {
      setTokenSalvo(tokenInput.trim());
      setEditandoToken(false);
      setSalvo(true);
      setTimeout(() => setSalvo(false), 1500);
    });
  };

  const handleSalvarPerfil = () => {
    const nome = perfilInput.trim();
    chrome.storage.local.set({ bridgePerfil: nome }, () => {
      setPerfilSalvo(nome);
      setEditandoPerfil(false);
      setPerfilSalvoOk(true);
      setTimeout(() => setPerfilSalvoOk(false), 1500);
    });
  };

  const handleLimparGrupos = () => {
    setLimpando(true);
    setResultadoLimpeza(null);
    chrome.runtime.sendMessage({ type: 'LIMPAR_GRUPOS' }, (res) => {
      setLimpando(false);
      if (chrome.runtime.lastError) {
        setResultadoLimpeza('Erro: extensão fora do ar. Recarregue a página.');
        return;
      }
      if (res?.ok) {
        setResultadoLimpeza(
          res.fechadas > 0
            ? `${res.fechadas} aba(s) fechada(s).`
            : 'Nenhum grupo da ponte encontrado.',
        );
      } else {
        setResultadoLimpeza(`Erro: ${res?.error ?? 'falha desconhecida'}`);
      }
    });
  };

  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-[var(--surface)] p-4 text-[var(--text)]">
      <header className="mb-4 flex items-center gap-3">
        <img src="/logo/T-animado.svg" alt="" width={36} height={36} className="h-9 w-9 shrink-0" />
        <div>
          <h1 className="text-sm font-semibold text-white">PraxedesIA — Ponte</h1>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Diagnóstico da extensão. A automação roda pelo agente externo (Claude Code, OpenCode, Codex).
          </p>
        </div>
      </header>

      <BotaoPararTudo bloqueados={painel?.bloqueados ?? 0} aoMudar={pedirEstadoDosAgentes} />

      {/* Status da conexão */}
      <section className="card mb-3 flex items-center gap-3 p-3">
        {conectado ? (
          <Wifi size={18} className="shrink-0 text-emerald-400" />
        ) : (
          <WifiOff size={18} className="shrink-0 text-[var(--text-muted)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">
            {conectado === null ? 'Verificando…' : conectado ? 'Conectada ao hub' : 'Desconectada'}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {conectado
              ? 'Pronta para receber comandos do agente.'
              : 'Sem hub em ws://127.0.0.1:8789 ou sem token válido.'}
          </p>
        </div>
      </section>

      {/* (a) Agentes conectados */}
      <section className="card mb-3 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-[var(--amber)]" />
            <p className="text-xs font-semibold text-white">Agentes conectados</p>
            {painel && painel.agentes.length > 0 && (
              <span className="rounded bg-[var(--primary)] px-1.5 text-[10px] font-bold text-black">{painel.agentes.length}</span>
            )}
          </div>
        </div>

        {painel === null ? (
          <p className="text-xs text-[var(--text-muted)]">verificando…</p>
        ) : !painel.extensaoOnline ? (
          <p className="text-xs text-[var(--text-muted)]">reconectando…</p>
        ) : painel.agentes.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">nenhum agente conectado</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {painel.agentes.map((a) => (
              <li key={a.clientId} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface)] p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-white">{a.nome}</span>
                  {a.bloqueado ? (
                    <span className="shrink-0 rounded bg-[#7f1d1d] px-1.5 py-0.5 text-[10px] font-medium text-[#fecaca]">parado</span>
                  ) : a.modo ? (
                    <span
                      className={
                        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium '
                        + (a.modo === 'acao' ? 'bg-[var(--primary-subtle)] text-[var(--amber)]' : 'bg-emerald-500/15 text-emerald-300')
                      }
                    >
                      {a.modo === 'acao' ? 'ação' : 'leitura'}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-[var(--text-muted)]">sem aba</span>
                  )}
                </div>
                <p className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
                  {a.tabId !== undefined ? `aba #${a.tabId} · ${cortar(a.site, 28) || cortar(a.titulo, 28) || '(sem título)'}` : 'ainda não abriu aba'}
                </p>
                {a.ultimaAcao ? (
                  <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]" title={a.ultimaAcao.erro ? cortar(a.ultimaAcao.erro, 80) : undefined}>
                    <span className={a.ultimaAcao.ok ? 'text-[var(--ok)]' : 'text-[var(--perigo)]'}>{a.ultimaAcao.ok ? '✓' : '✗'}</span>{' '}
                    {a.ultimaAcao.acao} · {haQuanto(a.ultimaAcao.quando)}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">nenhum comando ainda</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* (b) Ultimas 10 acoes */}
      <section className="card mb-3 p-3">
        <div className="mb-2 flex items-center gap-2">
          <ListChecks size={14} className="text-[var(--amber)]" />
          <p className="text-xs font-semibold text-white">Últimas 10 ações</p>
        </div>
        {!painel || painel.recentes.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">nada ainda</p>
        ) : (
          <ul className="flex flex-col">
            {painel.recentes.map((r, i) => (
              <li
                key={`${r.quando}-${i}`}
                className="flex items-center gap-2 border-b border-[var(--border-subtle)] py-1 text-[11px] last:border-b-0"
                title={r.erro ? cortar(r.erro, 120) : undefined}
              >
                <span className={'w-3 shrink-0 text-center ' + (r.ok ? 'text-[var(--ok)]' : 'text-[var(--perigo)]')}>{r.ok ? '✓' : '✗'}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-[var(--text)]">{r.acao}</span>
                  <span className="text-[var(--text-muted)]"> · {cortar(r.agente, 14) || 'agente'}{r.site ? ` · ${cortar(r.site, 18)}` : ''}</span>
                </span>
                <span className="shrink-0 font-mono text-[var(--amber)]">{duracao(r.ms)}</span>
                <span className="w-12 shrink-0 text-right text-[var(--text-muted)]">{haQuanto(r.quando).replace('há ', '')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* (c) Consumo da ponte */}
      <ConsumoDaPonte painel={painel} />

      <AvisosDoWindows />

      {/* Token de pareamento */}
      <section className="card mb-3 p-3">
        <div className="mb-2 flex items-center gap-2">
          <KeyRound size={14} className="text-[var(--text-secondary)]" />
          <p className="text-xs font-medium text-white">Token de pareamento</p>
        </div>

        {editandoToken ? (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Cole o token aqui…"
              autoFocus
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-high)] px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSalvarToken}
                disabled={!tokenInput.trim()}
                className="flex-1 rounded-lg bg-[var(--primary)] py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--primary-hover)] disabled:bg-[var(--surface-high)] disabled:text-[var(--text-muted)]"
              >
                Salvar
              </button>
              <button
                onClick={() => { setTokenInput(tokenSalvo); setEditandoToken(false); }}
                className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-high)]"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs text-[var(--text-secondary)]">
              {tokenSalvo ? mascarar(tokenSalvo) : 'nenhum token salvo'}
            </span>
            <button
              onClick={() => setEditandoToken(true)}
              className="shrink-0 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 text-xs text-[var(--primary)] hover:bg-[var(--surface-high)]"
            >
              {tokenSalvo ? 'Trocar' : 'Colar token'}
            </button>
          </div>
        )}

        {salvo && (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-emerald-400">
            <Check size={10} /> token salvo
          </p>
        )}
      </section>

      {/* Nome do perfil (perfis multiplos do Chrome) */}
      <section className="card mb-3 p-3">
        <div className="mb-2 flex items-center gap-2">
          <Fingerprint size={14} className="text-[var(--text-secondary)]" />
          <p className="text-xs font-medium text-white">Nome deste perfil</p>
        </div>
        <p className="mb-2 text-[10px] text-[var(--text-muted)]">
          Como o agente chama este Chrome quando existe mais de um perfil conectado (ex.: "trabalho").
          Vazio = "padrao" (o de sempre).
        </p>

        {editandoPerfil ? (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={perfilInput}
              onChange={(e) => setPerfilInput(e.target.value)}
              placeholder="padrao"
              autoFocus
              className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-high)] px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSalvarPerfil}
                className="flex-1 rounded-lg bg-[var(--primary)] py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--primary-hover)]"
              >
                Salvar
              </button>
              <button
                onClick={() => { setPerfilInput(perfilSalvo); setEditandoPerfil(false); }}
                className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-high)]"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs text-[var(--text-secondary)]">
              {perfilSalvo || 'padrao'}
            </span>
            <button
              onClick={() => setEditandoPerfil(true)}
              className="shrink-0 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1 text-xs text-[var(--primary)] hover:bg-[var(--surface-high)]"
            >
              Trocar
            </button>
          </div>
        )}

        {perfilSalvoOk && (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-emerald-400">
            <Check size={10} /> perfil salvo — recarregue a extensao para valer
          </p>
        )}
      </section>

      {/* Limpar grupos */}
      <section className="card p-3">
        <button
          onClick={handleLimparGrupos}
          disabled={limpando}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-high)] hover:text-white disabled:opacity-50"
        >
          <Eraser size={14} />
          {limpando ? 'Limpando…' : 'Limpar grupos da ponte'}
        </button>
        <div role="status" aria-live="polite">
          {resultadoLimpeza && (
            <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">{resultadoLimpeza}</p>
          )}
        </div>
      </section>

      <footer className="mt-auto pt-3 text-center text-[10px] text-[var(--text-muted)]">
        praxedes-ia · modo ponte
      </footer>
    </div>
  );
}
