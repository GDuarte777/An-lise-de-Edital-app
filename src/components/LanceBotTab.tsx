import { useState, useEffect, useRef } from "react";
import { 
  Play, Square, HelpCircle, Sliders, AlertTriangle, TrendingDown, 
  Trash2, RefreshCw, Layers, ShieldAlert, ShieldCheck, Cpu, HeartPulse, 
  Terminal, MessageSquare, ChevronDown, Check, Sparkles, Clock, Info 
} from "lucide-react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend 
} from "recharts";
import { EditalAnalysis } from "../types";
import confetti from "canvas-confetti";

interface LanceBotTabProps {
  activeEdital: EditalAnalysis | null;
}

interface SimulatedLog {
  id: string;
  timestamp: string;
  type: "system" | "competitor" | "own" | "warning" | "success" | "chat";
  msg: string;
}

interface ChatMessageSimulated {
  id: string;
  sender: string;
  text: string;
  time: string;
}

interface ChartDataPoint {
  sec: number;
  "Menor Concorrente": number;
  "Nosso Lance": number;
}

const PREGOEIRO_PHRASES = [
  "Atenção licitantes, o item entrou na fase competitiva de lances de disputa aberta!",
  "Aviso: Licitantes que não enviarem documentos complementares serão desclassificados.",
  "Pregoeiro: Solicito redução de preço final para o arrematante do lote.",
  "Estou abrindo negociação com a melhor oferta para diminuir o valor unitário.",
  "Prorrogado o lote por mais 2 minutos devido às sucessivas ofertas inseridas nos últimos segundos."
];

