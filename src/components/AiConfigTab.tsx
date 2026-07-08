import { useState, useEffect } from "react";
import { 
  Cpu, 
  Key, 
  CheckCircle, 
  RefreshCw, 
  AlertTriangle, 
  Sparkles, 
  ExternalLink, 
  ShieldCheck, 
  Eye, 
  EyeOff, 
  Play, 
  Check, 
  AlertCircle 
} from "lucide-react";
import confetti from "canvas-confetti";
import { saveUserConfigToSupabase, getSupabaseClient } from "../utils/supabaseClient";
import { apiFetch } from "../utils/aiClientHelper";

interface ProviderConfig {
  id: string;
  name: string;
  tagline: string;
  accentColor: string;
  defaultModel: string;
  docUrl: string;
  placeholder: string;
  models: { value: string; label: string }[];
}

const PROVIDERS_INFO: ProviderConfig[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    tagline: "Ultra rápido, multimodal e excelente para análise estruturada",
    accentColor: "border-blue-500/30 bg-blue-500/5 text-blue-400 hover:border-blue-500/50",
    defaultModel: "gemini-3.5-flash",
    docUrl: "https://aistudio.google.com/",
    placeholder: "AIzaSy...",
    models: [
      { value: "gemini-3.5-flash", label: "gemini-3.5-flash (Nova Geração Flash - Padrão)" },
      { value: "gemini-3.5-pro", label: "gemini-3.5-pro (Nova Geração Pro - Raciocínio Complexo)" },
      { value: "gemini-3.1-pro", label: "gemini-3.1-pro (Raciocínio Pure-Reasoning)" },
      { value: "gemini-3.1-flash-lite", label: "gemini-3.1-flash-lite (Leve e rápido)" },
      { value: "gemini-1.5-flash", label: "gemini-1.5-flash (Legado de compatibilidade)" },
    ]
  },
  {
    id: "openai",
    name: "OpenAI ChatGPT",
    tagline: "Líder em precisão instrucional e redação corporativa",
    accentColor: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400 hover:border-emerald-500/50",
    defaultModel: "gpt-4o",
    docUrl: "https://platform.openai.com/api-keys",
    placeholder: "sk-proj-...",
    models: [
      { value: "gpt-4o", label: "gpt-4o (Alta performance & Criatividade)" },
      { value: "gpt-4o-mini", label: "gpt-4o-mini (Rápido, leve e econômico)" },
      { value: "o3-mini", label: "o3-mini (Raciocínio rápido e lógico)" },
      { value: "o1", label: "o1 (Raciocínio avançado completo)" },
      { value: "o1-mini", label: "o1-mini (Raciocínio lógico leve)" },
    ]
  },
  {
    id: "anthropic",
    name: "Anthropic Claude",
    tagline: "Excepcional para redação literária, contratos e lógica densa",
    accentColor: "border-amber-600/30 bg-amber-600/5 text-amber-500 hover:border-amber-600/50",
    defaultModel: "claude-3-7-sonnet-20250219",
    docUrl: "https://console.anthropic.com/",
    placeholder: "sk-ant-...",
    models: [
      { value: "claude-3-7-sonnet-20250219", label: "claude-3-7-sonnet (Claude 3.7 Sonnet - Recomendado)" },
      { value: "claude-3-5-sonnet-20241022", label: "claude-3-5-sonnet (Claude 3.5 Sonnet v2)" },
      { value: "claude-3-5-haiku-20241022", label: "claude-3-5-haiku (Claude 3.5 Haiku)" },
      { value: "claude-3-opus-20240229", label: "claude-3-opus (Claude 3 Opus)" },
    ]
  },
  {
    id: "deepseek",
    name: "DeepSeek V3/R1",
    tagline: "Desempenho de ponta a um custo extremamente reduzido",
    accentColor: "border-purple-500/30 bg-purple-500/5 text-purple-400 hover:border-purple-500/50",
    defaultModel: "deepseek-chat",
    docUrl: "https://platform.deepseek.com/",
    placeholder: "sk-...",
    models: [
      { value: "deepseek-chat", label: "deepseek-chat (DeepSeek V3 - Geral)" },
      { value: "deepseek-reasoner", label: "deepseek-reasoner (DeepSeek R1 - Raciocínio Profundo)" },
    ]
  }
];

