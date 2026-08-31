import { useState, useEffect, useRef } from "react";
import {
  FileText, ShieldCheck, FolderGit, FileSpreadsheet, CloudLightning,
  HelpCircle, Settings, LogIn, ExternalLink, RefreshCw, LogOut, ListTodo, Calculator, Sparkles, Cpu, Users,
  Search, AlertTriangle, Check, FileEdit, ChevronsUpDown, CircleUser
} from "lucide-react";
import { CompanyData, EditalAnalysis, SyncItem } from "./types";
import EditalAnalyzerTab from "./components/EditalAnalyzerTab";
import RadarOportunidadesTab from "./components/RadarOportunidadesTab";
import DisputasSheetTab from "./components/DisputasSheetTab";
import CompanyDocsTab from "./components/CompanyDocsTab";
import CreateDocTab from "./components/CreateDocTab";
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
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Progress } from "./components/ui/progress";
import { Separator } from "./components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "./components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "./components/ui/sidebar";

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

type TabId = "analyzer" | "radar" | "disputasSheet" | "createDoc" | "documents" | "calculator" | "comparator" | "bot" | "competitors" | "aiConfig";

const CORE_NAV: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: "analyzer", label: "Análise de Edital", icon: FileText },
  { id: "radar", label: "Radar de Oportunidades", icon: Search },
  { id: "disputasSheet", label: "Planilha de Disputas", icon: FileSpreadsheet },
];

const OPERATIONS_NAV: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: "createDoc", label: "Criar Documentos", icon: FileEdit },
  { id: "documents", label: "Gestão de Certidões", icon: ListTodo },
  { id: "calculator", label: "Calculadora de Preços", icon: Calculator },
  { id: "comparator", label: "Comparador de Produtos", icon: Sparkles },
  { id: "bot", label: "Robô de Lances", icon: Cpu },
  { id: "competitors", label: "Analisar Concorrentes", icon: Users },
];

const TAB_LABELS: Record<TabId, string> = {
  analyzer: "Análise de Edital",
  radar: "Radar de Oportunidades",
  disputasSheet: "Planilha de Disputas",
  createDoc: "Criar Documentos",
  documents: "Gestão de Certidões",
  calculator: "Calculadora de Preços",
  comparator: "Comparador de Produtos",
  bot: "Robô de Lances",
  competitors: "Analisar Concorrentes",
  aiConfig: "IA & Modelos",
};

const AI_PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini 3.5",
  openai: "GPT-4o",
  anthropic: "Claude 3.7",
  deepseek: "DeepSeek V3",
};

