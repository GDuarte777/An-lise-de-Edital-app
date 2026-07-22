import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Helper to get Supabase credentials from Env or LocalStorage for maximum ease of use
export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export function getSupabaseConfig(): SupabaseConfig {
  const DEFAULT_URL = "https://cghlfhndoqohmrrvppjj.supabase.co";
  const DEFAULT_KEY = "sb_publishable_FWDd-D9L6tGwasm1-qyT1Q_c7T9m_6o";

  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "";
  const envKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "";
  
  const savedUrl = localStorage.getItem("supabase_url") || "";
  const savedKey = localStorage.getItem("supabase_anon_key") || "";

  return {
    url: envUrl || savedUrl || DEFAULT_URL,
    anonKey: envKey || savedKey || DEFAULT_KEY
  };
}

export function saveSupabaseConfig(url: string, anonKey: string) {
  localStorage.setItem("supabase_url", url);
  localStorage.setItem("supabase_anon_key", anonKey);
}

export function clearSupabaseConfig() {
  localStorage.removeItem("supabase_url");
  localStorage.removeItem("supabase_anon_key");
}

let cachedClient: SupabaseClient | null = null;
let lastUrl = "";
let lastKey = "";

export function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config.url || !config.anonKey) {
    return null;
  }

  // If credentials changed, recreate client
  if (cachedClient && (lastUrl !== config.url || lastKey !== config.anonKey)) {
    cachedClient = null;
  }

  if (!cachedClient) {
    try {
      cachedClient = createClient(config.url, config.anonKey);
      lastUrl = config.url;
      lastKey = config.anonKey;
    } catch (e) {
      console.error("Error creating Supabase client:", e);
      return null;
    }
  }

  return cachedClient;
}

// Function to test connectivity
export async function testSupabaseConnection(url: string, anonKey: string): Promise<{ success: boolean; message: string }> {
  try {
    if (!url || !anonKey) {
      return { success: false, message: "URL e Chave Anon (anon key) são obrigatórios." };
    }
    const tempClient = createClient(url, anonKey);
    
    // Attempt a lightweight query or check if client initializes properly
    // To check if we can query any table or just get api info:
    const { data, error } = await tempClient.from("_dummy_check").select("*").limit(1).maybeSingle();
    
    // Note: Since _dummy_check probably doesn't exist, an error code 'PGRST116' (no rows) or similar is OK,
    // but connection/auth errors will be different. If the error is 'PGRST116' or undefined, it means we reached the DB.
    // If we get an error about invalid credentials, failed to fetch, etc. it failed.
    if (error && error.message.includes("Failed to fetch")) {
      return { success: false, message: "Não foi possível conectar ao servidor Supabase. Verifique a URL." };
    }
    
    if (error && (error.code === "PGRST301" || error.message.includes("JWT") || error.message.includes("API key"))) {
      return { success: false, message: "Chave de API inválida ou expirada." };
    }

    return { 
      success: true, 
      message: "Conexão com o Supabase estabelecida com sucesso! O banco está pronto para sincronizar dados." 
    };
  } catch (error: any) {
    return { success: false, message: error.message || "Erro desconhecido ao testar conexão." };
  }
}

// Automatically sync an active edital analysis to Supabase
export async function syncEditalToSupabase(analysisData: any): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, message: "Supabase não está configurado." };
  }

  try {
    const user = await getActiveUser();
    if (!user) {
      return { success: false, message: "Usuário não autenticado." };
    }

    const record = {
      id: analysisData.id || Date.now().toString(),
      user_id: user.id,
      title: analysisData.descricaoProduto 
        ? `Análise - ${analysisData.descricaoProduto.slice(0, 45)}${analysisData.descricaoProduto.length > 45 ? "..." : ""}` 
        : `Análise Pregão S/N`,
      date: new Date().toLocaleString("pt-BR"),
      analysis: analysisData,
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("editais_analisados")
      .upsert([record], { onConflict: "id" });

    if (error) {
      console.warn("Table 'editais_analisados' write error", error);
      return { 
        success: false, 
        message: `Erro da tabela Supabase: ${error.message}.` 
      };
    }

    return { success: true, message: "Análise de Edital sincronizada com sucesso no Supabase!" };
  } catch (err: any) {
    return { success: false, message: err.message || "Falha técnica ao sincronizar." };
  }
}