export default function AiConfigTab() {
  const [activeProvider, setActiveProvider] = useState<string>("gemini");
  
  // Credentials and states for each provider
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-3.5-flash");
  
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o");
  
  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("claude-3-7-sonnet-20250219");
  
  const [deepseekKey, setDeepseekKey] = useState("");
  const [deepseekModel, setDeepseekModel] = useState("deepseek-chat");

  // Show/hide password state
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({
    gemini: false,
    openai: false,
    anthropic: false,
    deepseek: false
  });

  // Action status states
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string } | null>>({});
  
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<Record<string, boolean>>({});

  const [savingAll, setSavingAll] = useState(false);
  const [globalSaveSuccess, setGlobalSaveSuccess] = useState(false);

  // Load configuration from LocalStorage on mount
  useEffect(() => {
    const loadFromStorage = () => {
      const active = localStorage.getItem("ai_active_provider") || "gemini";
      setActiveProvider(active);

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

  // Toggle key visibility
  const toggleKeyVisibility = (id: string) => {
    setShowKeys(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Helper to map provider ID to its key & model states
  const getProviderState = (id: string) => {
    switch (id) {
      case "gemini": return { key: geminiKey, model: geminiModel, setKey: setGeminiKey, setModel: setGeminiModel };
      case "openai": return { key: openaiKey, model: openaiModel, setKey: setOpenaiKey, setModel: setOpenaiModel };
      case "anthropic": return { key: anthropicKey, model: anthropicModel, setKey: setAnthropicKey, setModel: setAnthropicModel };
      case "deepseek": return { key: deepseekKey, model: deepseekModel, setKey: setDeepseekKey, setModel: setDeepseekModel };
      default: return { key: "", model: "", setKey: () => {}, setModel: () => {} };
    }
  };

  // Select a provider to be the active one
  const handleActivateProvider = async (providerId: string) => {
    setActiveProvider(providerId);
    localStorage.setItem("ai_active_provider", providerId);
    
    // Dispatch global event for instant client updates
    window.dispatchEvent(new Event("user-config-loaded"));

    // Sync active provider preference with Supabase if logged in
    try {
      await saveUserConfigToSupabase({
        activeProvider: providerId,
        geminiKey,
        geminiModel,
        openaiKey,
        openaiModel,
        anthropicKey,
        anthropicModel,
        deepseekKey,
        deepseekModel
      });
    } catch (e) {
      console.warn("Erro ao salvar provedor ativo no Supabase:", e);
    }
  };

  // Save a specific provider configuration
  const handleSaveProvider = async (providerId: string) => {
    setSavingProvider(providerId);
    setSaveSuccess(prev => ({ ...prev, [providerId]: false }));

    const { key, model, setKey } = getProviderState(providerId);
    const trimmedKey = key.trim();
    
    // Update local React state with trimmed key
    setKey(trimmedKey);

    try {
      // 1. Save in LocalStorage
      localStorage.setItem(`ai_${providerId}_key`, trimmedKey);
      localStorage.setItem(`ai_${providerId}_model`, model);
      localStorage.setItem("supabase_route_ai", "false"); // Ensure custom router is triggered

      // 2. Save in Supabase
      await saveUserConfigToSupabase({
        activeProvider: activeProvider === providerId ? activeProvider : localStorage.getItem("ai_active_provider") || "gemini",
        geminiKey: providerId === "gemini" ? trimmedKey : geminiKey.trim(),
        geminiModel: providerId === "gemini" ? model : geminiModel,
        openaiKey: providerId === "openai" ? trimmedKey : openaiKey.trim(),
        openaiModel: providerId === "openai" ? model : openaiModel,
        anthropicKey: providerId === "anthropic" ? trimmedKey : anthropicKey.trim(),
        anthropicModel: providerId === "anthropic" ? model : anthropicModel,
        deepseekKey: providerId === "deepseek" ? trimmedKey : deepseekKey.trim(),
        deepseekModel: providerId === "deepseek" ? model : deepseekModel,
      });

      setSaveSuccess(prev => ({ ...prev, [providerId]: true }));
      window.dispatchEvent(new Event("user-config-loaded"));

      setTimeout(() => {
        setSaveSuccess(prev => ({ ...prev, [providerId]: false }));
      }, 3000);
    } catch (error) {
      console.error(`Erro ao salvar configurações do ${providerId}:`, error);
    } finally {
      setSavingProvider(null);
    }
  };

  // Test connection for a specific provider in real-time
  const handleTestConnection = async (providerId: string) => {
    setTestingProvider(providerId);
    setTestResults(prev => ({ ...prev, [providerId]: null }));

    const { key, model, setKey } = getProviderState(providerId);
    const trimmedKey = key.trim();

    if (!trimmedKey || trimmedKey.length < 5) {
      setTestingProvider(null);
      setTestResults(prev => ({
        ...prev,
        [providerId]: {
          success: false,
          message: "A chave de API está vazia ou é inválida. Insira uma chave antes de testar."
        }
      }));
      return;
    }

    // Update state to show trimmed key
    setKey(trimmedKey);

    try {
      const response = await apiFetch("/api/test-ai-connection", {
        method: "POST",
        body: {
          aiConfig: {
            provider: providerId,
            apiKey: trimmedKey,
            model: model
          }
        }
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setTestResults(prev => ({
          ...prev,
          [providerId]: {
            success: true,
            message: data.message || "Conexão estabelecida com sucesso!"
          }
        }));
        confetti({ particleCount: 30, spread: 40, origin: { y: 0.8 } });
      } else {
        setTestResults(prev => ({
          ...prev,
          [providerId]: {
            success: false,
            message: data.error || "Erro na validação da chave com o servidor de IA."
          }
        }));
      }
    } catch (error: any) {
      setTestResults(prev => ({
        ...prev,
        [providerId]: {
          success: false,
          message: error.message || "Falha de conexão de rede ou erro inesperado de servidor."
        }
      }));
    } finally {
      setTestingProvider(null);
    }
  };

  // Save all credentials at once
  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAll(true);
    setGlobalSaveSuccess(false);

    const trimmedGemini = geminiKey.trim();
    const trimmedOpenai = openaiKey.trim();
    const trimmedAnthropic = anthropicKey.trim();
    const trimmedDeepseek = deepseekKey.trim();

    // Update local React states
    setGeminiKey(trimmedGemini);
    setOpenaiKey(trimmedOpenai);
    setAnthropicKey(trimmedAnthropic);
    setDeepseekKey(trimmedDeepseek);

    try {
      // 1. Save all to local storage
      localStorage.setItem("ai_active_provider", activeProvider);
      
      localStorage.setItem("ai_gemini_key", trimmedGemini);
      localStorage.setItem("ai_gemini_model", geminiModel);

      localStorage.setItem("ai_openai_key", trimmedOpenai);
      localStorage.setItem("ai_openai_model", openaiModel);

      localStorage.setItem("ai_anthropic_key", trimmedAnthropic);
      localStorage.setItem("ai_anthropic_model", anthropicModel);

      localStorage.setItem("ai_deepseek_key", trimmedDeepseek);
      localStorage.setItem("ai_deepseek_model", deepseekModel);

      localStorage.setItem("supabase_route_ai", "false");

      // 2. Save to Supabase Cloud
      await saveUserConfigToSupabase({
        activeProvider,
        geminiKey: trimmedGemini,
        geminiModel,
        openaiKey: trimmedOpenai,
        openaiModel,
        anthropicKey: trimmedAnthropic,
        anthropicModel,
        deepseekKey: trimmedDeepseek,
        deepseekModel
      });

      setGlobalSaveSuccess(true);
      confetti({ particleCount: 60, spread: 60, origin: { y: 0.85 } });
      window.dispatchEvent(new Event("user-config-loaded"));

      setTimeout(() => {
        setGlobalSaveSuccess(false);
      }, 4000);
    } catch (error) {
      console.error("Erro ao salvar todas as configurações:", error);
    } finally {
      setSavingAll(false);
    }
  };

  return (
    <div id="ai-config-tab" className="space-y-6 animate-fade-in select-text">
      
      {/* Premium Header Banner */}
      <div className="bg-gradient-to-r from-blue-900/40 via-indigo-950/40 to-slate-900/60 border border-indigo-500/15 backdrop-blur-md rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-5 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="bg-gradient-to-br from-indigo-500 to-blue-600 text-white p-3.5 rounded-xl shadow-lg shrink-0">
            <Cpu className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base flex items-center gap-2">
              Chaves de API & Modelos Individuais
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 font-semibold px-2 py-0.5 rounded-full border border-emerald-500/20">
                Seguro & Isolado
              </span>
            </h3>
            <p className="text-slate-400 text-xs mt-1 leading-normal max-w-2xl">
              Insira e teste suas próprias credenciais para garantir uso ilimitado e individualizado de IA para você e sua equipe. As chaves são guardadas de forma segura e usadas em transações isoladas por usuário.
            </p>
          </div>
        </div>
      </div>

      {/* Active AI Selector */}
      <div className="bg-slate-950/40 border border-white/5 rounded-2xl p-5 space-y-4">
        <div>
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            Selecione o Provedor de IA Ativo para a Plataforma
          </h4>
          <p className="text-[11px] text-slate-500 mt-0.5">
            O provedor selecionado abaixo será o responsável por processar todas as análises, chats e auditorias de editais na sua conta.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {PROVIDERS_INFO.map((prov) => {
            const isActive = activeProvider === prov.id;
            const { key } = getProviderState(prov.id);
            const hasKey = key && key.trim().length > 5;

            return (
              <button
                key={prov.id}
                type="button"
                onClick={() => handleActivateProvider(prov.id)}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between h-28 select-none ${
                  isActive
                    ? "bg-indigo-600/15 border-indigo-500 text-white shadow-lg shadow-indigo-600/10"
                    : "bg-slate-900/50 border-white/5 text-slate-400 hover:text-slate-200 hover:bg-slate-900/80"
                }`}
              >
                <div className="w-full flex items-center justify-between">
                  <span className="font-bold text-xs block">{prov.name}</span>
                  {isActive && (
                    <span className="w-2 h-2 rounded-full bg-indigo-400 ring-4 ring-indigo-500/30 animate-ping" />
                  )}
                </div>

                <div className="space-y-1 mt-3">
                  <span className="text-[9px] text-slate-500 line-clamp-2 leading-relaxed">
                    {prov.tagline}
                  </span>
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${hasKey ? "bg-emerald-400" : "bg-rose-500"}`} />
                    <span className="text-[8px] font-medium tracking-wide uppercase text-slate-400">
                      {hasKey ? "Chave Configurada" : "Chave Ausente"}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Individual Provider Configurations */}
        <div className="lg:col-span-2 space-y-5">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <h4 className="font-bold text-white text-sm">Configurações Individuais dos Provedores</h4>
            <span className="text-[10px] text-slate-400">Insira e valide as chaves separadamente</span>
          </div>

          {PROVIDERS_INFO.map((prov) => {
            const { key, model, setKey, setModel } = getProviderState(prov.id);
            const isSaving = savingProvider === prov.id;
            const isSaved = saveSuccess[prov.id];
            const isTesting = testingProvider === prov.id;
            const testResult = testResults[prov.id];
            const isCurrentlyActive = activeProvider === prov.id;

            return (
              <div 
                key={prov.id} 
                className={`bg-slate-900/60 border rounded-2xl p-5 space-y-4 transition-all ${
                  isCurrentlyActive 
                    ? "border-indigo-500/30 shadow-md shadow-indigo-500/5" 
                    : "border-white/5 hover:border-white/10"
                }`}
              >
                {/* Header of each section */}
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-2 rounded-lg ${prov.accentColor} shrink-0`}>
                      <Key className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                        {prov.name}
                        {isCurrentlyActive && (
                          <span className="text-[8px] bg-indigo-500/20 text-indigo-300 font-extrabold px-1.5 py-0.2 rounded border border-indigo-500/30">
                            PROVEDOR ATIVO
                          </span>
                        )}
                      </h5>
                      <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                        {prov.tagline}
                      </p>
                    </div>
                  </div>

                  <a 
                    href={prov.docUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 hover:underline whitespace-nowrap"
                  >
                    Obter Chave <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {/* Form fields for the provider */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* API Key Input */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Chave de API do {prov.name}
                    </label>
                    <div className="relative">
                      <input
                        type={showKeys[prov.id] ? "text" : "password"}
                        placeholder={prov.placeholder}
                        value={key}
                        onChange={(e) => {
                          setKey(e.target.value);
                          // Clear previous test results on key edit
                          if (testResults[prov.id]) {
                            setTestResults(prev => ({ ...prev, [prov.id]: null }));
                          }
                        }}
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 pr-10 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => toggleKeyVisibility(prov.id)}
                        className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-200 transition-colors"
                      >
                        {showKeys[prov.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Active Model */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Modelo do Provedor
                    </label>
                    <select
                      value={model}
                      onChange={(e) => {
                        setModel(e.target.value);
                        // Clear test results on model change
                        if (testResults[prov.id]) {
                          setTestResults(prev => ({ ...prev, [prov.id]: null }));
                        }
                      }}
                      className="w-full bg-slate-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                    >
                      {prov.models.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                </div>

                {/* Test results, feedback and buttons for each provider */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1">
                  
                  {/* Left alignment: Connection test messages */}
                  <div className="flex-1 min-w-0">
                    {testResult && (
                      <div className={`p-2.5 rounded-lg text-[10px] leading-relaxed flex items-start gap-2 border ${
                        testResult.success
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                          : "bg-rose-500/10 border-rose-500/20 text-rose-300"
                      }`}>
                        {testResult.success ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                        )}
                        <span className="break-words font-medium">{testResult.message}</span>
                      </div>
                    )}

                    {isSaved && (
                      <div className="text-emerald-400 text-[10px] font-bold flex items-center gap-1.5 animate-pulse">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Configurações salvas e aplicadas com sucesso!
                      </div>
                    )}
                  </div>

                  {/* Right alignment: Buttons */}
                  <div className="flex items-center gap-2.5 self-end md:self-auto shrink-0">
                    <button
                      type="button"
                      disabled={isTesting || isSaving}
                      onClick={() => handleTestConnection(prov.id)}
                      className="px-4 py-2 bg-slate-950 border border-white/10 hover:border-white/20 text-slate-300 hover:text-white font-bold rounded-xl text-[10.5px] transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      {isTesting ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
                          Testando...
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 text-slate-400 fill-slate-400" />
                          Testar Conexão
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={isSaving || isTesting}
                      onClick={() => handleSaveProvider(prov.id)}
                      className="px-4 py-2 bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-500/25 text-indigo-300 hover:text-indigo-200 font-bold rounded-xl text-[10.5px] transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      {isSaving ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Salvando...
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Salvar Chave
                        </>
                      )}
                    </button>
                  </div>

                </div>

              </div>
            );
          })}

          {/* Form level save all buttons */}
          <div className="bg-slate-900/30 border border-white/5 rounded-2xl p-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {globalSaveSuccess ? (
                <span className="text-emerald-400 text-xs font-bold flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4" />
                  Todas as credenciais salvas e sincronizadas!
                </span>
              ) : (
                <span className="text-[10px] text-slate-500 max-w-sm leading-normal">
                  *As chaves de API permanecem ativas em sua sessão. Recomendamos testar as chaves individualmente antes de salvar de forma definitiva.
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleSaveAll}
              disabled={savingAll}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-indigo-600/20 border border-white/10 flex items-center gap-2 transition-all cursor-pointer"
            >
              {savingAll ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Salvando Tudo...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Salvar Todas as Chaves
                </>
              )}
            </button>
          </div>

        </div>

        {/* Right Column: Connection Status & Quick Support Info */}
        <div className="space-y-6">
          
          {/* Connection Overview Board */}
          <div className="bg-slate-900/60 border border-white/5 backdrop-blur-md rounded-2xl p-5 space-y-4 shadow-xl">
            <h4 className="font-bold text-white text-xs uppercase tracking-wider">Status Geral de Conectividade</h4>
            
            <div className="space-y-3.5">
              {PROVIDERS_INFO.map((prov) => {
                const { key } = getProviderState(prov.id);
                const isCurrentlyActive = activeProvider === prov.id;
                const hasKey = key && key.trim().length > 5;

                return (
                  <div key={prov.id} className="flex items-center justify-between text-xs border-b border-white/5 pb-2.5 last:border-0 last:pb-0">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${isCurrentlyActive ? "bg-indigo-400" : "bg-slate-700"}`} />
                        <span className="font-semibold text-slate-200">{prov.name}</span>
                      </div>
                      <span className="text-[9px] text-slate-500 pl-3.5">
                        {isCurrentlyActive ? "Ativo" : "Secundário"}
                      </span>
                    </div>

                    <div className="text-right">
                      {hasKey ? (
                        <span className="text-emerald-400 font-bold text-[10px] flex items-center gap-1.5 justify-end">
                          <Check className="w-3.5 h-3.5" />
                          Configurado
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[10px] italic">Sem chave</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Guidelines / Help */}
          <div className="bg-gradient-to-br from-slate-900/40 to-slate-950/60 border border-white/5 rounded-2xl p-5 space-y-4 shadow-xl">
            <h4 className="font-bold text-white text-xs uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              Como obter chaves de API?
            </h4>
            
            <div className="space-y-3.5 text-xs text-slate-400 leading-relaxed">
              <div className="border-l-2 border-blue-500/40 pl-3 space-y-1">
                <p className="font-bold text-slate-300">Google Gemini Key</p>
                <p className="text-[10.5px]">Acesse o <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Google AI Studio <ExternalLink className="w-2.5 h-2.5 inline" /></a> e clique em "Create API Key". Chaves de teste básicas são gratuitas.</p>
              </div>

              <div className="border-l-2 border-emerald-500/40 pl-3 space-y-1">
                <p className="font-bold text-slate-300">OpenAI API Key</p>
                <p className="text-[10.5px]">Crie chaves de API em <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">OpenAI Dashboard <ExternalLink className="w-2.5 h-2.5 inline" /></a>. Certifique-se de ter saldo ativo.</p>
              </div>

              <div className="border-l-2 border-amber-600/40 pl-3 space-y-1">
                <p className="font-bold text-slate-300">Anthropic Claude Key</p>
                <p className="text-[10.5px]">Disponíveis no console oficial em <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">Anthropic Console <ExternalLink className="w-2.5 h-2.5 inline" /></a>.</p>
              </div>

              <div className="border-l-2 border-purple-500/40 pl-3 space-y-1">
                <p className="font-bold text-slate-300">DeepSeek API Key</p>
                <p className="text-[10.5px]">Crie sua chave de API e carregue saldo pré-pago no site da <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">DeepSeek Platform <ExternalLink className="w-2.5 h-2.5 inline" /></a>.</p>
              </div>
            </div>
          </div>

        </div>

      </div>

    </div>
  );
}
