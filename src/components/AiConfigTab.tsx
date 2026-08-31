import { useState, useEffect } from "react";
import { Cpu, Key, CheckCircle, RefreshCw, AlertTriangle, Sparkles, ExternalLink, ShieldCheck, Zap, Loader2, XCircle } from "lucide-react";
import confetti from "canvas-confetti";
import { saveUserConfigToSupabase } from "../utils/supabaseClient";
import { apiFetch, readJsonResponse } from "../utils/aiClientHelper";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";

const selectClassName =
  "w-full bg-transparent dark:bg-input/30 border border-input rounded-md h-9 px-3 text-xs text-foreground focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring font-medium";

export default function AiConfigTab() {
  const [activeProvider, setActiveProvider] = useState<string>("gemini");

  // Credentials
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-3.6-flash");

  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o");

  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("claude-sonnet-5");

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
      setGeminiModel(localStorage.getItem("ai_gemini_model") || "gemini-3.6-flash");

      setOpenaiKey(localStorage.getItem("ai_openai_key") || "");
      setOpenaiModel(localStorage.getItem("ai_openai_model") || "gpt-4o");

      setAnthropicKey(localStorage.getItem("ai_anthropic_key") || "");
      setAnthropicModel(localStorage.getItem("ai_anthropic_model") || "claude-sonnet-5");

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

      const data = await readJsonResponse(response);

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
    <div id="ai-config-tab" className="space-y-6 animate-fade-in select-text font-sans">

      {/* Header Info Banner */}
      <Card className="py-6">
        <CardContent className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary p-3 rounded-xl border border-primary/20 shrink-0">
              <Cpu className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                Configurações Avançadas de IA & Modelos
                <Badge variant="secondary" className="text-[10px]">
                  Multi-Provedor
                </Badge>
              </h3>
              <p className="text-muted-foreground text-xs mt-1 leading-normal max-w-2xl">
                Escolha e configure o provedor de Inteligência Artificial ativo para toda a plataforma. Insira sua própria chave de API para habilitar os recursos de IA (Gemini, OpenAI, Anthropic ou DeepSeek).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Main Config Form (Left/Center) */}
        <form
          onSubmit={handleSave}
          className="lg:col-span-2 bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm"
        >

          {/* Provider Selector */}
          <CardContent className="space-y-3">
            <Label className="text-[11px] font-bold text-foreground uppercase tracking-wider block">
              Provedor de Inteligência Artificial Ativo
            </Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { id: "gemini", name: "Google Gemini", desc: "Altamente veloz" },
                { id: "openai", name: "OpenAI ChatGPT", desc: "Líder de mercado" },
                { id: "anthropic", name: "Anthropic Claude", desc: "Raciocínio lógico" },
                { id: "deepseek", name: "DeepSeek V3/R1", desc: "Excelente custo/benefício" }
              ].map((p) => {
                const isActive = activeProvider === p.id;
                return (
                  <Button
                    key={p.id}
                    type="button"
                    variant={isActive ? "default" : "outline"}
                    onClick={() => handleProviderChange(p.id)}
                    className="h-auto flex-col items-start gap-1 p-3.5 text-left whitespace-normal select-none"
                  >
                    <span className="font-bold text-xs block">{p.name}</span>
                    <span
                      className={cn(
                        "text-[9px] block font-normal",
                        isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                      )}
                    >
                      {p.desc}
                    </span>
                  </Button>
                );
              })}
            </div>
          </CardContent>

          <Separator />

          {/* Provider Configuration Forms */}
          <CardContent className="space-y-4">

            {/* Gemini Config */}
            {activeProvider === "gemini" && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center gap-2 text-primary">
                  <Sparkles className="w-4 h-4" />
                  <span className="font-bold text-xs uppercase tracking-wide">Configurações do Google Gemini</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Chave de API do Gemini</Label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                        <Key className="w-4 h-4" />
                      </div>
                      <Input
                        type="password"
                        placeholder="AIzaSy..."
                        value={geminiKey}
                        onChange={(e) => setGeminiKey(e.target.value)}
                        className="pl-9 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Modelo Ativo</Label>
                    <select
                      value={geminiModel}
                      onChange={(e) => setGeminiModel(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="gemini-3.7-flash">gemini-3.7-flash (Geração Flash Mais Recente)</option>
                      <option value="gemini-3.6-flash">gemini-3.6-flash (Estável e Disponível - Recomendado)</option>
                      <option value="gemini-3.5-flash">gemini-3.5-flash (Estável)</option>
                      <option value="gemini-flash-latest">gemini-flash-latest (Última Versão Flash Estável)</option>
                      <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Leve, Rápido e Econômico)</option>
                      <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Leve)</option>
                      <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (Raciocínio Avançado)</option>
                    </select>
                  </div>
                </div>

                <Card className="bg-muted/40 py-4">
                  <CardContent className="flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-foreground">
                    <div className="space-y-1 text-left">
                      <p className="font-bold text-foreground">Sincronizar com a Nuvem (Supabase Edge)</p>
                      <p className="text-[10px] text-muted-foreground max-w-md leading-normal">
                        Se você utiliza o roteamento de IA em nuvem por Edge Functions, sincronize essa chave para que a nuvem do Supabase passe a utilizá-la em chamadas automáticas.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={syncingSecrets}
                      onClick={handleSyncSupabaseSecrets}
                      size="sm"
                      className="text-[10px] whitespace-nowrap"
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
                    </Button>
                  </CardContent>
                </Card>

                {syncSuccess !== null && (
                  <div
                    className={cn(
                      "p-3 rounded-lg text-[10px] leading-relaxed border",
                      syncSuccess
                        ? "bg-success/10 border-success/30 text-success"
                        : "bg-destructive/10 border-destructive/30 text-destructive"
                    )}
                  >
                    {syncMessage}
                  </div>
                )}
              </div>
            )}

            {/* OpenAI Config */}
            {activeProvider === "openai" && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center gap-2 text-primary">
                  <Sparkles className="w-4 h-4" />
                  <span className="font-bold text-xs uppercase tracking-wide">Configurações da OpenAI (ChatGPT)</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Chave de API (OpenAI Key)</Label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                        <Key className="w-4 h-4" />
                      </div>
                      <Input
                        type="password"
                        placeholder="sk-proj-..."
                        value={openaiKey}
                        onChange={(e) => setOpenaiKey(e.target.value)}
                        className="pl-9 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Modelo Ativo</Label>
                    <select
                      value={openaiModel}
                      onChange={(e) => setOpenaiModel(e.target.value)}
                      className={selectClassName}
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
                <div className="flex items-center gap-2 text-primary">
                  <Sparkles className="w-4 h-4" />
                  <span className="font-bold text-xs uppercase tracking-wide">Configurações da Anthropic (Claude)</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Chave de API (Claude Key)</Label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                        <Key className="w-4 h-4" />
                      </div>
                      <Input
                        type="password"
                        placeholder="sk-ant-..."
                        value={anthropicKey}
                        onChange={(e) => setAnthropicKey(e.target.value)}
                        className="pl-9 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Modelo Ativo</Label>
                    <select
                      value={anthropicModel}
                      onChange={(e) => setAnthropicModel(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="claude-sonnet-5">claude-sonnet-5 (Equilíbrio entre custo e capacidade - Recomendado)</option>
                      <option value="claude-opus-5">claude-opus-5 (Máxima capacidade de raciocínio)</option>
                      <option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001 (Rápido e econômico)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* DeepSeek Config */}
            {activeProvider === "deepseek" && (
              <div className="space-y-4 animate-fade-in">
                <div className="flex items-center gap-2 text-primary">
                  <Sparkles className="w-4 h-4" />
                  <span className="font-bold text-xs uppercase tracking-wide">Configurações do DeepSeek</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Chave de API (DeepSeek Key)</Label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                        <Key className="w-4 h-4" />
                      </div>
                      <Input
                        type="password"
                        placeholder="sk-..."
                        value={deepseekKey}
                        onChange={(e) => setDeepseekKey(e.target.value)}
                        className="pl-9 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] font-bold text-foreground uppercase tracking-wider block">Modelo Ativo</Label>
                    <select
                      value={deepseekModel}
                      onChange={(e) => setDeepseekModel(e.target.value)}
                      className={selectClassName}
                    >
                      <option value="deepseek-chat">deepseek-chat (DeepSeek V3)</option>
                      <option value="deepseek-reasoner">deepseek-reasoner (DeepSeek R1 com raciocínio profundo)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

          </CardContent>

          <Separator />

          {/* Form Actions */}
          <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {saveSuccess ? (
                <div className="text-success font-semibold text-xs flex items-center gap-1.5 animate-bounce">
                  <CheckCircle className="w-4 h-4" />
                  Configurações salvas e ativas!
                </div>
              ) : (
                <p className="text-[10px] text-muted-foreground max-w-sm leading-normal">
                  *As chaves são armazenadas localmente no seu navegador e usadas apenas nas requisições diretas de IA.
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Button
                type="submit"
                disabled={saving}
                size="lg"
                className="flex-1 sm:flex-none text-xs select-none"
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
              </Button>

              <Button
                type="button"
                onClick={handleTestAi}
                disabled={testing}
                size="lg"
                variant="outline"
                className="flex-1 sm:flex-none text-xs border-success/40 bg-success/10 text-success hover:bg-success/20 hover:text-success select-none"
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
              </Button>
            </div>
          </CardContent>

          {/* Test Result Banner */}
          {testResult && (
            <CardContent>
              <div
                className={cn(
                  "p-3 rounded-xl text-xs font-medium flex items-start gap-2 border",
                  testResult.ok
                    ? "bg-success/10 border-success/30 text-success"
                    : "bg-destructive/10 border-destructive/30 text-destructive"
                )}
              >
                {testResult.ok
                  ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5 text-success" />
                  : <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />
                }
                <span>{testResult.message}</span>
              </div>
            </CardContent>
          )}

        </form>

        {/* Sidebar Info/QuickLinks (Right side) */}
        <div className="space-y-6">

          {/* Status Panel */}
          <Card className="py-5">
            <CardContent className="space-y-4">
              <h4 className="font-bold text-foreground text-xs uppercase tracking-wide">Status da Conexão</h4>

              <div className="space-y-3">
                {[
                  { name: "Google Gemini", key: geminiKey, active: activeProvider === "gemini" },
                  { name: "OpenAI ChatGPT", key: openaiKey, active: activeProvider === "openai" },
                  { name: "Anthropic Claude", key: anthropicKey, active: activeProvider === "anthropic" },
                  { name: "DeepSeek", key: deepseekKey, active: activeProvider === "deepseek" }
                ].map((prov) => {
                  const hasKey = prov.key && prov.key.length > 5;
                  return (
                    <div key={prov.name} className="flex items-center justify-between text-xs border-b border-border pb-2 last:border-0 last:pb-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("w-1.5 h-1.5 rounded-full", prov.active ? "bg-primary" : "bg-muted-foreground/30")} />
                        <span className="font-semibold text-foreground">{prov.name}</span>
                        {prov.active && (
                          <Badge className="text-[8px] px-1.5 py-0 h-auto leading-4">
                            ATIVO
                          </Badge>
                        )}
                      </div>
                      {hasKey ? (
                        <span className="text-success font-bold text-[10px] flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Configurada
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-[10px]">Não informada</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Quick instructions / Help */}
          <Card className="py-5">
            <CardContent className="space-y-3.5">
              <h4 className="font-bold text-foreground text-xs uppercase tracking-wide flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-warning" />
                Como obter as chaves?
              </h4>
              <div className="space-y-2.5 text-xs text-muted-foreground leading-relaxed">
                <p>
                  <strong>Google Gemini Key:</strong> Obtenha gratuitamente no portal do <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">Google AI Studio <ExternalLink className="w-2.5 h-2.5" /></a>.
                </p>
                <p>
                  <strong>OpenAI API Key:</strong> Acesse seu painel de desenvolvedor no site da <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">OpenAI <ExternalLink className="w-2.5 h-2.5" /></a>.
                </p>
                <p>
                  <strong>Claude Key:</strong> Gerencie suas chaves no Console do desenvolvedor da <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">Anthropic <ExternalLink className="w-2.5 h-2.5" /></a>.
                </p>
                <p>
                  <strong>DeepSeek Key:</strong> Acesse o portal da <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">DeepSeek API <ExternalLink className="w-2.5 h-2.5" /></a>.
                </p>
              </div>
            </CardContent>
          </Card>

        </div>

      </div>

    </div>
  );
}