// Sync documents like proposals/declarations
export async function syncDocumentToSupabase(file: any): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };

  try {
    const user = await getActiveUser();
    if (!user) return { success: false, message: "Usuário não autenticado." };

    const record = {
      id: file.id,
      user_id: user.id,
      name: file.name,
      type: file.type,
      path: file.path,
      timestamp: file.timestamp,
      url: file.url || "",
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("documentos_sincronizados")
      .upsert([record], { onConflict: "id" });

    if (error) {
      console.warn("Table 'documentos_sincronizados' error:", error);
      return { success: false, message: `Erro ao enviar: ${error.message}.` };
    }

    return { success: true, message: "Documento sincronizado com o Supabase!" };
  } catch (err: any) {
    return { success: false, message: err.message || "Falha técnica ao sincronizar documento." };
  }
}

// Fetch live database metrics to prove the real-time SaaS connection is active
export async function fetchSupabaseTableCounts(): Promise<{ editais: number; documentos: number; certidoes: number; concorrentes: number; chatSessions: number }> {
  const client = getSupabaseClient();
  if (!client) return { editais: 0, documentos: 0, certidoes: 0, concorrentes: 0, chatSessions: 0 };

  try {
    const user = await getActiveUser();
    if (!user) return { editais: 0, documentos: 0, certidoes: 0, concorrentes: 0, chatSessions: 0 };

    const { count: editaisCount } = await client
      .from("editais_analisados")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    const { count: docsCount } = await client
      .from("documentos_sincronizados")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    const { count: certCount } = await client
      .from("certidoes_fiscais")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    const { count: competitorCount } = await client
      .from("historico_concorrentes")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    const { count: chatCount } = await client
      .from("sessoes_chat")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    return {
      editais: editaisCount || 0,
      documentos: docsCount || 0,
      certidoes: certCount || 0,
      concorrentes: competitorCount || 0,
      chatSessions: chatCount || 0
    };
  } catch (e) {
    console.warn("Could not fetch table counts (tables may not exist yet):", e);
    return { editais: 0, documentos: 0, certidoes: 0, concorrentes: 0, chatSessions: 0 };
  }
}

// Helper to check for active user
export async function getActiveUser(): Promise<any | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const { data } = await client.auth.getUser();
    return data?.user || null;
  } catch {
    return null;
  }
}

// --- Dynamic CRUD helpers mapped to Supabase ---

// 1. Editais Analisados (editais_analisados)
export async function fetchEditaisFromSupabase(): Promise<any[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  try {
    const user = await getActiveUser();
    if (!user) return [];
    const { data, error } = await client
      .from("editais_analisados")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) {
      console.warn("fetchEditaisFromSupabase error:", error.message);
      return [];
    }
    return data || [];
  } catch (err: any) {
    if (err?.message?.includes("fetch") || err?.message?.includes("Failed to fetch")) {
      console.warn("fetchEditaisFromSupabase network warning:", err?.message || err);
    } else {
      console.warn("fetchEditaisFromSupabase error:", err?.message || err);
    }
    return [];
  }
}

export async function saveEditalToSupabase(item: { id: string; title: string; date: string; analysis: any }): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };
  try {
    const user = await getActiveUser();
    if (!user) return { success: false, message: "Usuário não autenticado." };
    
    const record = {
      id: item.id,
      user_id: user.id,
      title: item.title,
      date: item.date,
      analysis: item.analysis,
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("editais_analisados")
      .upsert([record], { onConflict: "id" });

    if (error) throw error;
    return { success: true, message: "Edital salvo com sucesso no Supabase!" };
  } catch (err: any) {
    if (err?.message?.includes("fetch") || err?.message?.includes("Failed to fetch")) {
      console.warn("saveEditalToSupabase network warning:", err?.message || err);
    } else {
      console.warn("saveEditalToSupabase error:", err?.message || err);
    }
    return { success: false, message: err.message || "Erro ao salvar no Supabase." };
  }
}

export async function deleteEditalFromSupabase(id: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  try {
    const user = await getActiveUser();
    if (!user) return false;
    const { error } = await client
      .from("editais_analisados")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    return !error;
  } catch {
    return false;
  }
}