const AI_PROVIDERS = [
  { id: "gemini", name: "Gemini 3.5", desc: "Google AI" },
  { id: "openai", name: "GPT-4o", desc: "OpenAI" },
  { id: "anthropic", name: "Claude 3.7", desc: "Anthropic" },
  { id: "deepseek", name: "DeepSeek V3", desc: "DeepSeek" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("analyzer");

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
          geminiModel: currentConfig?.gemini_model || localStorage.getItem("ai_gemini_model") || "gemini-3.6-flash",
          openaiKey: currentConfig?.openai_key || localStorage.getItem("ai_openai_key") || "",
          openaiModel: currentConfig?.openai_model || localStorage.getItem("ai_openai_model") || "gpt-4o",
          anthropicKey: currentConfig?.anthropic_key || localStorage.getItem("ai_anthropic_key") || "",
          anthropicModel: currentConfig?.anthropic_model || localStorage.getItem("ai_anthropic_model") || "claude-sonnet-5",
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

  const userInitial = supabaseUser?.email ? supabaseUser.email[0].toUpperCase() : "U";
  const userHandle = supabaseUser?.email?.split("@")[0] || "Usuário";

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent active:bg-transparent">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0">
                  <ShieldCheck className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold font-mono tracking-wide">HORASIS</span>
                  <span className="truncate text-xs text-muted-foreground">Enterprise SaaS v3.0</span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Core</SidebarGroupLabel>
            <SidebarMenu>
              {CORE_NAV.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    id={`tab-btn-${item.id}`}
                    tooltip={item.label}
                    isActive={activeTab === item.id}
                    onClick={() => setActiveTab(item.id)}
                    className="cursor-pointer"
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Operations</SidebarGroupLabel>
            <SidebarMenu>
              {OPERATIONS_NAV.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    id={`tab-btn-${item.id}`}
                    tooltip={item.label}
                    isActive={activeTab === item.id}
                    onClick={() => setActiveTab(item.id)}
                    className="cursor-pointer"
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Settings</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  id="tab-btn-ai-config"
                  tooltip="IA & Modelos"
                  isActive={activeTab === "aiConfig"}
                  onClick={() => setActiveTab("aiConfig")}
                  className="cursor-pointer"
                >
                  <Settings />
                  <span>IA & Modelos</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <div className="group-data-[collapsible=icon]:hidden space-y-2.5 px-1 pb-1">
            {/* Plan usage progress bar (Tokens / Quota Card) */}
            <div className="bg-sidebar-accent/60 border border-sidebar-border text-sidebar-foreground p-3 rounded-lg space-y-2">
              <div className="flex justify-between items-center text-xs font-medium">
                <span className="text-muted-foreground">Tokens / Cota IA</span>
                <span className="font-mono font-semibold">40%</span>
              </div>
              <Progress value={40} className="h-1.5" />
            </div>

            {/* Upgrade Plan Secondary Button */}
            <Button
              variant="outline"
              size="sm"
              className="w-full cursor-pointer justify-center gap-2"
              onClick={() => setActiveTab("aiConfig")}
            >
              <Sparkles className="size-3.5" />
              Upgrade Plan
            </Button>

            {/* Active AI Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="w-full cursor-pointer justify-between font-normal">
                  <span className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-primary animate-pulse" />
                    {AI_PROVIDER_LABELS[activeProvider] || activeProvider}
                  </span>
                  <ChevronsUpDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
                {AI_PROVIDERS.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onClick={() => handleGlobalProviderChange(p.id)}
                    className="cursor-pointer justify-between"
                  >
                    <span>{p.name}</span>
                    {activeProvider === p.id && <Check className="size-3.5" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg" className="cursor-pointer data-[state=open]:bg-sidebar-accent">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-primary text-primary-foreground font-semibold text-xs">
                        {userInitial}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{userHandle}</span>
                      <span className="truncate text-xs text-muted-foreground">Plano {saasPlan}</span>
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                  side="top"
                  align="end"
                  sideOffset={4}
                >
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                      <Avatar className="size-8 rounded-lg">
                        <AvatarFallback className="rounded-lg bg-primary text-primary-foreground font-semibold text-xs">
                          {userInitial}
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-medium">{userHandle}</span>
                        <span className="truncate text-xs text-muted-foreground">{supabaseUser?.email}</span>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setSupabaseModalOpen(true)} className="cursor-pointer">
                      <CircleUser />
                      Portal de Clientes SaaS
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setActiveTab("aiConfig")} className="cursor-pointer">
                      <Settings />
                      IA & Modelos
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSaaSSignOut} className="cursor-pointer text-destructive focus:text-destructive">
                    <LogOut />
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        {/* Top Bar Header */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b sticky top-0 z-30 bg-background">
          <div className="flex w-full items-center gap-2 px-4 lg:px-6">
            <SidebarTrigger className="-ml-1 cursor-pointer" />
            <Separator orientation="vertical" className="mx-1 h-4" />

            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-semibold font-mono tracking-tight shrink-0">HORASIS</span>
              <span className="text-sm text-muted-foreground shrink-0">/</span>
              <span className="text-sm font-medium text-foreground truncate">
                {TAB_LABELS[activeTab]}
              </span>
            </div>

            <div className="ml-auto flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                className="cursor-pointer"
                onClick={() => setActiveTab("analyzer")}
              >
                <FileText />
                <span className="hidden sm:inline">Analisar Novo Edital</span>
                <span className="sm:hidden">Novo Edital</span>
              </Button>

              <Button variant="ghost" size="icon" className="cursor-pointer" title="Notificações e Suporte">
                <HelpCircle />
              </Button>

              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Content Stage Area */}
        <main className="flex-1 p-4 md:p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="select-text w-full">
              {activeTab === "analyzer" ? (
                <EditalAnalyzerTab
                  companyData={companyData}
                  activeEdital={activeEdital}
                  setActiveEdital={setActiveEdital}
                  onOpenDocPreview={handleOpenDocPreview}
                  onNavigateToCreateDoc={() => setActiveTab("createDoc")}
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
              ) : activeTab === "disputasSheet" ? (
                <DisputasSheetTab
                  activeEdital={activeEdital}
                  onNavigateToAnalyzer={() => setActiveTab("analyzer")}
                />
              ) : activeTab === "createDoc" ? (
                <CreateDocTab
                  companyData={companyData}
                  activeEdital={activeEdital}
                  onOpenDocPreview={handleOpenDocPreview}
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
      </SidebarInset>

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
      <Dialog open={supabaseModalOpen} onOpenChange={(open) => { setSupabaseModalOpen(open); if (!open) setAuthMessage(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <div className="p-2 bg-accent text-accent-foreground rounded-lg border">
                <Users className="size-4" />
              </div>
              Portal de Clientes SaaS
            </DialogTitle>
            <DialogDescription>Supabase Auth Multi-tenant</DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {!supabaseConnected ? (
              // Supabase not configured warning
              <div className="space-y-4 text-center py-4">
                <div className="w-12 h-12 bg-warning/15 text-warning rounded-full flex items-center justify-center mx-auto border border-warning/30">
                  <CloudLightning className="w-6 h-6 animate-pulse" />
                </div>
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm">Credenciais não configuradas</h4>
                  <p className="text-muted-foreground text-xs leading-relaxed max-w-sm mx-auto">
                    Para usar a Autenticação SaaS real e isolar dados de múltiplos usuários, configure sua <strong>URL</strong> e <strong>Anon Key</strong> do Supabase primeiro.
                  </p>
                </div>
                <Button
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => {
                    setSupabaseModalOpen(false);
                    setActiveTab("aiConfig");
                  }}
                >
                  Configurar Provedores de IA
                </Button>
              </div>
            ) : supabaseUser ? (
              // Active User Session panel
              <div className="space-y-5">
                <div className="bg-success/10 border border-success/30 p-4 rounded-lg space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-success animate-pulse" />
                    <span className="font-semibold text-success text-xs">Sessão Ativa no Supabase</span>
                  </div>

                  <div className="space-y-1.5 font-mono text-[11px]">
                    <div className="flex justify-between border-b border-success/20 pb-1 text-muted-foreground">
                      <span>Usuário</span>
                      <span className="font-semibold text-foreground truncate max-w-[200px]">{supabaseUser.email}</span>
                    </div>
                    <div className="flex justify-between border-b border-success/20 pb-1 text-muted-foreground">
                      <span>UUID</span>
                      <span className="font-semibold truncate max-w-[180px]" title={supabaseUser.id}>
                        {supabaseUser.id}
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Plano Escolhido</span>
                      <span className="font-semibold text-foreground">{saasPlan}</span>
                    </div>
                  </div>
                </div>

                {/* Plan Switcher */}
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">Escolha o Plano SaaS da Conta</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {["Free", "Pro", "Enterprise"].map((plan) => {
                      const isActive = saasPlan === plan;
                      return (
                        <Button
                          key={plan}
                          type="button"
                          variant={isActive ? "default" : "outline"}
                          size="sm"
                          className="cursor-pointer text-xs"
                          onClick={() => handleChangePlan(plan)}
                        >
                          {plan === "Free" ? "Gratuito" : plan === "Pro" ? "SaaS Pro" : "Enterprise"}
                        </Button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground leading-normal">
                    Ao trocar de plano, os limites e volume de análises são recalculados para este e-mail.
                  </p>
                </div>

                <Separator />

                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    className="w-full cursor-pointer text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                    onClick={handleSaaSSignOut}
                  >
                    <LogOut />
                    Encerrar Sessão (Sign Out)
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full cursor-pointer"
                    onClick={() => {
                      setSupabaseUser(null);
                      setAuthMode("signin");
                      setAuthMessage(null);
                    }}
                  >
                    <Users />
                    Entrar com Outro Usuário
                  </Button>
                </div>
              </div>
            ) : (
              // Authentication Form (Login / Register)
              <form onSubmit={handleSaaSAuthAction} className="space-y-4">
                {/* Selector */}
                <div className="flex bg-muted p-1 rounded-lg border">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode("signin");
                      setAuthMessage(null);
                    }}
                    className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      authMode === "signin"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
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
                    className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      authMode === "signup"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Criar Nova Conta
                  </button>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="saas-email" className="text-xs uppercase tracking-wider text-muted-foreground">Endereço de E-mail</Label>
                    <Input
                      id="saas-email"
                      type="email"
                      required
                      placeholder="seu-email@exemplo.com"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="saas-password" className="text-xs uppercase tracking-wider text-muted-foreground">Senha Secreta</Label>
                    <Input
                      id="saas-password"
                      type="password"
                      required
                      placeholder="••••••••"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                </div>

                {authMessage && (
                  <div className={`p-3 rounded-lg text-xs leading-relaxed border ${
                    authMessage.success
                      ? "bg-success/10 border-success/30 text-success"
                      : "bg-destructive/10 border-destructive/30 text-destructive"
                  }`}>
                    {authMessage.message}
                  </div>
                )}

                <Button type="submit" disabled={authLoading} className="w-full cursor-pointer">
                  {authLoading ? (
                    <>
                      <RefreshCw className="animate-spin" />
                      Autenticando...
                    </>
                  ) : authMode === "signup" ? (
                    <>
                      <Users />
                      Criar Conta SaaS
                    </>
                  ) : (
                    <>
                      <LogIn />
                      Entrar na Plataforma
                    </>
                  )}
                </Button>
              </form>
            )}

            <div className="text-xs text-muted-foreground bg-muted p-3 rounded-lg border leading-relaxed">
              ℹ️ <strong>Isolamento Multi-tenant:</strong> Ao logar com e-mails diferentes, o Supabase Auth atribui IDs únicos (UUIDs) para cada usuário. Suas análises e documentos são segregados automaticamente, permitindo simular perfeitamente um SaaS em produção!
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bottom Floating Interactive Chat popup */}
      <FloatingAiChat
        companyData={companyData}
        activeEdital={activeEdital}
      />
    </SidebarProvider>
  );
}
