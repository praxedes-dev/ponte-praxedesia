import { useEffect, useState } from 'react';
import { Wifi, WifiOff, KeyRound, Eraser, Check, Users, Fingerprint } from 'lucide-react';

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

/** "ha Ns" — recalculado a cada poll de 2s (PONTE_AGENTES), sem timer proprio. */
function haQuanto(quandoMs: number): string {
  const s = Math.max(0, Math.round((Date.now() - quandoMs) / 1000));
  return `há ${s}s`;
}

interface UltimaAcaoAgente {
  acao: string;
  ok: boolean;
  quando: number;
  erro?: string;
}

interface AgenteInfo {
  clientId: string;
  nome?: string;
  tabId?: number;
  titulo?: string;
  url?: string;
  modo: 'leitura' | 'acao';
  ultimoComandoEm?: number;
  ultimaAcao?: UltimaAcaoAgente;
}

interface EstadoAgentes {
  agentes: AgenteInfo[];
  janelaDaPonte?: number;
  extensaoOnline: boolean;
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
  const [estadoAgentes, setEstadoAgentes] = useState<EstadoAgentes | null>(null);

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
    chrome.runtime.sendMessage({ type: 'PONTE_AGENTES' }, (res: EstadoAgentes | undefined) => {
      if (chrome.runtime.lastError) return; // extensao dormindo/fora do ar: mantem o ultimo estado
      if (res) setEstadoAgentes(res);
    });
  }

  useEffect(() => {
    pedirEstadoDosAgentes();
    const intervalo = setInterval(pedirEstadoDosAgentes, 2000);
    return () => clearInterval(intervalo);
  }, []);

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
    <div className="flex h-screen flex-col bg-[var(--surface)] p-4 text-[var(--text)]">
      <header className="mb-4">
        <h1 className="text-sm font-semibold text-white">PraxedesIA — Ponte</h1>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          Diagnóstico da extensão. A automação roda pelo agente externo (Claude Code, OpenCode, Codex).
        </p>
      </header>

      {/* Status da conexão */}
      <section className="card mb-3 flex items-center gap-3 p-3">
        {online ? (
          <Wifi size={18} className="shrink-0 text-emerald-400" />
        ) : (
          <WifiOff size={18} className="shrink-0 text-[var(--text-muted)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">
            {online === null ? 'Verificando…' : online ? 'Conectada ao hub' : 'Desconectada'}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            {online
              ? 'Pronta para receber comandos do agente.'
              : 'Sem hub em ws://127.0.0.1:8788 ou sem token válido.'}
          </p>
        </div>
      </section>

      {/* Agentes agora (obra 17) */}
      <section className="card mb-3 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-[var(--text-secondary)]" />
            <p className="text-xs font-medium text-white">Agentes agora</p>
          </div>
          {estadoAgentes?.janelaDaPonte !== undefined && (
            <span className="text-[10px] text-[var(--text-muted)]">
              janela da ponte #{estadoAgentes.janelaDaPonte}
            </span>
          )}
        </div>

        {estadoAgentes === null ? (
          <p className="text-xs text-[var(--text-muted)]">verificando…</p>
        ) : estadoAgentes.extensaoOnline === false ? (
          <p className="text-xs text-[var(--text-muted)]">reconectando…</p>
        ) : estadoAgentes.agentes.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">nenhum agente conectado</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {estadoAgentes.agentes.map((a) => (
              <li key={a.clientId} className="rounded-lg border border-[var(--border-subtle)] p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-white">{a.nome ?? a.clientId}</span>
                  <span
                    className={
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium '
                      + (a.modo === 'acao'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-300')
                    }
                  >
                    {a.modo === 'acao' ? 'ação' : 'leitura'}
                  </span>
                </div>
                <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">
                  {cortar(a.titulo, 40) || '(sem título)'}
                  {a.tabId !== undefined ? ` · #${a.tabId}` : ''}
                </p>
                {a.ultimaAcao && (
                  <p
                    className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]"
                    title={a.ultimaAcao.erro ? cortar(a.ultimaAcao.erro, 60) : undefined}
                  >
                    {a.ultimaAcao.acao} {a.ultimaAcao.ok ? '✓' : '✗'} · {haQuanto(a.ultimaAcao.quando)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

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
          Como o agente chama este Chrome quando existe mais de um perfil conectado (ex.: "escritorio").
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
        {resultadoLimpeza && (
          <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">{resultadoLimpeza}</p>
        )}
      </section>

      <footer className="mt-auto pt-3 text-center text-[10px] text-[var(--text-muted)]">
        praxedes-ia · modo ponte
      </footer>
    </div>
  );
}