// 2. Certidões Fiscais (certidoes_fiscais)
export async function fetchCertificatesFromSupabase(): Promise<any[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  try {
    const user = await getActiveUser();
    if (!user) return [];
    const { data, error } = await client
      .from("certidoes_fiscais")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) {
      console.warn("fetchCertificatesFromSupabase error:", error.message);
      return [];
    }
    return (data || []).map(item => ({
      id: item.id,
      name: item.name,
      emissionDate: item.emission_date,
      expirationDate: item.expiration_date,
      status: item.status,
      notes: item.notes,
      fileUploaded: item.file_uploaded,
      fileName: item.file_name,
      documentMatchesRow: item.document_matches_row,
      validationFeedback: item.validation_feedback
    }));
  } catch {
    return [];
  }
}

export async function saveCertificateToSupabase(item: any): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };
  try {
    const user = await getActiveUser();
    if (!user) return { success: false, message: "Usuário não autenticado." };
    
    const record = {
      id: item.id,
      user_id: user.id,
      name: item.name,
      emission_date: item.emissionDate || null,
      expiration_date: item.expirationDate || null,
      status: item.status,
      notes: item.notes || "",
      file_uploaded: !!item.fileUploaded,
      file_name: item.fileName || "",
      document_matches_row: item.documentMatchesRow === false ? false : true,
      validation_feedback: item.validationFeedback || "",
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("certidoes_fiscais")
      .upsert([record], { onConflict: "id" });

    if (error) throw error;
    return { success: true, message: "Certidão salva com sucesso no Supabase!" };
  } catch (err: any) {
    console.warn("saveCertificateToSupabase error:", err?.message || err);
    return { success: false, message: err.message };
  }
}

export async function deleteCertificateFromSupabase(id: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  try {
    const user = await getActiveUser();
    if (!user) return false;
    const { error } = await client
      .from("certidoes_fiscais")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    return !error;
  } catch {
    return false;
  }
}

// 3. Histórico de Concorrentes (historico_concorrentes)
export async function fetchCompetitorsFromSupabase(): Promise<any[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  try {
    const user = await getActiveUser();
    if (!user) return [];
    const { data, error } = await client
      .from("historico_concorrentes")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) return [];
    return (data || []).map(item => ({
      id: item.id,
      competitorName: item.competitor_name,
      focusItems: item.focus_items,
      date: item.date,
      editalTitle: item.edital_title,
      analysis: item.analysis
    }));
  } catch {
    return [];
  }
}

export async function saveCompetitorToSupabase(item: any): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };
  try {
    const user = await getActiveUser();
    if (!user) return { success: false, message: "Usuário não autenticado." };
    
    const record = {
      id: item.id,
      user_id: user.id,
      competitor_name: item.competitorName || "",
      focus_items: item.focusItems || "",
      date: item.date || "",
      edital_title: item.editalTitle || "",
      analysis: item.analysis,
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("historico_concorrentes")
      .upsert([record], { onConflict: "id" });

    if (error) throw error;
    return { success: true, message: "Concorrente salvo com sucesso no Supabase!" };
  } catch (err: any) {
    console.warn("saveCompetitorToSupabase error:", err?.message || err);
    return { success: false, message: err.message };
  }
}

export async function deleteCompetitorFromSupabase(id: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  try {
    const user = await getActiveUser();
    if (!user) return false;
    const { error } = await client
      .from("historico_concorrentes")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    return !error;
  } catch {
    return false;
  }
}

// 4. Sessões de Chat (sessoes_chat)
export async function fetchChatSessionsFromSupabase(): Promise<any[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const user = await getActiveUser();
    if (!user) return null;
    const { data, error } = await client
      .from("sessoes_chat")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) {
      console.warn("fetchChatSessionsFromSupabase error:", error.message);
      return null;
    }
    return (data || []).map(item => ({
      id: item.id,
      title: item.title,
      selectedEditalId: item.selected_edital_id,
      messages: item.messages,
      createdAt: item.created_at
    }));
  } catch (err: any) {
    console.warn("fetchChatSessionsFromSupabase exception:", err?.message || err);
    return null;
  }
}

export async function saveChatSessionToSupabase(item: any): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };
  try {
    const user = await getActiveUser();
    if (!user) return { success: false, message: "Usuário não autenticado." };
    
    const record = {
      id: item.id,
      user_id: user.id,
      title: item.title,
      selected_edital_id: item.selectedEditalId,
      messages: item.messages,
      created_at: item.createdAt,
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("sessoes_chat")
      .upsert([record], { onConflict: "id" });

    if (error) throw error;
    return { success: true, message: "Sessão de chat salva com sucesso no Supabase!" };
  } catch (err: any) {
    console.warn("saveChatSessionToSupabase error:", err?.message || err);
    return { success: false, message: err.message };
  }
}

