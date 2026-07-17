import { useState, useEffect } from "react";
import { 
  FileText, ShieldCheck, Database, FolderGit, FileSpreadsheet, CloudLightning, 
  HelpCircle, Settings, LogIn, ExternalLink, RefreshCw, LogOut, CheckCircle, ListTodo, Calculator, Sparkles, Cpu, Users,
  Menu, X, ChevronLeft, ChevronRight, Search, AlertTriangle
} from "lucide-react";
import { CompanyData, EditalAnalysis, SyncItem } from "./types";
import EditalAnalyzerTab from "./components/EditalAnalyzerTab";
import RadarOportunidadesTab from "./components/RadarOportunidadesTab";
import CompanyDocsTab from "./components/CompanyDocsTab";
import PricingCalculatorTab from "./components/PricingCalculatorTab";
import ProductComparatorTab from "./components/ProductComparatorTab";
import LanceBotTab from "./components/LanceBotTab";
import CompetitorAnalyzerTab from "./components/CompetitorAnalyzerTab";
import AiConfigTab from "./components/AiConfigTab";
import FloatingAiChat from "./components/FloatingAiChat";
import DocPreviewModal from "./components/DocPreviewModal";
import { 
  getSyncedItems, getGoogleAccessToken, isGoogleConnected, initAuth, googleSignIn, logout 
} from "./utils/googleSync";
import {
  getSupabaseConfig,
  getSupabaseClient,
  signUpWithSupabase,
  signInWithSupabase,
  signOutWithSupabase,
  fetchCompanyDataFromSupabase,
  fetchUserConfigFromSupabase,
  saveCompanyDataToSupabase
} from "./utils/supabaseClient";
import SupabaseLoginScreen from "./components/SupabaseLoginScreen";
import ThemeToggle from "./components/ThemeToggle";

// Default Initial Corporate profile representing a Brazilian company 
const DEFAULT_COMPANY_DATA: CompanyData = {
  razonSocial: "",
  cnpj: "",
  address: "",
  phone: "",
  email: "",
  representativeName: "",
  representativeCpf: "",
  bankDetails: ""
};

