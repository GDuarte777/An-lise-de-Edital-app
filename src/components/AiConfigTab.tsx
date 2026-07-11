import { useState, useEffect } from "react";
import { Cpu, Key, CheckCircle, RefreshCw, AlertTriangle, Sparkles, ExternalLink, ShieldCheck, Zap, Loader2, XCircle } from "lucide-react";
import confetti from "canvas-confetti";
import { saveUserConfigToSupabase } from "../utils/supabaseClient";
import { apiFetch } from "../utils/aiClientHelper";

export default function AiConfigTab() {
  const [activeProvider, setActiveProvider] = useState<string>("gemini");
  
  // Credentials
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-3.5-flash");
  
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o");
  
  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("claude-3-7-sonnet-20250219");
  
  const [deepseekKey, setDeepseekKey] = useState("");
  const [deepseekModel, setDeepseekModel] = useState("deepseek-chat");

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // AI test states
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Supabase sync states
  const [syncingSecrets, setSyncingSecrets] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState<boolean | null>(null);
  const [syncMessage, setSyncMessage] = useState("");

  // Load from localStorage on mount and when configurations are updated/loaded from database
  useEffect(() => {
    const loadFromStorage = () => {
      const provider = localStorage.getItem("ai_active_provider") || "gemini";
      setActiveProvider(provider);

      setGeminiKey(localStorage.getItem("ai_gemini_key") || "");
      setGeminiModel(localStorage.getItem("ai_gemini_model") || "gemini-3.5-flash");

      setOpenaiKey(localStorage.getItem("ai_openai_key") || "");
      setOpenaiModel(localStorage.getItem("ai_openai_model") || "gpt-4o");

      setAnthropicKey(localStorage.getItem("ai_anthropic_key") || "");
      setAnthropicModel(localStorage.getItem("ai_anthropic_model") || "claude-3-7-sonnet-20250219");

      setDeepseekKey(localStorage.getItem("ai_deepseek_key") || "");
      setDeepseekModel(localStorage.getItem("ai_deepseek_model") || "deepseek-chat");
    };

    loadFromStorage();
    window.addEventListener("user-config-loaded", loadFromStorage);
    return () => {
      window.removeEventListener("user-config-loaded", loadFromStorage);
    };
  }, []);

  const handleProviderChange = (newProvider: string) => {
    setActiveProvider(newProvider);
    try {
      localStorage.setItem("ai_active_provider", newProvider);
      saveUserConfigToSupabase({
        activeProvider: newProvider,
        geminiKey,
        geminiModel,
        openaiKey,
        openaiModel,
        anthropicKey,
        anthropicModel,
        deepseekKey,
        deepseekModel
      }).catch((err) => console.warn("Erro ao sincronizar provedor com Supabase:", err));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 1500);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);

    try {
      localStorage.setItem("ai_active_provider", activeProvider);
      
      localStorage.setItem("ai_gemini_key", geminiKey);
      localStorage.setItem("ai_gemini_model", geminiModel);

      localStorage.setItem("ai_openai_key", openaiKey);
      localStorage.setItem("ai_openai_model", openaiModel);

      localStorage.setItem("ai_anthropic_key", anthropicKey);
      localStorage.setItem("ai_anthropic_model", anthropicModel);

      localStorage.setItem("ai_deepseek_key", deepseekKey);
      localStorage.setItem("ai_deepseek_model", deepseekModel);

      // Force update standard env configs to support legacy route check
      localStorage.setItem("supabase_route_ai", "false"); // Use local router since it has custom keys

      // Persist in user-specific cloud DB table
      saveUserConfigToSupabase({
        activeProvider,
        geminiKey,
        geminiModel,
        openaiKey,
        openaiModel,
        anthropicKey,
        anthropicModel,
        deepseekKey,
        deepseekModel
      }).catch((err) => console.warn("Erro ao sincronizar chaves com Supabase:", err));

      setSaveSuccess(true);
      confetti({ particleCount: 60, spread: 50, origin: { y: 0.8 } });
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleTestAi = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // First save to localStorage
      localStorage.setItem("ai_active_provider", activeProvider);
      localStorage.setItem(`ai_${activeProvider}_key`, 
        activeProvider === "gemini" ? geminiKey : 
        activeProvider === "openai" ? openaiKey :
        activeProvider === "anthropic" ? anthropicKey : deepseekKey
      );
      localStorage.setItem(`ai_${activeProvider}_model`,
        activeProvider === "gemini" ? geminiModel :
        activeProvider === "openai" ? openaiModel :
        activeProvider === "anthropic" ? anthropicModel : deepseekModel
      );

      const response = await apiFetch("/api/chat", {
        method: "POST",
        body: {
          messages: [{ role: "user", content: "Responda apenas: 'IA funcionando!' em português." }]
        }
      });

      const data = await response.json();

      if (!response.ok) {
        setTestResult({ ok: false, message: data?.error || "Erro desconhecido." });
      } else {
        setTestResult({ ok: true, message: `✅ IA respondeu: "${data.reply?.substring(0, 80) || "OK"}"` });
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.8 } });
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message || "Erro de rede." });
    } finally {
      setTesting(false);
    }
  };

  const handleSyncSupabaseSecrets = async () => {
    if (!geminiKey) {
      alert("Por favor, preencha a chave de API do Gemini antes de sincronizar.");
      return;
    }

    setSyncingSecrets(true);
    setSyncSuccess(null);
    setSyncMessage("");

    try {
      const projectRef = "cghlfhndoqohmrrvppjj";
      const accessToken = "sbp_e02c61f0dc45290154598e70b63c3ac3535f45dc";
      
      const response = await fetch("/api/supabase/sync-secrets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          geminiKey,
          projectRef,
          accessToken
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let parsedError = errorText;
        try {
          const jsonErr = JSON.parse(errorText);
          parsedError = jsonErr.error || jsonErr.message || errorText;
        } catch (_) {}
        throw new Error(parsedError || "Falha ao atualizar segredos no Supabase.");
      }

      setSyncSuccess(true);
      setSyncMessage("Chave do Gemini (GEMINI_API_KEY) sincronizada com sucesso na nuvem do Supabase!");
      confetti({ particleCount: 50, colors: ["#3ecf8e", "#10b981"] });
    } catch (err: any) {
      console.warn("Erro ao sincronizar chaves com Supabase (pode ser uma reinicialização de servidor ou indisponibilidade temporária):", err?.message || err);
      setSyncSuccess(false);
      setSyncMessage(err.message || "Erro desconhecido ao sincronizar.");
    } finally {
      setSyncingSecrets(false);
    }
  };

  return (
    <div id="ai-config-tab" className="space-y-6 animate-fade-in select-text">
      
      {/* Header Info Banner */}
      <div className="bg-gradient-to-r from-blue-600/10 to-indigo-600/10 border border-indigo-500/20 backdrop-blur-md rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-500/15 text-indigo-400 p-3 rounded-xl border border-indigo-500/25 shrink-0">
            <Cpu className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              Configurações Avançadas de IA & Modelos
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 font-semibold px-2 py-0.5 rounded-full border border-indigo-500/30">
                Multi-Provedor
              </span>
            </h3>
            <p className="text-slate-400 text-xs mt-1 leading-normal max-w-2xl">
              Escolha e configure a Inteligência Artificial ativa para toda a plataforma. Insira suas próprias chaves de API para uso ilimitado sem restrições de limites de cota da versão padrão.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Config Form (Left/Center) */}
        <form onSubmit={handleSave} className="lg:col-span-2 bg-white/5 border border-white/10 backdrop-blur-md rounded-2xl p-6 space-y-6 shadow-xl">
          
          {/* Provider Selector */}
          <div className="space-y-3">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
              Provedor de Inteligência Artificial Ativo
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { id: "gemini", name: "Google Gemini", desc: "Altamente veloz" },
                { id: "openai", name: "OpenAI ChatGPT", desc: "Líder de mercado" },
                { id: "anthropic", name: "Anthropic Claude", desc: "Raciocínio lógico" },
                { id: "deepseek", name: "DeepSeek V3/R1", desc: "Excelente custo/benefício" }
              ].map((p) => {
                const isActive = activeProvider === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProviderChange(p.id)}
                    className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 justify-between select-none ${
                      isActive 
                        ? "bg-indigo-500/15 border-indigo-500 text-white shadow-lg shadow-indigo-600/10" 
                        : "bg-slate-950/60 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
                    }`}
                  >
                    <span className="font-bold text-xs block">{p.name}</span>
                    <span className="text-[9px] text-slate-500 block font-normal">{p.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <hr className="border-white/5" />

          {/* Provider Configuration Forms */}
          <div className="space-y-4">
            
            {/* Gemini Config */}
            {activeProvider === "gemini" && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center gap-2 text-indigo-400">
                  <Sparkles className="w-4 h-4" />
                  <span className="font-bold text-xs uppercase tracking-wide">Configurações do Google Gemini</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Chave de API do Gemini</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-600">
                        <Key className="w-4 h-4" />
                      </div>
                      <input
                        type="password"
                        placeholder="AIzaSy..."
                        value={geminiKey}
                        onChange={(e) => setGeminiKey(e.target.value)}
                        className="w-full bg-slate-950 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Modelo Ativo</label>
                    <select
                      value={geminiModel}
                      onChange={(e) => setGeminiModel(e.target.value)}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                    >
                      <option value="gemini-3.5-flash">gemini-3.5-flash (Nova Geração Flash - Padrão)</option>
                      <option value="gemini-3.5-pro">gemini-3.5-pro (Nova Geração Pro - Raciocínio Complexo)</option>
                      <option value="gemini-3.1-pro">gemini-3.1-pro (Raciocínio Pure-Reasoning)</option>
                      <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Leve e rápido)</option>
                      <option value="gemini-1.5-flash">gemini-1.5-flash (Legado de compatibilidade)</option>
                    </select>
                  </div>
                </div>

                <div className="bg-indigo-950/20 border border-indigo-500/20 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-slate-300">
                  <div className="space-y-1 text-left">
                    <p className="font-bold text-white">Sincronizar com a Nuvem (Supabase Edge)</p>
                    <p className="text-[10px] text-slate-400 max-w-md leading-normal">
                      Se você utiliza o roteamento de IA em nuvem por Edge Functions, sincronize essa chave para que a nuvem do Supabase passe a utilizá-la em chamadas automáticas.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={syncingSecrets}
                    onClick={handleSyncSupabaseSecrets}
                    className="px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/35 hover:border-indigo-500/50 text-indigo-300 font-bold rounded-lg text-[10px] transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {syncingSecrets ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Sincronizando...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-3.5 h-3.5" />
                        Sincronizar Chave
                      </>
                    )}
                  </button>
                </div>

                {syncSuccess !== null && (
                  <div className={`p-3 rounded-lg text-[10px] leading-relaxed border ${
                    syncSuccess 
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                      : "bg-rose-500/10 border-rose-500/20 text-rose-300"
                  }`}>
                    {syncMessage}
                  </div>
                )}
              </div>
            )}

            {/* OpenAI Config */}
            {activeProvider === "openai" && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center gap-2 text-indigo-400">
                  <Sparkles className="w-4 h-4" />
                  <span className="font-bold text-xs uppercase tracking-wide">Configurações da OpenAI (ChatGPT)</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Chave de API (OpenAI Key)</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-600">
                        <Key className="w-4 h-4" />
                      </div>
                      <input
                        type="password"
                        placeholder="sk-proj-..."
                        value={openaiKey}
                        onChange={(e) => setOpenaiKey(e.target.value)}
                        className="w-full bg-slate-950 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Modelo Ativo</label>
                    <select
                      value={openaiModel}
                      onChange={(e) => setOpenaiModel(e.target.value)}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                    >
                      <option value="gpt-4o">gpt-4o (Alta performance)</option>
                      <option value="gpt-4o-mini">gpt-4o-mini (Rápido e econômico)</option>
                      <option value="o3-mini">o3-mini (Novo modelo de raciocínio rápido da OpenAI)</option>
                      <option value="o1">o1 (Raciocínio avançado completo)</option>
                      <option value="o1-mini">o1-mini (Raciocínio leve)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Anthropic Config */}
            {activeProvider === "anthropic" && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center gap-2 text-indigo-400">
                  <Sparkles className="w-4 h-4" />
                  <span className="font-bold text-xs uppercase tracking-wide">Configurações da Anthropic (Claude)</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Chave de API (Claude Key)</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-600">
                        <Key className="w-4 h-4" />
                      </div>
                      <input
                        type="password"
                        placeholder="sk-ant-..."
                        value={anthropicKey}
                        onChange={(e) => setAnthropicKey(e.target.value)}
                        className="w-full bg-slate-950 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Modelo Ativo</label>
                    <select
                      value={anthropicModel}
                      onChange={(e) => setAnthropicModel(e.target.value)}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                    >
                      <option value="claude-3-7-sonnet-20250219">claude-3-7-sonnet-20250219 (Claude 3.7 Sonnet - Híbrido emblemático)</option>
                      <option value="claude-3-5-sonnet-20241022">claude-3-5-sonnet-20241022 (Claude 3.5 Sonnet v2)</option>
                      <option value="claude-3-5-haiku-20241022">claude-3-5-haiku-20241022 (Claude 3.5 Haiku)</option>
                      <option value="claude-3-opus-20240229">claude-3-opus-20240229 (Claude 3 Opus)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* DeepSeek Config */}
            {activeProvider === "deepseek" && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center gap-2 text-indigo-400">
                  <Sparkles className="w-4 h-4" />
                  <span className="font-bold text-xs uppercase tracking-wide">Configurações do DeepSeek</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Chave de API (DeepSeek Key)</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-600">
                        <Key className="w-4 h-4" />
                      </div>
                      <input
                        type="password"
                        placeholder="sk-..."
                        value={deepseekKey}
                        onChange={(e) => setDeepseekKey(e.target.value)}
                        className="w-full bg-slate-950 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Modelo Ativo</label>
                    <select
                      value={deepseekModel}
                      onChange={(e) => setDeepseekModel(e.target.value)}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                    >
                      <option value="deepseek-chat">deepseek-chat (DeepSeek V3)</option>
                      <option value="deepseek-reasoner">deepseek-reasoner (DeepSeek R1 com raciocínio profundo)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

          </div>

          <hr className="border-white/5" />

          {/* Form Actions */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {saveSuccess ? (
                <div className="text-emerald-400 font-semibold text-xs flex items-center gap-1.5 animate-bounce">
                  <CheckCircle className="w-4 h-4" />
                  Configurações salvas e ativas!
                </div>
              ) : (
                <p className="text-[10px] text-slate-500 max-w-sm leading-normal">
                  *As chaves são armazenadas localmente no seu navegador e usadas apenas nas requisições diretas de IA.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/20 border border-white/10 flex items-center gap-2 transition-all cursor-pointer select-none"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Salvar Configurações
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleTestAi}
              disabled={testing}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-emerald-600/20 border border-white/10 flex items-center gap-2 transition-all cursor-pointer select-none disabled:opacity-60"
            >
              {testing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Testando...
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  Testar IA Agora
                </>
              )}
            </button>
          </div>

          {/* Test Result Banner */}
          {testResult && (
            <div className={`mt-3 p-3 rounded-xl text-xs font-medium flex items-start gap-2 border ${
              testResult.ok 
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" 
                : "bg-red-500/10 border-red-500/30 text-red-300"
            }`}>
              {testResult.ok 
                ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              }
              <span>{testResult.message}</span>
            </div>
          )}

        </form>

        {/* Sidebar Info/QuickLinks (Right side) */}
        <div className="space-y-6">
          
          {/* Status Panel */}
          <div className="bg-slate-900/60 border border-white/5 backdrop-blur-md rounded-2xl p-5 space-y-4">
            <h4 className="font-bold text-white text-xs uppercase tracking-wide">Status da Conexão</h4>
            
            <div className="space-y-3">
              {[
                { name: "Google Gemini", key: geminiKey, active: activeProvider === "gemini" },
                { name: "OpenAI ChatGPT", key: openaiKey, active: activeProvider === "openai" },
                { name: "Anthropic Claude", key: anthropicKey, active: activeProvider === "anthropic" },
                { name: "DeepSeek", key: deepseekKey, active: activeProvider === "deepseek" }
              ].map((prov) => {
                const hasKey = prov.key && prov.key.length > 5;
                return (
                  <div key={prov.name} className="flex items-center justify-between text-xs border-b border-white/5 pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${prov.active ? "bg-indigo-400" : "bg-slate-700"}`} />
                      <span className="font-semibold text-slate-300">{prov.name}</span>
                      {prov.active && (
                        <span className="text-[8px] bg-indigo-500/10 text-indigo-300 font-bold px-1.5 py-0.2 rounded border border-indigo-500/20">
                          ATIVO
                        </span>
                      )}
                    </div>
                    {hasKey ? (
                      <span className="text-emerald-400 font-bold text-[10px] flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Configurada
                      </span>
                    ) : (
                      <span className="text-slate-500 text-[10px]">Não informada</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick instructions / Help */}
          <div className="bg-white/5 border border-white/10 backdrop-blur-md rounded-2xl p-5 space-y-3.5">
            <h4 className="font-bold text-white text-xs uppercase tracking-wide flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Como obter as chaves?
            </h4>
            <div className="space-y-2.5 text-xs text-slate-400 leading-relaxed">
              <p>
                <strong>Google Gemini Key:</strong> Obtenha gratuitamente no portal do <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">Google AI Studio <ExternalLink className="w-2.5 h-2.5" /></a>.
              </p>
              <p>
                <strong>OpenAI API Key:</strong> Acesse seu painel de desenvolvedor no site da <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">OpenAI <ExternalLink className="w-2.5 h-2.5" /></a>.
              </p>
              <p>
                <strong>Claude Key:</strong> Gerencie suas chaves no Console do desenvolvedor da <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">Anthropic <ExternalLink className="w-2.5 h-2.5" /></a>.
              </p>
              <p>
                <strong>DeepSeek Key:</strong> Acesse o portal da <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-0.5">DeepSeek API <ExternalLink className="w-2.5 h-2.5" /></a>.
              </p>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