export async function deleteChatSessionFromSupabase(id: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  try {
    const user = await getActiveUser();
    let query = client.from("sessoes_chat").delete().eq("id", id);
    if (user) {
      query = query.eq("user_id", user.id);
    }
    const { error } = await query;
    if (error) {
      console.warn("deleteChatSessionFromSupabase error:", error.message || error);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn("deleteChatSessionFromSupabase exception:", err?.message || err);
    return false;
  }
}

export async function clearAllChatSessionsInSupabase(): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  try {
    const user = await getActiveUser();
    let query = client.from("sessoes_chat").delete();
    if (user) {
      query = query.eq("user_id", user.id);
    } else {
      query = query.neq("id", "");
    }
    const { error } = await query;
    if (error) {
      console.warn("clearAllChatSessionsInSupabase error:", error.message || error);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn("clearAllChatSessionsInSupabase exception:", err?.message || err);
    return false;
  }
}

// 5. Documentos Sincronizados (documentos_sincronizados)
export async function fetchDocumentsFromSupabase(): Promise<any[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  try {
    const user = await getActiveUser();
    if (!user) return [];
    const { data, error } = await client
      .from("documentos_sincronizados")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error) return [];
    return (data || []).map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      path: item.path,
      timestamp: item.timestamp,
      url: item.url
    }));
  } catch {
    return [];
  }
}

export async function saveDocumentToSupabase(item: any): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };
  try {
    const user = await getActiveUser();
    if (!user) return { success: false, message: "Usuário não autenticado." };
    
    const record = {
      id: item.id,
      user_id: user.id,
      name: item.name,
      type: item.type,
      path: item.path,
      timestamp: item.timestamp,
      url: item.url || "",
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("documentos_sincronizados")
      .upsert([record], { onConflict: "id" });

    if (error) throw error;
    return { success: true, message: "Documento salvo com sucesso no Supabase!" };
  } catch (err: any) {
    console.warn("saveDocumentToSupabase error:", err?.message || err);
    return { success: false, message: err.message };
  }
}

export async function deleteDocumentFromSupabase(id: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  try {
    const user = await getActiveUser();
    if (!user) return false;
    const { error } = await client
      .from("documentos_sincronizados")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    return !error;
  } catch {
    return false;
  }
}

// SaaS User Sign Up using Supabase Auth
export async function signUpWithSupabase(
  email: string, 
  password: string, 
  fullName?: string, 
  phone?: string
): Promise<{ success: boolean; message: string; user?: any }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, message: "Supabase não está configurado. Insira as credenciais primeiro." };
  }

  try {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || "",
          phone: phone || ""
        }
      }
    });

    if (error) throw error;

    // Seed the company profile with name and phone if possible and we have a session
    if (data.user && data.session) {
      try {
        await client.from("dados_empresa").upsert({
          user_id: data.user.id,
          representative_name: fullName || "",
          phone: phone || "",
          email: email,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" });
      } catch (e) {
        console.warn("Could not pre-seed dados_empresa:", e);
      }
    }

    // Check if email confirmation is required or if it signed up directly
    if (data.user && data.session === null) {
      return { 
        success: true, 
        message: "Registro feito com sucesso! Por favor, verifique sua caixa de e-mail para confirmar a conta no Supabase.",
        user: data.user
      };
    }

    return { 
      success: true, 
      message: "Conta de SaaS registrada e conectada com sucesso!", 
      user: data.user 
    };
  } catch (error: any) {
    return { success: false, message: error.message || "Erro desconhecido ao cadastrar." };
  }
}

// SaaS User Sign In using Supabase Auth
export async function signInWithSupabase(email: string, password: string): Promise<{ success: boolean; message: string; session?: any }> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, message: "Supabase não está configurado. Insira as credenciais primeiro." };
  }

  try {
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    return { 
      success: true, 
      message: "SaaS Login efetuado com sucesso!", 
      session: data.session 
    };
  } catch (error: any) {
    return { success: false, message: error.message || "E-mail ou senha incorretos." };
  }
}