export default function App() {
  const [activeTab, setActiveTab ] = useState<"analyzer" | "radar" | "documents" | "calculator" | "comparator" | "bot" | "competitors" | "aiConfig">("analyzer");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Dark/Light theme state removed as requested
  
  // App-wide state
  const [companyData, setCompanyData] = useState<CompanyData>(() => {
    const saved = localStorage.getItem("aip_company_data");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Clear fictitious default remnants of previous builds from user's cache
        if (
          parsed.razonSocial?.toUpperCase().includes("VORTEX") || 
          parsed.cnpj === "28.452.910/0001-44" ||
          parsed.representativeCpf === "402.129.558-02" ||
          parsed.representativeName?.includes("Siqueira")
        ) {
          localStorage.removeItem("aip_company_data");
          return DEFAULT_COMPANY_DATA;
        }
        return parsed;
      } catch (e) {
        return DEFAULT_COMPANY_DATA;
      }
    }
    return DEFAULT_COMPANY_DATA;
  });

  const [activeEdital, setActiveEdital] = useState<EditalAnalysis | null>(() => {
    const saved = localStorage.getItem("aip_active_edital");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  // Synced files stream
  const [syncedItems, setSyncedItems] = useState<SyncItem[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Supabase SaaS states
  const [supabaseUser, setSupabaseUser] = useState<any | null>(null);
  const [supabaseModalOpen, setSupabaseModalOpen] = useState(false);
  const [saasPlan, setSaasPlan] = useState<string>(() => {
    return localStorage.getItem("supabase_saas_plan") || "Free";
  });
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [aiQuotaWarning, setAiQuotaWarning] = useState<string | null>(null);

  useEffect(() => {
    const handleQuotaWarning = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.message) {
        setAiQuotaWarning(customEvent.detail.message);
      }
    };
    window.addEventListener("ai-quota-warning", handleQuotaWarning);
    return () => {
      window.removeEventListener("ai-quota-warning", handleQuotaWarning);
    };
  }, []);

  // Supabase dynamic auth credentials inside modal
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState<{ success: boolean; message: string } | null>(null);
  const [activeProvider, setActiveProvider] = useState<string>("gemini");

  // Sync Log list
  const [syncLogs, setSyncLogs] = useState<string[]>([
    "Sistema inicializado com sucesso.",
    "Módulo de conformidade regulatória pronto."
  ]);

  // Modal preview states
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{
    title: string;
    markdown: string;
    type: "proposal" | "declaration";
  }>({
    title: "",
    markdown: "",
    type: "proposal"
  });

  // Clean any remnant test/fictional keys from local storage
  useEffect(() => {
    const keysToCheck = ["ai_gemini_key", "ai_openai_key", "ai_anthropic_key", "ai_deepseek_key"];
    keysToCheck.forEach(key => {
      const val = localStorage.getItem(key);
      if (val && (
        val === "AIzaSy..." || 
        val.startsWith("AIzaSy-placeholder") || 
        val === "sk-proj-..." || 
        val === "sk-ant-..." || 
        val === "sk-..." || 
        val.includes("placeholder")
      )) {
        localStorage.removeItem(key);
      }
    });
  }, []);

  // Sync provider state on load and config updates
  useEffect(() => {
    const syncActiveProvider = () => {
      setActiveProvider(localStorage.getItem("ai_active_provider") || "gemini");
    };
    syncActiveProvider();
    window.addEventListener("user-config-loaded", syncActiveProvider);
    return () => {
      window.removeEventListener("user-config-loaded", syncActiveProvider);
    };
  }, []);

  const handleGlobalProviderChange = async (newProvider: string) => {
    setActiveProvider(newProvider);
    localStorage.setItem("ai_active_provider", newProvider);
    addLogMessage(`Provedor de IA ativo alterado para: ${newProvider}`);
    window.dispatchEvent(new Event("user-config-loaded"));

    // Persist to Supabase dynamically
    if (supabaseUser) {
      try {
        const { saveUserConfigToSupabase, fetchUserConfigFromSupabase } = await import("./utils/supabaseClient");
        const currentConfig = await fetchUserConfigFromSupabase();
        
        await saveUserConfigToSupabase({
          activeProvider: newProvider,
          geminiKey: currentConfig?.gemini_key || localStorage.getItem("ai_gemini_key") || "",
          geminiModel: currentConfig?.gemini_model || localStorage.getItem("ai_gemini_model") || "gemini-3.5-flash",
          openaiKey: currentConfig?.openai_key || localStorage.getItem("ai_openai_key") || "",
          openaiModel: currentConfig?.openai_model || localStorage.getItem("ai_openai_model") || "gpt-4o",
          anthropicKey: currentConfig?.anthropic_key || localStorage.getItem("ai_anthropic_key") || "",
          anthropicModel: currentConfig?.anthropic_model || localStorage.getItem("ai_anthropic_model") || "claude-3-7-sonnet-20250219",
          deepseekKey: currentConfig?.deepseek_key || localStorage.getItem("ai_deepseek_key") || "",
          deepseekModel: currentConfig?.deepseek_model || localStorage.getItem("ai_deepseek_model") || "deepseek-chat"
        });
      } catch (err) {
        console.warn("Erro ao salvar mudança global de provedor no Supabase:", err);
      }
    }
  };

  const loadUserDataFromSupabase = async (user: any) => {
    if (!user) return;
    try {
      addLogMessage(`Carregando dados específicos do usuário do Supabase...`);
      
      // 1. Fetch Company Data
      const dbCompany = await fetchCompanyDataFromSupabase();
      if (dbCompany) {
        const loadedCompany: CompanyData = {
          razonSocial: dbCompany.razon_social || "",
          cnpj: dbCompany.cnpj || "",
          address: dbCompany.address || "",
          phone: dbCompany.phone || "",
          email: dbCompany.email || "",
          representativeName: dbCompany.representative_name || "",
          representativeCpf: dbCompany.representative_cpf || "",
          bankDetails: dbCompany.bank_details || ""
        };
        setCompanyData(loadedCompany);
        localStorage.setItem("aip_company_data", JSON.stringify(loadedCompany));
        addLogMessage("Perfil corporativo do usuário carregado com sucesso.");
      } else if (user?.user_metadata) {
        const meta = user.user_metadata;
        const loadedCompany: CompanyData = {
          razonSocial: "",
          cnpj: "",
          address: "",
          phone: meta.phone || "",
          email: user.email || "",
          representativeName: meta.full_name || "",
          representativeCpf: "",
          bankDetails: ""
        };
        setCompanyData(loadedCompany);
        localStorage.setItem("aip_company_data", JSON.stringify(loadedCompany));
        addLogMessage("Perfil corporativo inicializado a partir do cadastro.");
      }

      // 2. Fetch User AI Config / Keys
      const dbConfig = await fetchUserConfigFromSupabase();
      if (dbConfig) {
        if (dbConfig.active_provider) localStorage.setItem("ai_active_provider", dbConfig.active_provider);
        
        if (dbConfig.gemini_key && dbConfig.gemini_key.trim().length > 5) {
          localStorage.setItem("ai_gemini_key", dbConfig.gemini_key);
        }
        if (dbConfig.gemini_model) localStorage.setItem("ai_gemini_model", dbConfig.gemini_model);

        if (dbConfig.openai_key && dbConfig.openai_key.trim().length > 5) {
          localStorage.setItem("ai_openai_key", dbConfig.openai_key);
        }
        if (dbConfig.openai_model) localStorage.setItem("ai_openai_model", dbConfig.openai_model);

        if (dbConfig.anthropic_key && dbConfig.anthropic_key.trim().length > 5) {
          localStorage.setItem("ai_anthropic_key", dbConfig.anthropic_key);
        }
        if (dbConfig.anthropic_model) localStorage.setItem("ai_anthropic_model", dbConfig.anthropic_model);

        if (dbConfig.deepseek_key && dbConfig.deepseek_key.trim().length > 5) {
          localStorage.setItem("ai_deepseek_key", dbConfig.deepseek_key);
        }
        if (dbConfig.deepseek_model) localStorage.setItem("ai_deepseek_model", dbConfig.deepseek_model);

        addLogMessage("Configurações de chaves de API do usuário carregadas.");
      }
      window.dispatchEvent(new Event("user-config-loaded"));
    } catch (e: any) {
      console.error("Erro ao carregar dados do usuário do Supabase:", e);
    }
  };

  // Load persistence and sync profile to Supabase
  useEffect(() => {
    if (companyData && companyData !== DEFAULT_COMPANY_DATA) {
      localStorage.setItem("aip_company_data", JSON.stringify(companyData));
      if (supabaseUser) {
        saveCompanyDataToSupabase(companyData).catch((e) =>
          console.warn("Erro ao salvar perfil corporativo no Supabase:", e)
        );
      }
    }
  }, [companyData, supabaseUser]);

  useEffect(() => {
    if (activeEdital) {
      localStorage.setItem("aip_active_edital", JSON.stringify(activeEdital));
    } else {
      localStorage.removeItem("aip_active_edital");
    }
  }, [activeEdital]);

  useEffect(() => {
    // Read synced items list
    setSyncedItems(getSyncedItems());
    setGoogleConnected(isGoogleConnected());

    const unsubscribe = initAuth(
      (user) => {
        setGoogleConnected(true);
        setUserEmail(user.email);
        addLogMessage(`Sincronismo com Google Workspace ativo: ${user.email}`);
      },
      () => {
        setGoogleConnected(false);
        setUserEmail(null);
      }
    );

    const handleSyncUpdate = () => {
      setSyncedItems(getSyncedItems());
      setGoogleConnected(isGoogleConnected());
    };
    window.addEventListener("gdrive-sync-updated", handleSyncUpdate);

    return () => {
      unsubscribe();
      window.removeEventListener("gdrive-sync-updated", handleSyncUpdate);
    };
  }, []);

  // Sync Supabase user session on mount
  useEffect(() => {
    const config = getSupabaseConfig();
    const isConn = !!config.url && !!config.anonKey;
    setSupabaseConnected(isConn);

    if (isConn) {
      const client = getSupabaseClient();
      if (client) {
        client.auth.getUser().then(({ data }) => {
          if (data?.user) {
            setSupabaseUser(data.user);
            addLogMessage(`Sessão SaaS Supabase carregada: ${data.user.email}`);
            loadUserDataFromSupabase(data.user);
          }
        }).catch(() => {});

        // Listen for Auth changes in realtime
        const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
          if (session?.user) {
            setSupabaseUser(session.user);
            loadUserDataFromSupabase(session.user);
          } else {
            setSupabaseUser(null);
          }
        });

        return () => {
          subscription.unsubscribe();
        };
      }
    }
  }, [supabaseModalOpen]);

  const addLogMessage = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setSyncLogs(prev => [`[${timestamp}] ${msg}`, ...prev.slice(0, 8)]);
    // Re-trigger synced list refreshing
    setSyncedItems(getSyncedItems());
  };

  // Client side Google OAuth loader using Firebase SDK
  const handleGoogleLogin = async () => {
    try {
      addLogMessage("Iniciando fluxo de login do Google...");
      const result = await googleSignIn();
      if (result) {
        setGoogleConnected(true);
        setUserEmail(result.user.email);
        addLogMessage(`Conectado com sucesso à sua conta Google: ${result.user.email}`);
        addLogMessage("Pronto para sincronizar arquivos com o Google Drive e Sheets real!");
      }
    } catch (err: any) {
      console.error(err);
      addLogMessage(`Erro ao autenticar com o Google: ${err.message || err}`);
    }
  };

  const handleGoogleLogout = async () => {
    try {
      await logout();
      setGoogleConnected(false);
      setUserEmail(null);
      addLogMessage("Desconectado da conta Google Workspace.");
    } catch (err: any) {
      console.error(err);
      addLogMessage(`Erro ao fazer logout: ${err.message || err}`);
    }
  };

  const handleSaaSAuthAction = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthMessage(null);
    try {
      if (authMode === "signup") {
        const res = await signUpWithSupabase(authEmail, authPassword);
        setAuthMessage(res);
        if (res.success && res.user) {
          setSupabaseUser(res.user);
          addLogMessage(`Nova conta SaaS criada no Supabase Auth: ${res.user.email}`);
        }
      } else {
        const res = await signInWithSupabase(authEmail, authPassword);
        setAuthMessage(res);
        if (res.success && res.session?.user) {
          setSupabaseUser(res.session.user);
          loadUserDataFromSupabase(res.session.user);
          addLogMessage(`Sessão SaaS Supabase autenticada: ${res.session.user.email}`);
          setTimeout(() => setSupabaseModalOpen(false), 1500);
        }
      }
    } catch (err: any) {
      setAuthMessage({ success: false, message: err.message || "Erro no processamento da autenticação." });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSaaSSignOut = async () => {
    try {
      await signOutWithSupabase();
      
      // Clear user-specific data from localStorage for complete multi-user privacy
      localStorage.removeItem("aip_company_data");
      localStorage.removeItem("aip_active_edital");
      localStorage.removeItem("aip_certificates");
      localStorage.removeItem("aip_edital_history");
      localStorage.removeItem("aip_competitors_history");
      localStorage.removeItem("aip_chat_sessions");
      localStorage.removeItem("ai_active_provider");
      localStorage.removeItem("ai_gemini_key");
      localStorage.removeItem("ai_gemini_model");
      localStorage.removeItem("ai_openai_key");
      localStorage.removeItem("ai_openai_model");
      localStorage.removeItem("ai_anthropic_key");
      localStorage.removeItem("ai_anthropic_model");
      localStorage.removeItem("ai_deepseek_key");
      localStorage.removeItem("ai_deepseek_model");
      localStorage.removeItem("aip_comprasnet_token");
      localStorage.removeItem("aip_comprasnet_cookie");
      localStorage.removeItem("aip_pricing_simulations");
      
      // Reset state variables
      setCompanyData(DEFAULT_COMPANY_DATA);
      setActiveEdital(null);
      setSyncedItems([]);
      setSupabaseUser(null);

      addLogMessage("Sessão SaaS encerrada. Todos os dados locais e cache foram apagados.");
      setSupabaseModalOpen(false);
    } catch (err: any) {
      console.error(err);
      addLogMessage(`Erro ao encerrar sessão: ${err.message || err}`);
    }
  };

  const handleChangePlan = (newPlan: string) => {
    setSaasPlan(newPlan);
    localStorage.setItem("supabase_saas_plan", newPlan);
    addLogMessage(`Plano SaaS atualizado para: ${newPlan}`);
  };

  const handleOpenDocPreview = (title: string, markdown: string, type: "proposal" | "declaration") => {
    setPreviewData({ title, markdown, type });
    setPreviewModalOpen(true);
    addLogMessage(`Criado documento "${title}" via IA Gemini 3.5-flash.`);
  };
  
  if (!supabaseUser) {
    return (
      <SupabaseLoginScreen 
        onLoginSuccess={(user) => {
          setSupabaseUser(user);
          setSupabaseConnected(true);
          addLogMessage(`Sessão SaaS autenticada: ${user.email}`);
          loadUserDataFromSupabase(user);
        }} 
      />
    );
  }

  return (
    <div id="application-container" className="min-h-screen lg:h-screen lg:h-[100dvh] lg:overflow-hidden bg-[#0b0f19] text-slate-100 flex flex-col lg:flex-row font-sans select-text relative">
      
      {/* Glowing Frosted blur background elements */}
      <div className="absolute top-[-10%] right-[-15%] w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[110px] -z-10 pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[10%] w-[400px] h-[400px] bg-indigo-600/10 rounded-full blur-[90px] -z-10 pointer-events-none"></div>

      {/* Mobile Sticky Navbar Header */}
      <header className="lg:hidden bg-white/5 border-b border-white/10 backdrop-blur-xl text-white sticky top-0 z-40 px-4 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="bg-gradient-to-tr from-blue-500 to-indigo-600 text-white p-1.5 rounded-lg">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h1 className="text-sm font-bold tracking-tight text-white">
              Analisador Inteligente
            </h1>
          </div>
        </div>
        <ThemeToggle />
      </header>

      {/* Desktop Sidebar (Persistent) & Mobile Sidebar Drawer */}
      <aside 
        className={`
          fixed inset-y-0 left-0 z-50 lg:sticky lg:top-0 h-screen bg-[#0c101e]/95 lg:bg-[#0c101e]/60 border-r border-white/10 p-5 flex flex-col justify-between shadow-2xl backdrop-blur-xl lg:backdrop-blur-md transition-all duration-300 ease-in-out lg:translate-x-0
          ${sidebarCollapsed ? "lg:w-20 lg:p-3" : "lg:w-72 w-72"}
          ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        <div className="flex flex-col h-full gap-6">
          
          {/* Logo Brand info inside Sidebar */}
          <div className="flex items-center justify-between border-b border-white/5 pb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="bg-gradient-to-tr from-blue-500 to-indigo-600 text-white p-2 rounded-xl shadow-lg shadow-indigo-600/20 shrink-0">
                <ShieldCheck className="w-6 h-6 animate-pulse" />
              </div>
              {(!sidebarCollapsed || mobileMenuOpen) && (
                <div className="transition-opacity duration-200">
                  <h1 className="text-sm font-bold tracking-tight text-white leading-tight truncate">
                    Analisador de Editais
                  </h1>
                  <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider font-semibold truncate">
                    Auditoria de Certames
                  </p>
                </div>
              )}
            </div>
            
            {/* Collapse toggle button for desktop */}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden lg:flex p-1.5 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0"
              title={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
            >
              {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>

            {/* Close button for Mobile drawer only */}
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1 rounded-lg hover:bg-white/5 border border-transparent hover:border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Navigation Links (Vertical sidebar) */}
          <nav className="flex-1 space-y-1.5 overflow-y-auto pr-1 scrollbar-none">
            
            {/* Nav item: Análise de Edital */}
            <button
              id="tab-btn-analyzer"
              onClick={() => {
                setActiveTab("analyzer");
                setMobileMenuOpen(false);
              }}
              className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center transition-all cursor-pointer text-left ${
                sidebarCollapsed ? "lg:justify-center lg:px-0 px-3.5 gap-3" : "px-3.5 gap-3"
              } ${
                activeTab === "analyzer"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-indigo-600/25 border border-white/10"
                  : "bg-transparent text-slate-400 hover:text-slate-100 hover:bg-white/5"
              }`}
              title="Análise de Edital"
            >
              <FileText className="w-4 h-4 shrink-0" />
              <span className={`${sidebarCollapsed ? "lg:hidden block" : "block"}`}>Análise de Edital</span>
            </button>

            {/* Nav item: Radar de Oportunidades */}
            <button
              id="tab-btn-radar"
              onClick={() => {
                setActiveTab("radar");
                setMobileMenuOpen(false);
              }}
              className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center transition-all cursor-pointer text-left ${
                sidebarCollapsed ? "lg:justify-center lg:px-0 px-3.5 gap-3" : "px-3.5 gap-3"
              } ${
                activeTab === "radar"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-indigo-600/25 border border-white/10"
                  : "bg-transparent text-slate-400 hover:text-slate-100 hover:bg-white/5"
              }`}
              title="Radar de Oportunidades"
            >
              <Search className="w-4 h-4 text-sky-400 shrink-0" />
              <span className={`${sidebarCollapsed ? "lg:hidden block" : "block"}`}>Radar de Oportunidades</span>
            </button>

            {/* Nav item: Gestão de Certidões */}
            <button
              id="tab-btn-documents"
              onClick={() => {
                setActiveTab("documents");
                setMobileMenuOpen(false);
              }}
              className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center transition-all cursor-pointer text-left ${
                sidebarCollapsed ? "lg:justify-center lg:px-0 px-3.5 gap-3" : "px-3.5 gap-3"
              } ${
                activeTab === "documents"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-indigo-600/25 border border-white/10"
                  : "bg-transparent text-slate-400 hover:text-slate-100 hover:bg-white/5"
              }`}
              title="Gestão de Certidões"
            >
              <ListTodo className="w-4 h-4 shrink-0" />
              <span className={`${sidebarCollapsed ? "lg:hidden block" : "block"}`}>Gestão de Certidões</span>
            </button>

            {/* Nav item: Calculadora */}
            <button
              id="tab-btn-calculator"
              onClick={() => {
                setActiveTab("calculator");
                setMobileMenuOpen(false);
              }}
              className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center transition-all cursor-pointer text-left ${
                sidebarCollapsed ? "lg:justify-center lg:px-0 px-3.5 gap-3" : "px-3.5 gap-3"
              } ${
                activeTab === "calculator"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-indigo-600/25 border border-white/10"
                  : "bg-transparent text-slate-400 hover:text-slate-100 hover:bg-white/5"
              }`}
              title="Calculadora de Preços"
            >
              <Calculator className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className={`${sidebarCollapsed ? "lg:hidden block" : "block"}`}>Calculadora de Preços</span>
            </button>

            {/* Nav item: Comparador de Produtos */}
            <button
              id="tab-btn-comparator"
              onClick={() => {
                setActiveTab("comparator");
                setMobileMenuOpen(false);
              }}
              className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center transition-all cursor-pointer text-left ${
                sidebarCollapsed ? "lg:justify-center lg:px-0 px-3.5 gap-3" : "px-3.5 gap-3"
              } ${
                activeTab === "comparator"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-indigo-600/25 border border-white/10"
                  : "bg-transparent text-slate-400 hover:text-slate-100 hover:bg-white/5"
              }`}
              title="Comparador de Produtos"
            >
              <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className={`${sidebarCollapsed ? "lg:hidden block" : "block"}`}>Comparador de Produtos</span>
            </button>

            {/* Nav item: Robô de Lances */}
            <button
              id="tab-btn-bot"
              onClick={() => {
                setActiveTab("bot");
                setMobileMenuOpen(false);
              }}
              className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center transition-all cursor-pointer text-left ${
                sidebarCollapsed ? "lg:justify-center lg:px-0 px-3.5 gap-3" : "px-3.5 gap-3"
              } ${
                activeTab === "bot"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-indigo-600/25 border border-white/10"
                  : "bg-transparent text-slate-400 hover:text-slate-100 hover:bg-white/5"
              }`}
              title="Robô de Lances"
            >
              <Cpu className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className={`${sidebarCollapsed ? "lg:hidden block" : "block"}`}>Robô de Lances</span>
            </button>

            {/* Nav item: Analisar Concorrentes */}
            <button
              id="tab-btn-competitors"
              onClick={() => {
                setActiveTab("competitors");
                setMobileMenuOpen(false);
              }}
              className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center transition-all cursor-pointer text-left ${
                sidebarCollapsed ? "lg:justify-center lg:px-0 px-3.5 gap-3" : "px-3.5 gap-3"
              } ${
                activeTab === "competitors"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-indigo-600/25 border border-white/10"
                  : "bg-transparent text-slate-400 hover:text-slate-100 hover:bg-white/5"
              }`}
              title="Analisar Concorrentes"
            >
              <Users className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className={`${sidebarCollapsed ? "lg:hidden block" : "block"}`}>Analisar Concorrentes</span>
            </button>

            {/* Nav item: IA & Modelos */}
            <button
              id="tab-btn-ai-config"
              onClick={() => {
                setActiveTab("aiConfig");
                setMobileMenuOpen(false);
              }}
              className={`w-full py-2.5 rounded-xl font-bold text-xs flex items-center transition-all cursor-pointer text-left ${
                sidebarCollapsed ? "lg:justify-center lg:px-0 px-3.5 gap-3" : "px-3.5 gap-3"
              } ${
                activeTab === "aiConfig"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-indigo-600/25 border border-white/10"
                  : "bg-transparent text-slate-400 hover:text-slate-100 hover:bg-white/5"
              }`}
              title="IA & Modelos"
            >
              <Settings className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className={`${sidebarCollapsed ? "lg:hidden block" : "block"}`}>IA & Modelos</span>
            </button>

          </nav>

          {/* Bottom Sidebar area: Google & Supabase connection Integration */}
          <div className={`border-t border-white/5 pt-4 space-y-3 ${sidebarCollapsed ? "lg:hidden block" : "block"}`}>
            


            {/* Active AI Selector */}
            <div className="p-3 rounded-xl border border-white/10 bg-[#0c101e]/80 text-slate-300 select-none text-[11px] flex flex-col gap-1.5">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">
                Inteligência Artificial Ativa
              </label>
              <select
                value={activeProvider}
                onChange={(e) => handleGlobalProviderChange(e.target.value)}
                className="w-full bg-slate-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
              >
                <option value="gemini">Google Gemini 3.5</option>
                <option value="openai">OpenAI ChatGPT (GPT-4o)</option>
                <option value="anthropic">Anthropic Claude 3.7</option>
                <option value="deepseek">DeepSeek (V3/R1)</option>
              </select>
            </div>
            
            {/* Supabase SaaS Identity Center */}
            <div className="p-3 rounded-xl border border-emerald-500/25 bg-slate-900/50 text-slate-300 select-none text-[11px] flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-bold block">Sessão SaaS Ativa</span>
                </div>
              </div>

              <div className="text-[10px] font-mono tracking-tight truncate text-slate-400">
                {supabaseUser?.email}
              </div>

              <button
                onClick={handleSaaSSignOut}
                className="py-1.5 px-2 rounded-lg font-bold text-[10px] transition-all flex items-center justify-center gap-1.5 cursor-pointer bg-rose-950/30 hover:bg-rose-950/50 text-rose-400 border border-rose-500/20 w-full"
                title="Sair da Plataforma"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sair da Plataforma</span>
              </button>
            </div>

            {/* Google Workspace connection */}
            {googleConnected ? (
              <div className="bg-emerald-950/25 border border-emerald-500/20 rounded-xl p-3 flex flex-col gap-2 select-none text-[11px] text-emerald-400">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <p className="font-bold block">Workspace Conectado</p>
                </div>
                <p className="text-[10px] text-slate-400 font-mono tracking-tight truncate">
                  {userEmail || "gabrieltrafego7@gmail.com"}
                </p>
                <button
                  onClick={handleGoogleLogout}
                  className="bg-rose-950/30 hover:bg-rose-950/50 border border-rose-500/20 hover:border-rose-500/30 py-1.5 rounded-lg text-rose-400 text-[10px] font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5 w-full"
                  title="Desconectar Google"
                >
                  <LogOut className="w-3 h-3" />
                  <span>Desconectar Google</span>
                </button>
              </div>
            ) : (
              <button
                onClick={handleGoogleLogin}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold transition-all cursor-pointer shadow-lg shadow-indigo-600/10 border border-white/10 flex items-center justify-center w-full py-2.5 px-3 rounded-xl text-[10px] gap-1.5"
                title="Conectar Workspace"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Conectar Workspace</span>
              </button>
            )}
          </div>

        </div>
      </aside>

      {/* Backdrop for Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div 
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-40 lg:hidden"
        />
      )}

      {/* Main Content Pane */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-auto lg:h-full lg:overflow-hidden">
        
        {/* Top bar header only for desktop to show page details & header spacing */}
        <header className="hidden lg:flex bg-white/5 border-b border-white/10 backdrop-blur-xl shrink-0 px-8 py-4 items-center justify-between relative z-30">
          <div>
            <h2 className="text-sm font-bold text-white tracking-wide uppercase">
              Painel Operacional
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              {activeTab === "analyzer" ? "Carregamento e Inteligência Artificial de Editais" :
               activeTab === "radar" ? "Radar de Licitações Públicas Federais (PNCP)" :
               activeTab === "documents" ? "Gestão de Habilitação Jurídica e Fiscal" :
               activeTab === "calculator" ? "Modelagem Financeira e BDI de Licitações" :
               activeTab === "comparator" ? "Compatibilização Técnica de Especificações" :
               activeTab === "bot" ? "Simulador de Disputa de Lances Finais" :
               activeTab === "aiConfig" ? "Configurações de Provedores e Modelos de IA" :
               "Auditoria Legal de Documentação de Concorrentes"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="text-[10px] font-mono text-slate-500 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-white/5">
              SISTEMA ATIVO (UTC)
            </div>
          </div>
        </header>

        {/* Content Scrolling Stage Area */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-visible lg:overflow-y-auto relative z-10 scrollbar-thin">
          <div className="max-w-7xl mx-auto w-full">
            
            {aiQuotaWarning && (
              <div className="mb-6 p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 backdrop-blur-md flex flex-col md:flex-row items-center justify-between gap-4 animate-fade-in">
                <div className="flex items-center gap-3">
                  <div className="bg-rose-500/20 text-rose-300 p-2 rounded-lg">
                    <AlertTriangle className="w-5 h-5 text-rose-400" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-rose-200 uppercase tracking-wide">Aviso de Limite de Cota</h4>
                    <p className="text-xs text-rose-300/90 mt-0.5 leading-relaxed">{aiQuotaWarning}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
                  <button
                    onClick={() => {
                      setActiveTab("aiConfig");
                      setAiQuotaWarning(null);
                    }}
                    className="flex-1 md:flex-none text-center bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-rose-500/20"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Configurar Minha Chave
                  </button>
                  <button
                    onClick={() => setAiQuotaWarning(null)}
                    className="p-2 hover:bg-white/5 border border-white/10 hover:border-white/20 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
                    title="Ignorar aviso"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Active Render Stage Tab Component */}
            <div className="select-text w-full">
              {activeTab === "analyzer" ? (
                <EditalAnalyzerTab 
                  companyData={companyData} 
                  activeEdital={activeEdital}
                  setActiveEdital={setActiveEdital}
                  onOpenDocPreview={handleOpenDocPreview}
                />
              ) : activeTab === "radar" ? (
                <RadarOportunidadesTab 
                  onSelectForAnalysis={(text) => {
                    localStorage.setItem("aip_auto_analyze_text", text);
                    setActiveTab("analyzer");
                    setTimeout(() => {
                      window.dispatchEvent(new Event("aip_trigger_external_text"));
                    }, 50);
                  }}
                />
              ) : activeTab === "documents" ? (
                <CompanyDocsTab 
                  companyData={companyData} 
                  setCompanyData={setCompanyData}
                  activeEdital={activeEdital}
                />
              ) : activeTab === "calculator" ? (
                <PricingCalculatorTab
                  companyData={companyData}
                  activeEdital={activeEdital}
                />
              ) : activeTab === "comparator" ? (
                <ProductComparatorTab
                  activeEdital={activeEdital}
                />
              ) : activeTab === "bot" ? (
                <LanceBotTab
                  activeEdital={activeEdital}
                />
              ) : activeTab === "aiConfig" ? (
                <AiConfigTab />
              ) : (
                <CompetitorAnalyzerTab
                  activeEdital={activeEdital}
                />
              )}
            </div>

          </div>
        </main>

      </div>

      {/* Dynamic Modal Previews */}
      <DocPreviewModal
        isOpen={previewModalOpen}
        onClose={() => setPreviewModalOpen(false)}
        title={previewData.title}
        initialMarkdown={previewData.markdown}
        type={previewData.type}
        onAddLog={addLogMessage}
      />

      {/* Supabase SaaS Authentication & Account Switcher Modal */}
      {supabaseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div className="w-full max-w-md bg-[#0f1524] border border-white/10 rounded-2xl overflow-hidden shadow-2xl relative">
            
            {/* Header */}
            <div className="p-5 border-b border-white/10 bg-gradient-to-r from-[#121c33] to-[#0f1524] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">Portal de Clientes SaaS</h3>
                  <p className="text-[10px] text-slate-400 font-medium">Supabase Auth Multi-tenant</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setSupabaseModalOpen(false);
                  setAuthMessage(null);
                }}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5">
              
              {!supabaseConnected ? (
                // Supabase not configured warning
                <div className="space-y-4 text-center py-4">
                  <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-full flex items-center justify-center mx-auto border border-amber-500/20">
                    <CloudLightning className="w-6 h-6 animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-bold text-slate-200 text-sm">Credenciais não configuradas</h4>
                    <p className="text-slate-400 text-xs leading-relaxed max-w-sm mx-auto">
                      Para usar a Autenticação SaaS real e isolar dados de múltiplos usuários, configure sua <strong>URL</strong> e <strong>Anon Key</strong> do Supabase primeiro.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSupabaseModalOpen(false);
                      setActiveTab("aiConfig");
                    }}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    Configurar Provedores de IA
                  </button>
                </div>
              ) : supabaseUser ? (
                // Active User Session panel
                <div className="space-y-5">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="font-bold text-emerald-300 text-xs">Sessão Ativa no Supabase</span>
                    </div>
                    
                    <div className="space-y-1.5 font-mono text-[11px] text-slate-300">
                      <div className="flex justify-between border-b border-white/5 pb-1 text-slate-400">
                        <span>Usuário</span>
                        <span className="font-bold text-white">{supabaseUser.email}</span>
                      </div>
                      <div className="flex justify-between border-b border-white/5 pb-1 text-slate-400">
                        <span>UUID</span>
                        <span className="font-bold text-slate-400 truncate max-w-[180px]" title={supabaseUser.id}>
                          {supabaseUser.id}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Plano Escolhido</span>
                        <span className="font-bold text-amber-400">{saasPlan}</span>
                      </div>
                    </div>
                  </div>

                  {/* Plan Switcher */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Escolha o Plano SaaS da Conta</label>
                    <div className="grid grid-cols-3 gap-2">
                      {["Free", "Pro", "Enterprise"].map((plan) => {
                        const isActive = saasPlan === plan;
                        return (
                          <button
                            key={plan}
                            onClick={() => handleChangePlan(plan)}
                            className={`py-2 px-1.5 rounded-xl text-[10px] font-bold border transition-all cursor-pointer ${
                              isActive 
                                ? "bg-amber-500/15 border-amber-500 text-amber-300" 
                                : "bg-slate-950 border-white/5 text-slate-500 hover:text-slate-300"
                            }`}
                          >
                            {plan === "Free" ? "Gratuito" : plan === "Pro" ? "SaaS Pro" : "Enterprise"}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-normal">
                      Ao trocar de plano, os limites e volume de análises são recalculados para este e-mail.
                    </p>
                  </div>

                  <div className="border-t border-white/5 pt-4 flex flex-col gap-2">
                    <button
                      onClick={handleSaaSSignOut}
                      className="w-full py-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Encerrar Sessão (Sign Out)
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => {
                        setSupabaseUser(null);
                        setAuthMode("signin");
                        setAuthMessage(null);
                      }}
                      className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-white/5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Users className="w-3.5 h-3.5" />
                      Entrar com Outro Usuário
                    </button>
                  </div>
                </div>
              ) : (
                // Authentication Form (Login / Register)
                <form onSubmit={handleSaaSAuthAction} className="space-y-4">
                  {/* Selector */}
                  <div className="flex bg-slate-950 p-1 rounded-xl border border-white/5">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("signin");
                        setAuthMessage(null);
                      }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        authMode === "signin"
                          ? "bg-slate-800 text-white shadow"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      Acessar Conta
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode("signup");
                        setAuthMessage(null);
                      }}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                        authMode === "signup"
                          ? "bg-slate-800 text-white shadow"
                          : "text-slate-500 hover:text-slate-300"
                      }`}
                    >
                      Criar Nova Conta
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Endereço de E-mail</label>
                      <input
                        type="email"
                        required
                        placeholder="seu-email@exemplo.com"
                        value={authEmail}
                        onChange={(e) => setAuthEmail(e.target.value)}
                        className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Senha Secreta</label>
                      <input
                        type="password"
                        required
                        placeholder="••••••••"
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        className="w-full bg-slate-950 border border-white/10 rounded-lg p-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  {authMessage && (
                    <div className={`p-3 rounded-lg text-[11px] leading-relaxed border ${
                      authMessage.success
                        ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                        : "bg-rose-500/10 border-rose-500/20 text-rose-300"
                    }`}>
                      {authMessage.message}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 border border-indigo-500/25 cursor-pointer"
                  >
                    {authLoading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Autenticando...
                      </>
                    ) : authMode === "signup" ? (
                      <>
                        <Users className="w-3.5 h-3.5" />
                        Criar Conta SaaS
                      </>
                    ) : (
                      <>
                        <LogIn className="w-3.5 h-3.5" />
                        Entrar na Plataforma
                      </>
                    )}
                  </button>
                </form>
              )}

              <div className="text-[10px] text-slate-500 bg-slate-950/40 p-3 rounded-lg border border-white/5 leading-relaxed">
                ℹ️ <strong>Isolamento Multi-tenant:</strong> Ao logar com e-mails diferentes, o Supabase Auth atribui IDs únicos (UUIDs) para cada usuário. Suas análises e documentos são segregados automaticamente, permitindo simular perfeitamente um SaaS em produção!
              </div>

            </div>

          </div>
        </div>
      )}

      {/* Bottom Floating Interactive Chat popup */}
      <FloatingAiChat 
        companyData={companyData} 
        activeEdital={activeEdital}
      />

    </div>
  );
}