export default function LanceBotTab({ activeEdital }: LanceBotTabProps) {
  const [editalHistory, setEditalHistory] = useState<any[]>([]);
  const [selectedEditalId, setSelectedEditalId] = useState<string>("");

  // Form states matching user requirements
  const [pregaoId, setPregaoId] = useState("2026042100002");
  const [itemNum, setItemNum] = useState("1");
  const [valorInicial, setValorInicial] = useState(1250.00);
  const [valorLimiteMinimo, setValorLimiteMinimo] = useState(850.00);
  const [tipoDecremento, setTipoDecremento] = useState<"fixo" | "percentual">("fixo");
  const [valorDecremento, setValorDecremento] = useState(15.00);
  const [intervaloMs, setIntervaloMs] = useState(15000); // Default to 15 seconds as requested by the user

  // Active status & Mode configuration
  const [isBotOn, setIsBotOn] = useState(false);
  const [isRealMode, setIsRealMode] = useState<boolean>(false);
  const [token, setToken] = useState<string>(() => localStorage.getItem("aip_comprasnet_token") || "");
  const [cookie, setCookie] = useState<string>(() => localStorage.getItem("aip_comprasnet_cookie") || "");
  const [lastSyncedFromExt, setLastSyncedFromExt] = useState<string>("");
  const [showExtGuide, setShowExtGuide] = useState<boolean>(false);

  // Advanced configurations for optimal bidding
  const [biddingStrategy, setBiddingStrategy] = useState<"imediato" | "cadenciado-15s" | "sniper" | "personalizado">("cadenciado-15s");
  const [modoAntiDetecao, setModoAntiDetecao] = useState<boolean>(true);
  const [coberturaGarantida] = useState<boolean>(true);

  // Auto-update timer interval when strategy changes
  useEffect(() => {
    if (biddingStrategy === "cadenciado-15s") {
      setIntervaloMs(15000);
    } else if (biddingStrategy === "imediato") {
      setIntervaloMs(1500);
    } else if (biddingStrategy === "sniper") {
      setIntervaloMs(5000); // 5 seconds interval for faster action under pressure
    }
  }, [biddingStrategy]);

  const [logs, setLogs] = useState<SimulatedLog[]>([
    {
      id: "1",
      timestamp: new Date().toLocaleTimeString("pt-BR"),
      type: "system",
      msg: "Robô de lances carregado. Pronto para conectar ao Compras.gov.br."
    }
  ]);

  // Alert safety
  const [margemEstourada, setMargemEstourada] = useState(false);

  // Real-time chart states
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [simulatedTimeSec, setSimulatedTimeSec] = useState(0);

  // Live pregoeiro chat list
  const [chatMessages, setChatMessages] = useState<ChatMessageSimulated[]>([
    {
      id: "c1",
      sender: "Pregoeiro Oficial",
      text: "Sejam bem-vindos à sala de disputa aberta. Verifiquem suas credenciais e documentos.",
      time: "10:14:15"
    }
  ]);

  const [competitorPriceState, setCompetitorPriceState] = useState<number>(1250.00);
  const [ourPriceState, setOurPriceState] = useState<number | null>(null);

  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  // Load edital history
  useEffect(() => {
    const saved = localStorage.getItem("aip_edital_history");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setEditalHistory(parsed);
      } catch (e) {
        console.error("Erro ao ler histórico de editais no robô:", e);
      }
    }
  }, []);

  // Persist token & cookie changes
  useEffect(() => {
    localStorage.setItem("aip_comprasnet_token", token);
  }, [token]);

  useEffect(() => {
    localStorage.setItem("aip_comprasnet_cookie", cookie);
  }, [cookie]);

  // Poll for extension session credentials sync
  useEffect(() => {
    let intv = setInterval(async () => {
      try {
        const res = await fetch("/api/session/current");
        if (res.ok) {
          const data = await res.json();
          if (data.token && data.token !== token) {
            setToken(data.token);
            if (data.cookie) setCookie(data.cookie);
            setLastSyncedFromExt(data.updatedAt || new Date().toLocaleTimeString("pt-BR"));
            pushLog(`⚡ Credenciais atualizadas automaticamente via Extensão do Chrome!`, "success");
          }
        }
      } catch (e: any) {
        // Log gently as a warning to prevent polluting platform error logs when offline or server is restarting
        console.warn("Erro de sincronização de credenciais da extensão (servidor offline ou reiniciando):", e?.message || e);
      }
    }, 2500);

    return () => clearInterval(intv);
  }, [token]);

  // Check if a bot job is already running on the server for the selected pregao + item
  useEffect(() => {
    const checkActiveBot = async () => {
      try {
        const res = await fetch(`/api/bot/status?pregaoId=${pregaoId}&itemNum=${itemNum}`);
        if (res.ok) {
          const data = await res.json();
          if (data.isActive) {
            setIsBotOn(true);
            setLogs(data.logs);
            setChartData(data.chartData);
            setCompetitorPriceState(data.currentCompetitorPrice);
            setOurPriceState(data.currentOurPrice);
            pushLog(`🔄 Sincronizado com o robô de lances em execução ativa no servidor.`, "success");
          }
        }
      } catch (e: any) {
        // Log gently as a warning
        console.warn("Erro ao sincronizar robô ativo:", e?.message || e);
      }
    };
    checkActiveBot();
  }, [pregaoId, itemNum]);

  // Update initial active edital
  useEffect(() => {
    if (activeEdital) {
      setSelectedEditalId("active");
      fillDataFromEdital(activeEdital);
    }
  }, [activeEdital]);

  const fillDataFromEdital = (ed: any) => {
    if (!ed) return;
    const certNum = ed.identificacaoCertame?.numeroCertame || "";
    const buyer = ed.identificacaoCertame?.orgaoComprador || "";
    if (certNum) {
      // clean punctuation for ID
      setPregaoId(certNum.replace(/\D/g, "") || "2026110904321");
    }
    // Estimate initial budget if present
    setValorInicial(1300.00);
    setValorLimiteMinimo(880.00);
    
    // Add log
    pushLog(`Dados pré-carregados a partir do edital: ${buyer.substring(0, 35)}...`, "system");
  };

  const handleSelectEditalChange = (id: string) => {
    setSelectedEditalId(id);
    if (id === "active") {
      fillDataFromEdital(activeEdital);
    } else if (id) {
      const selectedItem = editalHistory.find(h => h.id === id || h.timestamp === id);
      if (selectedItem) {
        fillDataFromEdital(selectedItem.analysis || selectedItem);
      }
    }
  };

  // Helper to add log
  const pushLog = (msg: string, type: "system" | "competitor" | "own" | "warning" | "success" | "chat") => {
    const timestamp = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(prev => [
      ...prev,
      {
        id: `log-${Date.now()}-${Math.random()}`,
        timestamp,
        type,
        msg
      }
    ]);
  };

  // Autoscrolling handlers for console logs and chat messages
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTo({
        top: logsContainerRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [logs]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [chatMessages]);

  // Main polling engine to sync with background server-side bot state
  useEffect(() => {
    let pollInterval: any = null;

    if (isBotOn) {
      const syncStatus = async () => {
        try {
          const res = await fetch(`/api/bot/status?pregaoId=${pregaoId}&itemNum=${itemNum}`);
          if (res.ok) {
            const data = await res.json();
            
            if (data.logs && data.logs.length > 0) {
              setLogs(data.logs);
            }
            if (data.chartData && data.chartData.length > 0) {
              setChartData(data.chartData);
            }
            if (data.currentCompetitorPrice !== undefined) {
              setCompetitorPriceState(data.currentCompetitorPrice);
            }
            if (data.currentOurPrice !== undefined) {
              setOurPriceState(data.currentOurPrice);
            }

            // If backend bot stopped itself (like safety margins hit or token expired)
            if (data.isActive === false && isBotOn) {
              setIsBotOn(false);
              setMargemEstourada(true);
              confetti({ particleCount: 45, spread: 60, colors: ["#ef4444", "#f87171"] });
            }
          }
        } catch (e: any) {
          console.warn("Erro ao sincronizar com servidor de lances (servidor offline ou reiniciando):", e?.message || e);
        }
      };

      syncStatus();
      pollInterval = setInterval(syncStatus, Math.max(1200, intervaloMs));
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [isBotOn, pregaoId, itemNum, intervaloMs]);

  // Start or Stop the server-side bot
  const toggleBot = async () => {
    if (!isBotOn) {
      // Validate inputs for live mode
      if (isRealMode && !token) {
        pushLog("⚠️ ERRO: Para o Modo Produção Real, você precisa informar seu Token de Autorização Compras.gov.br!", "warning");
        alert("Por favor, cole seu Token de Autorização Compras.gov.br para iniciar os lances ao vivo.");
        return;
      }

      setMargemEstourada(false);
      setChartData([{ sec: 0, "Menor Concorrente": valorInicial, "Nosso Lance": valorInicial }]);
      setCompetitorPriceState(valorInicial);
      setOurPriceState(valorInicial);

      try {
        const res = await fetch("/api/bot/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pregaoId,
            itemNum,
            valorInicial,
            valorLimiteMinimo,
            tipoDecremento,
            valorDecremento,
            intervaloMs,
            isRealMode,
            token,
            cookie,
            biddingStrategy,
            modoAntiDetecao
          })
        });

        const data = await res.json();
        if (res.ok) {
          setIsBotOn(true);
          pushLog(data.message || "Robô de lances iniciado com sucesso no servidor!", "success");
        } else {
          pushLog(`❌ Erro do servidor ao ligar robô: ${data.error}`, "warning");
        }
      } catch (e: any) {
        pushLog(`❌ Falha na conexão com o servidor de lances: ${e.message}`, "warning");
      }
    } else {
      // Stop the server-side bot
      try {
        const res = await fetch("/api/bot/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pregaoId, itemNum })
        });

        const data = await res.json();
        if (res.ok) {
          setIsBotOn(false);
          pushLog(data.message || "Robô de lances suspenso no servidor.", "warning");
        } else {
          pushLog(`❌ Erro do servidor ao desligar robô: ${data.error}`, "warning");
        }
      } catch (e: any) {
        pushLog(`❌ Falha de rede ao parar robô: ${e.message}`, "warning");
      }
    }
  };

  const handleClearLogs = () => {
    // If bot is active, don't clear serverside logs but clean frontend states
    setLogs([
      {
        id: `init-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString("pt-BR"),
        type: "system",
        msg: "Terminal limpo. Robô pronto."
      }
    ]);
  };

  return (
    <div className="space-y-6 animate-fade-in font-sans">
      
      {/* Upper overview and informative banners */}
      <div className="bg-gradient-to-r from-[#172554] to-[#1e1b4b] border border-blue-500/20 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 h-full w-1/3 bg-radial bg-gradient-to-l from-indigo-500/10 to-transparent pointer-events-none" />
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1 md:max-w-2xl">
            <span className="bg-indigo-500/20 text-indigo-300 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest border border-indigo-400/20 inline-flex items-center gap-1.5 mb-2">
              <Cpu className="w-3 h-3 animate-spin" />
              mecanismo rpa lances assíncronos
            </span>
            <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
              Robô de Lances Automáticos (Compras.gov.br)
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed font-normal">
              Painel operacional moderno para disputas de lances no portal oficial. Ele conjuga os coeficientes
              de inteligência do repositório <strong className="text-slate-100 font-semibold">LanceBot</strong> com as conexões resilientes assíncronas
              do <strong className="text-slate-100 font-semibold">python-comprasnet</strong>.
            </p>
          </div>
          
          {/* Quick Select Edital Context */}
          <div className="bg-slate-900/60 border border-white/10 p-3.5 rounded-xl flex flex-col gap-1.5 shrink-0 w-full md:w-80 backdrop-blur-sm select-none">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              Importar Margens de Edital:
            </span>
            <select
              value={selectedEditalId}
              onChange={(e) => handleSelectEditalChange(e.target.value)}
              className="bg-slate-950 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full"
            >
              <option value="">Não importar (Configurar Manual)</option>
              {activeEdital && (
                <option value="active">
                  ★ Edital Ativo em Memória
                </option>
              )}
              {editalHistory.map((item, idx) => {
                const ed = item.analysis || item;
                const org = ed.identificacaoCertame?.orgaoComprador || `Edital #${idx + 1}`;
                return (
                  <option key={item.id || item.timestamp || idx} value={item.id || item.timestamp}>
                    {org.substring(0, 30)}...
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      {/* Main operational Cockpit view */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: CRITICAL CONFIGURATION CONSOLE & STATE CONTROLS */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-5 shadow-lg backdrop-blur-md select-none">
            <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-2 border-b border-white/5 pb-3">
              <Sliders className="w-4.5 h-4.5" />
              Parâmetros de Operação
            </h3>

            {/* MODE SWITCHER */}
            <div className="flex bg-slate-900/80 p-1 rounded-xl border border-white/5 select-none">
              <button
                type="button"
                onClick={() => setIsRealMode(false)}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                  !isRealMode 
                    ? "bg-indigo-600 text-white shadow-md" 
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                🛡️ Modo Sandbox (Simulado)
              </button>
              <button
                type="button"
                onClick={() => setIsRealMode(true)}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                  isRealMode 
                    ? "bg-rose-600 text-white shadow-md" 
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                🚨 Compras.gov.br (Real)
              </button>
            </div>

            {/* REAL PORTAL CREDENTIALS FORM */}
            {isRealMode && (
              <div className="bg-slate-950/80 border border-rose-500/20 rounded-xl p-3 space-y-3 animate-fade-in text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Credenciais da Sessão Compras.gov.br
                  </span>
                  
                  <button
                    type="button"
                    onClick={() => setShowExtGuide(!showExtGuide)}
                    className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 transition-all cursor-pointer bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/25"
                  >
                    🔌 {showExtGuide ? "Fechar Tutorial" : "Usar Extensão Chrome"}
                  </button>
                </div>

                {lastSyncedFromExt && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-2 rounded-lg text-[10px] flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    <strong>✓ Sincronizado automaticamente via Extensão do Chrome às {lastSyncedFromExt}!</strong>
                  </div>
                )}

                {showExtGuide ? (
                  <div className="bg-slate-900/60 p-3 rounded-lg space-y-3 text-[11px] leading-relaxed text-slate-300">
                    <p className="font-bold text-white text-xs border-b border-white/5 pb-1.5">
                      Guia de Instalação da Extensão (Rápido & Local)
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Como o Comprasnet possui anti-bot robusto, a extensão captura seu login de forma automática e segura para enviar ao painel.
                    </p>
                    <ol className="list-decimal list-inside space-y-1.5 text-slate-300 font-normal">
                      <li>Crie uma pasta chamada <code className="text-indigo-400 font-mono bg-slate-950 px-1 py-0.5 rounded">lancebot-extensao</code> no seu computador.</li>
                      <li>Crie os arquivos abaixo dentro dessa pasta:</li>
                    </ol>

                    <div className="space-y-2 border-t border-white/5 pt-2">
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-400 font-mono">1. manifest.json</span>
                        <div className="bg-slate-950 rounded-lg p-2 font-mono text-[9px] overflow-x-auto max-h-32 text-slate-300">
{`{
  "manifest_version": 3,
  "name": "LanceBot Pro - Capturador",
  "version": "1.0.0",
  "permissions": ["webRequest", "storage", "cookies"],
  "host_permissions": [
    "https://*.comprasnet.gov.br/*",
    "https://*.compras.gov.br/*",
    "http://localhost:3000/*",
    "https://*.run.app/*"
  ],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" }
}`}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-400 font-mono">2. background.js</span>
                        <div className="bg-slate-950 rounded-lg p-2 font-mono text-[9px] overflow-x-auto max-h-32 text-slate-300">
{`chrome.webRequest.onBeforeSendHeaders.addListener(
  function(details) {
    if (details.requestHeaders) {
      let token = null;
      for (let header of details.requestHeaders) {
        if (header.name.toLowerCase() === 'authorization') {
          token = header.value;
          break;
        }
      }
      if (token) {
        chrome.storage.local.set({ 
          comprasnetToken: token,
          lastCapturedToken: new Date().toLocaleTimeString('pt-BR')
        });
      }
    }
  },
  { urls: ["https://sala-disputa.comprasnet.gov.br/api/*", "https://*.comprasnet.gov.br/*", "https://*.compras.gov.br/*"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getCookies") {
    chrome.cookies.getAll({ domain: "comprasnet.gov.br" }, (cookies) => {
      const cookieString = cookies.map(c => \`\${c.name}=\${c.value}\`).join("; ");
      sendResponse({ cookies: cookieString });
    });
    return true;
  }
});`}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-400 font-mono">3. popup.html & popup.js</span>
                        <p className="text-[10px] text-slate-400 font-normal">
                          Os códigos completos e prontos de popup estão na pasta <code className="text-indigo-400 font-mono">/public/extensao-lancebot</code> deste projeto para cópia direta ou download.
                        </p>
                      </div>
                    </div>

                    <div className="border-t border-white/5 pt-2 text-[10px] space-y-1 font-normal">
                      <p className="font-bold text-white text-[11px] mb-1">Como carregar no seu Chrome:</p>
                      <p>1. No seu navegador, acesse <strong className="text-indigo-400 font-mono">chrome://extensions/</strong></p>
                      <p>2. Ative o <strong className="text-indigo-400">"Modo do desenvolvedor"</strong> (chave no topo direito)</p>
                      <p>3. Clique em <strong className="text-indigo-400">"Carregar sem compactação"</strong> e selecione a pasta da extensão!</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-400 leading-relaxed font-normal">
                    O Comprasnet possui segurança anti-bot robusta no login. Você pode colar suas credenciais capturadas manualmente ou instalar nossa <strong>Extensão de Captura Automática</strong> acima para atualizar sua sessão instantaneamente.
                  </p>
                )}

                <div className="space-y-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-slate-300">
                      Token de Autorização (Bearer ey...)
                    </label>
                    <textarea
                      rows={2}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Cole o cabeçalho Authorization inteiro ou apenas o token JWT (Começa com Bearer...)"
                      className="bg-slate-900 border border-white/10 rounded-lg p-2 text-white focus:outline-none focus:ring-1 focus:ring-rose-500 text-[10px] font-mono leading-tight resize-none"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-semibold text-slate-300">
                      Cookie de Sessão (Opcional - JSESSIONID=...)
                    </label>
                    <input
                      type="text"
                      value={cookie}
                      onChange={(e) => setCookie(e.target.value)}
                      placeholder="JSESSIONID=xxxx; ticket=xxxx..."
                      className="bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-rose-500 text-[10px] font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Inputs grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              
              {/* ID PREGÃO COMPOSTO */}
              <div className="flex flex-col gap-1.5 col-span-1 md:col-span-2">
                <label className="text-xs font-semibold text-slate-300">
                  Código do Pregão do Órgão (ID Comprasnet)
                </label>
                <input
                  type="text"
                  value={pregaoId}
                  onChange={(e) => setPregaoId(e.target.value)}
                  placeholder="Ex: 2026110904321"
                  className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs font-mono"
                />
              </div>

              {/* ITEM NUMBER */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Número do Item / Lote
                </label>
                <input
                  type="text"
                  value={itemNum}
                  onChange={(e) => setItemNum(e.target.value)}
                  placeholder="Ex: 1"
                  className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs font-mono"
                />
              </div>

              {/* BIDDING TIMING STRATEGY */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                  Estratégia de Tempo & Disparo
                  <span title="Escolha como o robô se comportará na disputa temporal. O modo de 15 segundos evita detecção e cansa psicologicamente os adversários.">
                    <Info className="w-3.5 h-3.5 text-indigo-400 cursor-pointer" />
                  </span>
                </label>
                <select
                  value={biddingStrategy}
                  onChange={(e) => setBiddingStrategy(e.target.value as any)}
                  className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
                >
                  <option value="cadenciado-15s">⏱️ Cadenciado Recomendado (15s)</option>
                  <option value="imediato">⚡ Reativo Imediato (1.5s)</option>
                  <option value="sniper">🎯 Pressão / Sniper (5s)</option>
                  <option value="personalizado">⚙️ Intervalo Personalizado (Ms)</option>
                </select>
              </div>

              {/* DYNAMIC SCANNING FREQUENCY OR CUSTOM SLIDER */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Intervalo Real de Execução
                </label>
                {biddingStrategy === "personalizado" ? (
                  <input
                    type="number"
                    step="100"
                    min="500"
                    value={intervaloMs}
                    onChange={(e) => setIntervaloMs(Number(e.target.value))}
                    placeholder="Ex: 15000"
                    className="bg-slate-950 border border-indigo-500/50 rounded-lg px-3 py-2 text-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs font-mono"
                  />
                ) : (
                  <div className="bg-slate-950/60 border border-white/5 text-slate-400 rounded-lg px-3 py-2 text-xs font-mono flex justify-between items-center">
                    <span>{(intervaloMs / 1000).toFixed(1)} segundos</span>
                    <span className="text-[9px] bg-slate-900 px-1.5 py-0.5 rounded text-indigo-400 font-sans font-bold uppercase tracking-wider">Automático</span>
                  </div>
                )}
              </div>

              {/* VALOR ESTIMADO INICIAL */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Mapeado Inicial (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={valorInicial}
                  onChange={(e) => setValorInicial(Number(e.target.value))}
                  className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs font-mono"
                />
              </div>

              {/* VALOR LIMITE MINIMO (SAFETY CEILING) */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                  Mínimo Aceitável (R$)
                  <span title="Abaixo disso, o robô interrompe o envio de lances automaticamente.">
                    <Info className="w-3.5 h-3.5 text-indigo-400 cursor-pointer" />
                  </span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={valorLimiteMinimo}
                  onChange={(e) => setValorLimiteMinimo(Number(e.target.value))}
                  className="bg-slate-950 border border-indigo-500/30 text-emerald-300 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs font-bold font-mono"
                />
              </div>

              {/* TYPE OF DECREMENT */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Metodologia Decremento
                </label>
                <select
                  value={tipoDecremento}
                  onChange={(e) => setTipoDecremento(e.target.value as any)}
                  className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs"
                >
                  <option value="fixo">Valor Fixo (BRL)</option>
                  <option value="percentual">Percentual (%)</option>
                </select>
              </div>

              {/* DECREMENT VALUE */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-300">
                  Dimensão Decremento
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={valorDecremento}
                  onChange={(e) => setValorDecremento(Number(e.target.value))}
                  className="bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs font-mono animate-fade-in"
                />
              </div>

            </div>

            {/* SEGURANÇA & COBERTURA DE LANCES WIDGET */}
            <div className="bg-slate-900/60 rounded-xl p-4 border border-indigo-500/20 space-y-3.5 text-xs">
              <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Módulos de Proteção & Cobertura LanceBot
              </span>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* SAFE COV */}
                <div className="bg-slate-950/40 border border-white/5 p-2.5 rounded-lg space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Cobertura Ativa
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Garante que qualquer lance de concorrente seja coberto com precisão até o limite de R$ {valorLimiteMinimo.toFixed(2)}.
                  </p>
                </div>

                {/* SELF-BID PREVENT */}
                <div className="bg-slate-950/40 border border-white/5 p-2.5 rounded-lg space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Anti-Autolance
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Impede o envio de lances se você já for o atual líder da sala, poupando margem financeira operacional.
                  </p>
                </div>

                {/* HUMAN SIM JITTER TOGGLE */}
                <button
                  type="button"
                  onClick={() => setModoAntiDetecao(!modoAntiDetecao)}
                  className={`text-left bg-slate-950/40 border p-2.5 rounded-lg space-y-1 cursor-pointer transition-all ${
                    modoAntiDetecao ? "border-emerald-500/35 hover:bg-emerald-500/5" : "border-white/5 hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-[11px] text-white">
                      <span className={`w-1.5 h-1.5 rounded-full ${modoAntiDetecao ? "bg-emerald-400 animate-ping" : "bg-slate-500"}`} />
                      Simulador Humano
                    </div>
                    <span className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                      modoAntiDetecao ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-850 text-slate-400"
                    }`}>
                      {modoAntiDetecao ? "ATIVADO" : "DESATIVADO"}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Adiciona variação randômica de ±1.5s aos lances para emular operador humano e burlar defesas anti-bot.
                  </p>
                </button>
              </div>
            </div>

            {/* BOT STATE CONTROLLER WITH POWER BUTTON */}
            <div className="bg-slate-950/60 rounded-xl p-4.5 border border-white/10 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-full ${
                    isBotOn 
                      ? "bg-emerald-500/20 text-emerald-400 animate-pulse border border-emerald-500/20" 
                      : "bg-slate-800 text-slate-400"
                  }`}>
                    <HeartPulse className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white uppercase tracking-wider">
                      {isBotOn ? "ROBÔ EM OPERAÇÃO" : "ROBÔ DESLIGADO"}
                    </p>
                    <p className="text-[10px] text-slate-400 font-mono">
                      {isBotOn ? `Acompanhando pregão a cada ${intervaloMs}ms` : "Aguardando partida segura do licitante"}
                    </p>
                  </div>
                </div>

                {/* Switch button UI */}
                <button
                  onClick={toggleBot}
                  className={`w-14 h-7 rounded-full transition-all duration-300 relative focus:outline-none cursor-pointer border ${
                    isBotOn 
                      ? "bg-gradient-to-r from-emerald-650 to-emerald-550 border-emerald-400/20 shadow-md shadow-emerald-500/20" 
                      : "bg-slate-800 border-white/10"
                  }`}
                >
                  <span className={`absolute top-[2px] left-[2.5px] w-[21px] h-[21px] rounded-full bg-white transition-all shadow ${
                    isBotOn ? "translate-x-7 bg-emerald-50" : ""
                  }`} />
                </button>
              </div>

              {/* Margem Estourada Visual Warn banner */}
              {margemEstourada && (
                <div className="bg-red-950/40 border border-red-500/40 rounded-xl p-3 flex gap-2 w-full text-red-300 leading-normal animate-shake">
                  <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  <div className="text-xs font-normal">
                    <p className="font-bold text-slate-100">🚫 Alerta: MARGEM ESTOURADA!</p>
                    <p className="text-[10px] leading-relaxed text-red-300/80">
                      O menor lance na sala ultrapassou seu valor mínimo limite de R$ {valorLimiteMinimo.toFixed(2)}. 
                      As regras de decremento forçaram o desligamento preventivo do bot.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Simulation utilities */}
            <div className="flex gap-2 justify-between">
              {!isRealMode && (
                <button
                  type="button"
                  onClick={() => {
                    setCompetitorPriceState(p => {
                      const next = Math.round(Math.max(valorLimiteMinimo - 10, p - 8) * 100) / 100;
                      pushLog(`[Simulador Manual]: Concorrente postou uma oferta rápida de R$ ${next.toFixed(2)}`, "competitor");
                      return next;
                    });
                  }}
                  className="bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 py-2 px-3 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1 w-full cursor-pointer"
                >
                  <TrendingDown className="w-3.5 h-3.5 text-blue-400" />
                  Simular Lance Concorrente
                </button>
              )}
              
              <button
                type="button"
                onClick={handleClearLogs}
                className="bg-white/5 border border-white/10 hover:bg-red-950/20 hover:border-red-500/30 text-slate-300 hover:text-red-300 py-2 px-3 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1 w-full cursor-pointer animate-fade-in"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpar Painel Logs
              </button>
            </div>

          </div>

          {/* PYTHON INTEGRATION GUIDE ACCORDING TO SRE REQUEST */}
          <div className="bg-[#0c1020] border border-white/10 rounded-2xl p-5 space-y-3 shadow-lg">
            <h4 className="text-xs font-bold text-slate-100 flex items-center gap-2">
              <Terminal className="w-4.5 h-4.5 text-emerald-400" />
              Integração RPA LanceBot Python
            </h4>
            <p className="text-[11px] text-slate-400 leading-relaxed font-normal">
              O loop assíncrono desta tela representa perfeitamente o comportamento do nosso arquivo 
              <code className="text-emerald-400 font-mono bg-slate-900 px-1 py-0.5 rounded mx-1">lance_bot.py</code> 
              descartado no repositório. Para acoplar a IA, instancie o script Python mapeando os parâmetros em uma API Fast/Flask RPC ou canal WebSocket.
            </p>
            <div className="bg-slate-950 p-3 rounded-xl border border-white/5 font-mono text-[9px] text-slate-300 max-h-52 overflow-y-auto select-text leading-tight scrollbar-thin">
              <span className="text-slate-500"># Mapeamento do MVP Python:</span>
              <br />
              <span className="text-blue-400">bot</span> = MotorLancesComprasnet({'{'}
              <br />
              &nbsp;&nbsp;<span className="text-emerald-400">"pregao_id"</span>: <span className="text-amber-400">"{pregaoId}"</span>,
              <br />
              &nbsp;&nbsp;<span className="text-emerald-400">"item_num"</span>: <span className="text-amber-400">"{itemNum}"</span>,
              <br />
              &nbsp;&nbsp;<span className="text-emerald-400">"valor_limite_minimo"</span>: <span className="text-amber-400">{valorLimiteMinimo}</span>,
              <br />
              &nbsp;&nbsp;<span className="text-emerald-400">"tipo_decremento"</span>: <span className="text-amber-400">"{tipoDecremento}"</span>,
              <br />
              &nbsp;&nbsp;<span className="text-emerald-400">"valor_decremento"</span>: <span className="text-amber-400">{valorDecremento}</span>,
              <br />
              &nbsp;&nbsp;<span className="text-emerald-400">"intervalo_ms"</span>: <span className="text-amber-400">{intervaloMs}</span>
              <br />
              {'}'})
              <br />
              <span className="text-purple-400">await</span> <span className="text-blue-400">bot</span>.iniciar_loop()
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: LIVESTREAM GRAPH & LIVE LOGS / CONCIERGE CHATS */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* CHART: VISUAL BID TRACKER */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4 shadow-lg select-none">
            <h3 className="text-xs font-bold text-slate-100 uppercase tracking-widest flex items-center gap-2">
              <Clock className="w-4.5 h-4.5 text-blue-400 animate-pulse" />
              Monitoramento Compras.gov (Tempo Real)
            </h3>

            {/* Simulated Live Figures */}
            <div className="grid grid-cols-3 gap-3 border border-white/5 p-3 rounded-xl bg-slate-950/40 font-mono">
              <div className="text-center">
                <span className="text-[9px] text-slate-400 uppercase">Menor Concorrente</span>
                <p className="text-sm font-bold text-blue-400 mt-1">R$ {competitorPriceState.toFixed(2)}</p>
              </div>
              <div className="text-center border-x border-white/5">
                <span className="text-[9px] text-slate-400 uppercase">Nossa Oferta</span>
                <p className="text-sm font-bold text-emerald-400 mt-1">
                  {ourPriceState ? `R$ ${ourPriceState.toFixed(2)}` : "Aguardando"}
                </p>
              </div>
              <div className="text-center">
                <span className="text-[9px] text-slate-400 uppercase">Limite Mínimo</span>
                <p className="text-sm font-bold text-red-400 mt-1">R$ {valorLimiteMinimo.toFixed(2)}</p>
              </div>
            </div>

            {/* Line chart container */}
            <div className="h-60 w-full bg-slate-950/20 rounded-xl p-1 border border-white/5">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 15, left: -10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0a" />
                    <XAxis dataKey="sec" name="Temp. (s)" stroke="#94a3b8" fontSize={10} angle={-10} offset={2} />
                    <YAxis domain={['auto', 'auto']} stroke="#94a3b8" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "1px solid #ffffff1a", borderRadius: "8px" }} />
                    <Legend wrapperStyle={{ fontSize: '10px', marginTop: '10px' }} />
                    
                    {/* Dashed line representing safety minimum margin */}
                    <ReferenceLine y={valorLimiteMinimo} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Mínimo Aceitável', fill: '#f87171', fontSize: 9, position: 'top' }} />

                    <Line type="monotone" dataKey="Menor Concorrente" stroke="#ea580c" strokeWidth={1.5} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="Nosso Lance" stroke="#10b981" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 p-5 text-center gap-2 select-none">
                  <Play className="w-8 h-8 text-indigo-500 animate-bounce" />
                  <p className="text-xs font-bold text-slate-200">Painel Gráfico Ocioso</p>
                  <p className="text-[10px] text-slate-400 max-w-[280px]">
                    Ligue o switch do Robô de Lances acima p/ estabelecer conexão e traçar o gráfico de concorrência.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* DUAL TERMINAL PANE: CHAT PREGOEIRO & REALTIME LOGS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-auto md:h-72">
            
            {/* TERMINAL 1: REALTIME BOT TELEMETRY LOGS */}
            <div className="bg-[#0a0d16] border border-white/10 rounded-2xl flex flex-col h-full overflow-hidden select-text">
              <div className="bg-white/5 border-b border-white/5 py-2.5 px-4 flex items-center justify-between select-none shrink-0">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-blue-300" />
                  Console Logs RPA
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              </div>
              
              <div ref={logsContainerRef} className="flex-1 overflow-y-auto p-4 space-y-2.5 font-mono text-[10px] md:text-[11px] leading-relaxed select-text">
                {logs.map((lg) => {
                  let color = "text-slate-400";
                  if (lg.type === "competitor") color = "text-amber-500 font-semibold";
                  if (lg.type === "own") color = "text-emerald-400 font-bold";
                  if (lg.type === "warning") color = "text-rose-450 font-extrabold bg-red-950/20 p-1.5 rounded border border-red-500/20";
                  if (lg.type === "success") color = "text-indigo-300 font-bold";
                  if (lg.type === "chat") color = "text-cyan-400";

                  return (
                    <div key={lg.id} className="flex gap-1.5 items-start">
                      <span className="text-slate-500 select-none">[{lg.timestamp}]</span>
                      <span className={color}>{lg.msg}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* TERMINAL 2: LIVE CHAT FROM PREGOEIRO */}
            <div className="bg-[#0a0d16] border border-white/10 rounded-2xl flex flex-col h-full overflow-hidden">
              <div className="bg-white/5 border-b border-white/5 py-2.5 px-4 flex items-center justify-between select-none shrink-0">
                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-indigo-300" />
                  Chat Oficial do Pregoeiro
                </span>
                <span className="text-[10px] text-slate-400 font-mono">Pregão Ativo</span>
              </div>
              
              <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3 font-normal text-xs md:text-sm select-text">
                {chatMessages.map((cm) => (
                  <div key={cm.id} className="bg-white/5 border border-white/5 p-2 px-3 rounded-xl space-y-1">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="font-bold text-indigo-400">{cm.sender}</span>
                      <span className="text-slate-500 font-mono text-[9px]">{cm.time}</span>
                    </div>
                    <p className="text-slate-200 text-xs leading-relaxed">{cm.text}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