// SaaS User Sign Out
export async function signOutWithSupabase(): Promise<void> {
  const client = getSupabaseClient();
  if (client) {
    await client.auth.signOut().catch(() => {});
  }
}

// Call Supabase Edge Function for Gemini AI Content
export async function callSupabaseGeminiEdgeFunction(
  prompt: string, 
  systemInstruction?: string, 
  model = "gemini-3.5-flash", 
  jsonMode = false
): Promise<string> {
  const config = getSupabaseConfig();
  if (!config.url || !config.anonKey) {
    throw new Error("Supabase não configurado. Ative a conexão com o Supabase antes de rotear via Edge Function.");
  }

  const endpoint = `${config.url.replace(/\/$/, "")}/functions/v1/gemini-ai`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.anonKey}`,
      "apikey": config.anonKey
    },
    body: JSON.stringify({
      prompt,
      systemInstruction,
      model,
      jsonMode
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Falha na Edge Function do Supabase (${response.status}): ${errText}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }

  return data.text || "";
}

// Fetch user AI configurations (API Keys & Active Models)
export async function fetchUserConfigFromSupabase(): Promise<any | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const user = await getActiveUser();
    if (!user) return null;
    const { data, error } = await client
      .from("configuracoes_usuario")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      console.warn("Error fetching user config:", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("fetchUserConfigFromSupabase error:", err);
    return null;
  }
}

// Save user AI configurations
export async function saveUserConfigToSupabase(config: {
  activeProvider: string;
  geminiKey?: string;
  geminiModel?: string;
  openaiKey?: string;
  openaiModel?: string;
  anthropicKey?: string;
  anthropicModel?: string;
  deepseekKey?: string;
  deepseekModel?: string;
}): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };
  try {
    const user = await getActiveUser();
    if (!user) return { success: false, message: "Usuário não autenticado." };

    const record = {
      user_id: user.id,
      active_provider: config.activeProvider,
      gemini_key: config.geminiKey || "",
      gemini_model: config.geminiModel || "gemini-3.5-flash",
      openai_key: config.openaiKey || "",
      openai_model: config.openaiModel || "gpt-4o",
      anthropic_key: config.anthropicKey || "",
      anthropic_model: config.anthropicModel || "claude-3-7-sonnet-20250219",
      deepseek_key: config.deepseekKey || "",
      deepseek_model: config.deepseekModel || "deepseek-chat",
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("configuracoes_usuario")
      .upsert([record], { onConflict: "user_id" });

    if (error) throw error;
    return { success: true, message: "Configurações de chaves salvas com sucesso no Supabase!" };
  } catch (err: any) {
    if (err?.message?.includes("fetch") || err?.message?.includes("Failed to fetch")) {
      console.warn("saveUserConfigToSupabase network warning:", err?.message || err);
    } else {
      console.warn("saveUserConfigToSupabase error:", err?.message || err);
    }
    return { success: false, message: err.message || "Erro ao salvar chaves." };
  }
}

// Fetch user company profile
export async function fetchCompanyDataFromSupabase(): Promise<any | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const user = await getActiveUser();
    if (!user) return null;
    const { data, error } = await client
      .from("dados_empresa")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      console.warn("Error fetching company data:", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("fetchCompanyDataFromSupabase error:", err);
    return null;
  }
}

// Save user company profile
export async function saveCompanyDataToSupabase(companyData: any): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };
  try {
    const user = await getActiveUser();
    if (!user) return { success: false, message: "Usuário não autenticado." };

    const record = {
      user_id: user.id,
      razon_social: companyData.razonSocial || "",
      cnpj: companyData.cnpj || "",
      address: companyData.address || "",
      phone: companyData.phone || "",
      email: companyData.email || "",
      representative_name: companyData.representativeName || "",
      representative_cpf: companyData.representativeCpf || "",
      bank_details: companyData.bankDetails || "",
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("dados_empresa")
      .upsert([record], { onConflict: "user_id" });

    if (error) throw error;
    return { success: true, message: "Dados da empresa salvos com sucesso no Supabase!" };
  } catch (err: any) {
    if (err?.message?.includes("fetch") || err?.message?.includes("Failed to fetch")) {
      console.warn("saveCompanyDataToSupabase network warning:", err?.message || err);
    } else {
      console.warn("saveCompanyDataToSupabase error:", err?.message || err);
    }
    return { success: false, message: err.message || "Erro ao salvar dados de empresa." };
  }
}

