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

// Set to track tables that do not yet exist in the Supabase schema to avoid repeated 404 network warnings
const missingTablesCache = new Set<string>();

export function isTableMissing(tableName: string): boolean {
  return missingTablesCache.has(tableName);
}

export function markTableMissing(tableName: string): void {
  missingTablesCache.add(tableName);
}

export function isTableMissingError(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || error.details || error.hint || String(error)).toLowerCase();
  const code = String(error.code || "");
  return (
    msg.includes("schema cache") ||
    msg.includes("could not find the table") ||
    msg.includes("relation") && msg.includes("does not exist") ||
    msg.includes("not found") ||
    code === "PGRST205" ||
    code === "42P01" ||
    code === "PGRST116" ||
    code === "404"
  );
}

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
export async function syncDocumentToSupabase(
  fileOrName: any, 
  maybeType?: string, 
  maybeContent?: string
): Promise<{ success: boolean; message: string; id?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };

  try {
    const user = await getActiveUser();
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    let docId = generateUUID();
    let name = "Documento";
    let type = "geral";
    let path = "";
    let content = "";
    let url = "";
    let timestamp = new Date().toISOString();

    if (typeof fileOrName === "object" && fileOrName !== null) {
      docId = ensureValidUuid(fileOrName.id);
      name = fileOrName.name || fileOrName.title || "Documento";
      type = fileOrName.type || "geral";
      path = fileOrName.path || "";
      content = fileOrName.content || fileOrName.conteudo || "";
      url = fileOrName.url || "";
      timestamp = fileOrName.timestamp || new Date().toISOString();
    } else {
      name = String(fileOrName || "Documento");
      type = maybeType || "geral";
      content = maybeContent || "";
    }

    const record = {
      id: docId,
      user_id: userId,
      name,
      title: name,
      type,
      path,
      content,
      conteudo_markdown: content,
      timestamp,
      url,
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("documentos_sincronizados")
      .upsert([record], { onConflict: "id" });

    if (error) {
      console.warn("Table 'documentos_sincronizados' error:", error);
      return { success: false, message: `Erro ao enviar: ${error.message}.` };
    }

    return { success: true, message: "Documento sincronizado com o Supabase!", id: docId };
  } catch (err: any) {
    return { success: false, message: err.message || "Falha técnica ao sincronizar documento." };
  }
}

// Fetch live database metrics to prove the real-time SaaS connection is active
export async function fetchSupabaseTableCounts(): Promise<{ editais: number; documentos: number; certidoes: number; concorrentes: number; chatSessions: number; disputas: number }> {
  const client = getSupabaseClient();
  if (!client) return { editais: 0, documentos: 0, certidoes: 0, concorrentes: 0, chatSessions: 0, disputas: 0 };

  try {
    const user = await getActiveUser();
    if (!user) return { editais: 0, documentos: 0, certidoes: 0, concorrentes: 0, chatSessions: 0, disputas: 0 };

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

    const { count: disputasCount } = await client
      .from("planilhas_disputas")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    return {
      editais: editaisCount || 0,
      documentos: docsCount || 0,
      certidoes: certCount || 0,
      concorrentes: competitorCount || 0,
      chatSessions: chatCount || 0,
      disputas: disputasCount || 0
    };
  } catch (e) {
    console.warn("Could not fetch table counts (tables may not exist yet):", e);
    return { editais: 0, documentos: 0, certidoes: 0, concorrentes: 0, chatSessions: 0, disputas: 0 };
  }
}

export function getGuestUserId(): string {
  let guestId = localStorage.getItem("aip_guest_user_id");
  if (!guestId) {
    guestId = "00000000-0000-0000-0000-000000000001";
    localStorage.setItem("aip_guest_user_id", guestId);
  }
  return guestId;
}

// Helper to check for active user
export async function getActiveUser(): Promise<any | null> {
  const client = getSupabaseClient();
  if (!client) return { id: getGuestUserId() };
  try {
    const { data } = await client.auth.getUser();
    if (data?.user) return data.user;
    return { id: getGuestUserId() };
  } catch {
    return { id: getGuestUserId() };
  }
}

// --- Dynamic CRUD helpers mapped to Supabase ---

// Real-time table change subscription helper for live cross-device SaaS synchronization
export function subscribeToSupabaseTable(
  tableName: string, 
  onDataChange: (payload: any) => void,
  onStatusChange?: (status: "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR") => void
): () => void {
  const client = getSupabaseClient();
  if (!client) return () => {};

  try {
    const channelId = `realtime_${tableName}_${Math.random().toString(36).substring(2, 8)}`;
    const channel = client
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: tableName },
        (payload) => {
          try {
            onDataChange(payload);
          } catch (e) {
            console.warn(`[Supabase Realtime] Error handling event for ${tableName}:`, e);
          }
        }
      )
      .subscribe((status) => {
        if (onStatusChange) {
          onStatusChange(status as any);
        }
      });

    return () => {
      try {
        client.removeChannel(channel);
      } catch (err) {
        // ignore cleanup error
      }
    };
  } catch (err) {
    console.warn(`[Supabase Realtime] Could not subscribe to ${tableName}:`, err);
    return () => {};
  }
}

// 1. Editais Analisados (editais_analisados)
export async function fetchEditaisFromSupabase(): Promise<any[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("editais_analisados")
      .select("*")
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
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    await client
      .from("editais_analisados")
      .delete()
      .eq("id", id)
      .or(`user_id.eq.${userId},user_id.eq.${guestId},user_id.is.null`);

    const { error } = await client
      .from("editais_analisados")
      .delete()
      .eq("id", id);

    if (error) {
      await client.from("analises_editais").delete().eq("id", id);
      await client.from("editais").delete().eq("id", id);
    }
    return true;
  } catch (err: any) {
    console.warn("deleteEditalFromSupabase exception:", err?.message || err);
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
      fileBase64: item.file_base64,
      fileMimeType: item.file_mime_type,
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
      file_base64: item.fileBase64 || null,
      file_mime_type: item.fileMimeType || null,
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
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    await client
      .from("certidoes_fiscais")
      .delete()
      .eq("id", id)
      .or(`user_id.eq.${userId},user_id.eq.${guestId},user_id.is.null`);

    const { error } = await client
      .from("certidoes_fiscais")
      .delete()
      .eq("id", id);

    if (error) {
      await client.from("empresa_documentos").delete().eq("id", id);
    }
    return true;
  } catch (err: any) {
    console.warn("deleteCertificateFromSupabase exception:", err?.message || err);
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
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    await client
      .from("historico_concorrentes")
      .delete()
      .eq("id", id)
      .or(`user_id.eq.${userId},user_id.eq.${guestId},user_id.is.null`);

    const { error } = await client
      .from("historico_concorrentes")
      .delete()
      .eq("id", id);

    if (error) {
      await client.from("concorrentes").delete().eq("id", id);
    }
    return true;
  } catch (err: any) {
    console.warn("deleteCompetitorFromSupabase exception:", err?.message || err);
    return false;
  }
}

// 4. Sessões de Chat (sessoes_chat)
const MAX_CHAT_SESSIONS_IN_DB = 20;

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
    const allSessions = data || [];

    // Auto-purge excess sessions to prevent runaway accumulation (e.g. from past infinite loops)
    if (allSessions.length > MAX_CHAT_SESSIONS_IN_DB) {
      console.warn(`[Chat] Found ${allSessions.length} sessions in DB (limit: ${MAX_CHAT_SESSIONS_IN_DB}). Purging excess...`);
      const toDelete = allSessions.slice(MAX_CHAT_SESSIONS_IN_DB);
      for (const s of toDelete) {
        void Promise.resolve(
          client.from("sessoes_chat").delete().eq("id", s.id).eq("user_id", user.id)
        ).catch(() => {});
      }
    }

    const limited = allSessions.slice(0, MAX_CHAT_SESSIONS_IN_DB);
    return limited.map(item => ({
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
    
    // Sanitize heavy base64 attachment data to avoid bloating Supabase JSON payload
    const sanitizedMessages = (item.messages || []).map((msg: any) => {
      if (!msg) return msg;
      if (msg.attachment && msg.attachment.data && typeof msg.attachment.data === "string" && msg.attachment.data.length > 1000) {
        return {
          ...msg,
          attachment: {
            ...msg.attachment,
            data: `[Anexo Base64 Otimizado: ${msg.attachment.name || "arquivo"} - Processado pela IA]`
          }
        };
      }
      return msg;
    });

    const record = {
      id: item.id,
      user_id: user.id,
      title: item.title,
      selected_edital_id: item.selectedEditalId,
      messages: sanitizedMessages,
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
    
    // 1. Delete by user_id AND id if user logged in
    if (user) {
      try {
        await client.from("sessoes_chat").delete().eq("id", id).eq("user_id", user.id);
      } catch {
        // ignore
      }
    }

    // 2. Unconditional delete by id to ensure orphan or legacy guest rows are purged
    const { error } = await client.from("sessoes_chat").delete().eq("id", id);
    if (error) {
      console.warn("deleteChatSessionFromSupabase error:", error.message || error);
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
    if (user) {
      const { error } = await client.from("sessoes_chat").delete().eq("user_id", user.id);
      if (error) {
        console.warn("clearAllChatSessionsInSupabase user delete error:", error.message || error);
      }
    }

    // Also purge all remaining rows in sessoes_chat
    const { error: err2 } = await client.from("sessoes_chat").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (err2) {
      console.warn("clearAllChatSessionsInSupabase general delete warning:", err2.message || err2);
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
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    let query = client.from("documentos_sincronizados").select("*");
    if (user?.id && user.id !== guestId) {
      query = query.or(`user_id.eq.${userId},user_id.eq.${guestId},user_id.is.null`);
    }

    const { data, error } = await query.order("updated_at", { ascending: false });
    if (error) return [];
    return (data || []).map(item => ({
      id: item.id,
      name: item.name || item.title || item.nome_documento || "",
      title: item.title || item.name || item.nome_documento || "",
      type: item.type || item.tipo || "",
      path: item.path || "",
      timestamp: item.timestamp || item.created_at || new Date().toISOString(),
      created_at: item.created_at || item.timestamp,
      url: item.url || "",
      content: item.content || item.conteudo || item.conteudo_markdown || ""
    }));
  } catch {
    return [];
  }
}

export const fetchDocumentosFromSupabase = fetchDocumentsFromSupabase;

export async function saveDocumentToSupabase(item: any): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };
  try {
    const user = await getActiveUser();
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;
    
    const record = {
      id: ensureValidUuid(item.id),
      user_id: userId,
      name: item.name || item.title || "Documento",
      title: item.title || item.name || "Documento",
      type: item.type || "geral",
      path: item.path || "",
      content: item.content || item.conteudo || "",
      timestamp: item.timestamp || new Date().toISOString(),
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
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    await client
      .from("documentos_sincronizados")
      .delete()
      .eq("id", id)
      .or(`user_id.eq.${userId},user_id.eq.${guestId},user_id.is.null`);

    const { error } = await client
      .from("documentos_sincronizados")
      .delete()
      .eq("id", id);

    if (error) {
      console.warn("deleteDocumentFromSupabase error:", error.message || error);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn("deleteDocumentFromSupabase exception:", err?.message || err);
    return false;
  }
}

export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function ensureValidUuid(idStr: string | undefined): string {
  if (!idStr) return generateUUID();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(idStr)) return idStr;
  return generateUUID();
}

// 6. Planilhas de Disputas (planilhas_disputas)
export async function fetchDisputasFromSupabase(): Promise<any[]> {
  const client = getSupabaseClient();
  if (!client || isTableMissing("planilhas_disputas")) return [];
  try {
    const user = await getActiveUser();
    const guestId = getGuestUserId();

    // Always fetch ALL rows (RLS with permissive policy handles access control)
    // This avoids the issue where rows created on different devices with different
    // user_id values are filtered out, causing sync inconsistencies
    const { data, error } = await client
      .from("planilhas_disputas")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      if (isTableMissingError(error)) {
        markTableMissing("planilhas_disputas");
        return [];
      }
      console.warn("fetchDisputasFromSupabase error:", error.message);
      return [];
    }

    // Filter client-side: show rows belonging to this user or guest, or rows without user_id
    const userId = user?.id || guestId;
    const allRows = (data || []).map(mapDisputaFromDb);

    // If user is authenticated with real account, filter to their rows + guest rows
    // If only guest, show all guest rows
    if (user?.id && user.id !== guestId) {
      const userRows = allRows.filter((r: any) => {
        const rawRow = data?.find((d: any) => d.id === r.id);
        const rowUserId = rawRow?.user_id || "";
        return rowUserId === user.id || rowUserId === guestId || !rowUserId;
      });
      // If no user-specific rows, return all (in case migration is needed)
      return userRows.length > 0 ? userRows : allRows;
    }

    // Guest user: return rows with guestId or null user_id
    return allRows.filter((r: any) => {
      const rawRow = data?.find((d: any) => d.id === r.id);
      const rowUserId = rawRow?.user_id || "";
      return rowUserId === guestId || rowUserId === userId || !rowUserId;
    });

  } catch (err: any) {
    if (isTableMissingError(err)) {
      markTableMissing("planilhas_disputas");
    }
    return [];
  }
}

export function mapDisputaFromDb(item: any) {
  return {
    id: item.id,
    orgao: item.orgao || item.orgao_comprador || "",
    uasgUndCompradora: item.uasg_und_compradora || item.uasg || "",
    numeroLicitacao: item.numero_licitacao || item.numero || "",
    portal: item.portal || "Compras.gov.br",
    produtoItem: item.produto_item || item.produto || item.objeto || "",
    quantidade: Number(item.quantidade) || 1,
    unidadeMedida: item.unidade_medida || item.unidade || "Unidade",
    valorEstimadoItem: Number(item.valor_estimado_item || item.valor_estimado) || 0,
    nossoValorAlvo: Number(item.nosso_valor_alvo || item.valor_alvo) || 0,
    valorMinimoPiso: Number(item.valor_minimo_piso || item.valor_piso) || 0,
    dataHoraDisputa: item.data_hora_disputa || item.data_disputa || "",
    status: item.status || "Agendada",
    observacoes: item.observacoes || "",
    linkPNCP: item.link_pncp || item.linkPNCP || ""
  };
}

export async function saveDisputaToSupabase(item: any): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };
  if (isTableMissing("planilhas_disputas")) {
    return { success: false, message: "Tabela planilhas_disputas não existe no Supabase (utilizando armazenamento local seguro)." };
  }

  try {
    const user = await getActiveUser();
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;
    
    // Ensure ID is a valid UUID for PostgreSQL
    const recordId = ensureValidUuid(item.id);
    if (item.id !== recordId) {
      item.id = recordId;
    }

    const parseNum = (val: any) => {
      const n = Number(val);
      return isNaN(n) ? 0 : n;
    };

    const record: Record<string, any> = {
      id: recordId,
      user_id: userId,
      orgao: String(item.orgao || "").trim(),
      uasg_und_compradora: String(item.uasgUndCompradora || "").trim(),
      numero_licitacao: String(item.numeroLicitacao || "").trim(),
      portal: String(item.portal || "Compras.gov.br").trim(),
      produto_item: String(item.produtoItem || "").trim(),
      quantidade: parseNum(item.quantidade) || 1,
      unidade_medida: String(item.unidadeMedida || "Unidade").trim(),
      valor_estimado_item: parseNum(item.valorEstimadoItem),
      nosso_valor_alvo: parseNum(item.nossoValorAlvo),
      valor_minimo_piso: parseNum(item.valorMinimoPiso),
      data_hora_disputa: String(item.dataHoraDisputa || "").trim(),
      status: String(item.status || "Agendada").trim(),
      observacoes: String(item.observacoes || "").trim(),
      link_pncp: String(item.linkPNCP || "").trim(),
      updated_at: new Date().toISOString()
    };

    // Attempt 1: Full upsert
    let { error } = await client
      .from("planilhas_disputas")
      .upsert([record], { onConflict: "id" });

    // Check if table missing
    if (error && isTableMissingError(error)) {
      markTableMissing("planilhas_disputas");
      return { success: false, message: "Tabela planilhas_disputas não criada no banco." };
    }

    // Attempt 2: Retry without link_pncp if column missing in DB schema
    if (error && (error.message.includes("link_pncp") || error.message.includes("column"))) {
      delete record.link_pncp;
      const res = await client.from("planilhas_disputas").upsert([record], { onConflict: "id" });
      error = res.error;
    }

    // Attempt 3: Retry without user_id if foreign key or auth policy fails
    if (error && (
      error.message.includes("user_id") || 
      error.message.includes("foreign key") || 
      error.message.includes("fkey") || 
      error.message.includes("violates") ||
      error.code === "23503"
    )) {
      delete record.user_id;
      const res = await client.from("planilhas_disputas").upsert([record], { onConflict: "id" });
      error = res.error;
    }

    // Attempt 4: Insert / update fallback
    if (error && (error.message.includes("onConflict") || error.code === "42703")) {
      const insertRes = await client.from("planilhas_disputas").insert([record]);
      if (insertRes.error) {
        const updateRes = await client.from("planilhas_disputas").update(record).eq("id", recordId);
        error = updateRes.error;
      } else {
        error = null;
      }
    }

    if (error) {
      if (isTableMissingError(error)) {
        markTableMissing("planilhas_disputas");
      }
      return { success: false, message: error.message };
    }
    return { success: true, message: "Disputa salva com sucesso no Supabase!" };
  } catch (err: any) {
    if (isTableMissingError(err)) {
      markTableMissing("planilhas_disputas");
    }
    return { success: false, message: err?.message || "Erro de conexão" };
  }
}

export async function deleteDisputaFromSupabase(id: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || isTableMissing("planilhas_disputas")) return false;
  try {
    const user = await getActiveUser();
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    const { error } = await client
      .from("planilhas_disputas")
      .delete()
      .eq("id", id)
      .or(`user_id.eq.${userId},user_id.eq.${guestId}`);

    if (error) {
      if (isTableMissingError(error)) {
        markTableMissing("planilhas_disputas");
        return false;
      }
      // Fallback: delete by id alone
      await client.from("planilhas_disputas").delete().eq("id", id);
    }
    return true;
  } catch {
    return false;
  }
}

// 7. Simulações de Preços (simulacoes_precos)
export async function fetchSimulacoesFromSupabase(): Promise<any[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  try {
    const user = await getActiveUser();
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    let query = client.from("simulacoes_precos").select("*");
    if (user?.id && user.id !== guestId) {
      query = query.or(`user_id.eq.${userId},user_id.eq.${guestId},user_id.is.null`);
    }

    const { data, error } = await query.order("updated_at", { ascending: false });
    if (error) return [];
    return (data || []).map(item => ({
      id: item.id,
      title: item.title || item.titulo || "Simulação",
      date: item.date || item.data || new Date().toISOString(),
      editalTitle: item.edital_title || item.editalTitle || "",
      itemDesc: item.item_desc || item.itemDesc || "",
      quantity: Number(item.quantity) || 1,
      custoProdutoUnitario: Number(item.custo_produto_unitario) || 0,
      freteUnitario: Number(item.frete_unitario) || 0,
      impostosPercent: Number(item.impostos_percent) || 0,
      margemLucroPercent: Number(item.margem_lucro_percent) || 0,
      custoOperacionalPercent: Number(item.custo_operacional_percent) || 0,
      precoMinimoUnitario: Number(item.preco_minimo_unitario) || 0,
      precoIdealUnitario: Number(item.preco_ideal_unitario) || 0,
      precoEstimadoEditalUnitario: Number(item.preco_estimado_edital_unitario) || 0,
      faturamentoTotalIdeal: Number(item.faturamento_total_ideal) || 0,
      lucroLiquidoTotal: Number(item.lucro_liquido_total) || 0,
      custosTotais: Number(item.custos_totais) || 0,
      impostosTotais: Number(item.impostos_totais) || 0,
      outrasDespesasTotais: Number(item.outras_despesas_totais) || 0
    }));
  } catch {
    return [];
  }
}

export async function saveSimulacaoToSupabase(sim: any): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };
  try {
    const user = await getActiveUser();
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    const record = {
      id: ensureValidUuid(sim.id),
      user_id: userId,
      title: sim.title || "Simulação",
      date: sim.date || new Date().toISOString(),
      edital_title: sim.editalTitle || "",
      item_desc: sim.itemDesc || "",
      quantity: sim.quantity || 1,
      custo_produto_unitario: sim.custoProdutoUnitario || 0,
      frete_unitario: sim.freteUnitario || 0,
      impostos_percent: sim.impostosPercent || 0,
      margem_lucro_percent: sim.margemLucroPercent || 0,
      custo_operacional_percent: sim.custoOperacionalPercent || 0,
      preco_minimo_unitario: sim.precoMinimoUnitario || 0,
      preco_ideal_unitario: sim.precoIdealUnitario || 0,
      preco_estimado_edital_unitario: sim.precoEstimadoEditalUnitario || 0,
      faturamento_total_ideal: sim.faturamentoTotalIdeal || 0,
      lucro_liquido_total: sim.lucroLiquidoTotal || 0,
      custos_totais: sim.custosTotais || 0,
      impostos_totais: sim.impostosTotais || 0,
      outras_despesas_totais: sim.outrasDespesasTotais || 0,
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("simulacoes_precos")
      .upsert([record], { onConflict: "id" });

    if (error) throw error;
    return { success: true, message: "Simulação salva com sucesso no Supabase!" };
  } catch (err: any) {
    console.warn("saveSimulacaoToSupabase error:", err?.message || err);
    return { success: false, message: err.message };
  }
}

export async function deleteSimulacaoFromSupabase(id: string): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  try {
    const user = await getActiveUser();
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    await client
      .from("simulacoes_precos")
      .delete()
      .eq("id", id)
      .or(`user_id.eq.${userId},user_id.eq.${guestId},user_id.is.null`);

    await client.from("simulacoes_precos").delete().eq("id", id);
    return true;
  } catch {
    return false;
  }
}

// 8. Comparador de Produtos (comparador_produtos)
export async function fetchComparadorProdutosFromSupabase(): Promise<any[]> {
  const client = getSupabaseClient();
  if (!client) return [];
  try {
    const user = await getActiveUser();
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    let query = client.from("comparador_produtos").select("*");
    if (user?.id && user.id !== guestId) {
      query = query.or(`user_id.eq.${userId},user_id.eq.${guestId},user_id.is.null`);
    }

    const { data, error } = await query.order("updated_at", { ascending: false });
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

export async function saveComparadorProdutoToSupabase(item: any): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };
  try {
    const user = await getActiveUser();
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    const record = {
      id: generateUUID(),
      user_id: userId,
      edital_id: item.edital_id || "",
      especificacoes_exigidas: item.especificacoes_exigidas || "",
      candidatos: item.candidatos || [],
      dados_comparacao: item.dados_comparacao || {},
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("comparador_produtos")
      .upsert([record]);

    if (error) throw error;
    return { success: true, message: "Comparação salva no Supabase!" };
  } catch (err: any) {
    console.warn("saveComparadorProdutoToSupabase error:", err?.message || err);
    return { success: false, message: err.message };
  }
}

// 9. Configurações do LanceBot (lancebot_config)
export async function fetchLanceBotConfigFromSupabase(): Promise<any | null> {
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const user = await getActiveUser();
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    const { data, error } = await client
      .from("lancebot_config")
      .select("*")
      .or(`user_id.eq.${userId},user_id.eq.${guestId}`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

export async function saveLanceBotConfigToSupabase(config: any): Promise<{ success: boolean; message: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, message: "Supabase não configurado." };
  try {
    const user = await getActiveUser();
    const guestId = getGuestUserId();
    const userId = user?.id || guestId;

    const record = {
      user_id: userId,
      ...config,
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from("lancebot_config")
      .upsert([record], { onConflict: "user_id" });

    if (error) throw error;
    return { success: true, message: "Configuração do LanceBot salva no Supabase!" };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

// Full PostgreSQL SQL Migration script to create all required tables in Supabase with 1-click
export function getSupabaseFullSchemaSQL(): string {
  return `-- ==============================================================================
-- HORASIS - ESTRUTURA COMPLETA DO BANCO DE DADOS SUPABASE (PostgreSQL)
-- Cole e execute este script no "SQL Editor" do seu painel Supabase
-- ==============================================================================

-- 1. Habilitar extensões necessárias
create extension if not exists "uuid-ossp";

-- 2. Tabela de Planilhas de Disputas
create table if not exists public.planilhas_disputas (
  id uuid primary key default uuid_generate_v4(),
  user_id text not null,
  orgao text not null default '',
  uasg_und_compradora text default '',
  numero_licitacao text default '',
  portal text default 'Compras.gov.br',
  produto_item text not null default '',
  quantidade numeric default 1,
  unidade_medida text default 'Unidade',
  valor_estimado_item numeric default 0,
  nosso_valor_alvo numeric default 0,
  valor_minimo_piso numeric default 0,
  data_hora_disputa text default '',
  status text default 'Agendada',
  observacoes text default '',
  link_pncp text default '',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Tabela de Editais Analisados
create table if not exists public.editais_analisados (
  id text primary key,
  user_id text not null,
  title text not null default '',
  date text not null default '',
  analysis jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Tabela de Documentos Sincronizados (Propostas, Declarações)
create table if not exists public.documentos_sincronizados (
  id text primary key,
  user_id text not null,
  name text not null default '',
  type text default '',
  content text default '',
  metadata jsonb default '{}'::jsonb,
  created_at text default '',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Tabela de Certidões Fiscais
create table if not exists public.certidoes_fiscais (
  id text primary key,
  user_id text not null,
  name text not null default '',
  type text default '',
  status text default 'Regular',
  expiration_date text default '',
  file_url text default '',
  metadata jsonb default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Tabela de Concorrentes Auditados
create table if not exists public.historico_concorrentes (
  id text primary key,
  user_id text not null,
  name text not null default '',
  cnpj text default '',
  win_rate numeric default 0,
  total_bids numeric default 0,
  notes text default '',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 7. Tabela de Sessões de Chat com IA
create table if not exists public.sessoes_chat (
  id text primary key,
  user_id text not null,
  title text not null default 'Chat Principal',
  selected_edital_id text default '',
  messages jsonb default '[]'::jsonb,
  created_at text default '',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 8. Tabela de Configurações de IA do Usuário (Chaves de API)
create table if not exists public.configuracoes_usuario (
  user_id text primary key,
  active_provider text not null default 'gemini',
  gemini_key text default '',
  gemini_model text default 'gemini-3.7-flash',
  openai_key text default '',
  openai_model text default 'gpt-4o',
  anthropic_key text default '',
  anthropic_model text default 'claude-sonnet-5',
  deepseek_key text default '',
  deepseek_model text default 'deepseek-chat',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 9. Tabela de Dados da Empresa Licitante
create table if not exists public.dados_empresa (
  user_id text primary key,
  razon_social text default '',
  cnpj text default '',
  address text default '',
  phone text default '',
  email text default '',
  representative_name text default '',
  representative_cpf text default '',
  bank_details text default '',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 10. Tabela de Simulações de Preços
create table if not exists public.simulacoes_precos (
  id uuid primary key default uuid_generate_v4(),
  user_id text not null,
  title text not null default 'Simulação',
  date text not null default '',
  edital_title text default '',
  item_desc text default '',
  quantity numeric default 1,
  custo_produto_unitario numeric default 0,
  frete_unitario numeric default 0,
  impostos_percent numeric default 0,
  margem_lucro_percent numeric default 0,
  custo_operacional_percent numeric default 0,
  preco_minimo_unitario numeric default 0,
  preco_ideal_unitario numeric default 0,
  preco_estimado_edital_unitario numeric default 0,
  faturamento_total_ideal numeric default 0,
  lucro_liquido_total numeric default 0,
  custos_totais numeric default 0,
  impostos_totais numeric default 0,
  outras_despesas_totais numeric default 0,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 11. Tabela de Comparador de Produtos
create table if not exists public.comparador_produtos (
  id uuid primary key default uuid_generate_v4(),
  user_id text not null,
  edital_id text default '',
  especificacoes_exigidas text default '',
  candidatos jsonb default '[]'::jsonb,
  dados_comparacao jsonb default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 12. Tabela de Configurações do LanceBot
create table if not exists public.lancebot_config (
  user_id text primary key,
  pregao_id text default '',
  item_num text default '',
  valor_inicial numeric default 0,
  valor_limite_minimo numeric default 0,
  tipo_decremento text default 'percent',
  valor_decremento numeric default 0.5,
  intervalo_ms numeric default 15000,
  estrategia text default 'conservadora',
  modo_real boolean default false,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 13. Habilitar RLS e Políticas Permissivas para Aplicação e Usuários
alter table public.planilhas_disputas enable row level security;
alter table public.editais_analisados enable row level security;
alter table public.documentos_sincronizados enable row level security;
alter table public.certidoes_fiscais enable row level security;
alter table public.historico_concorrentes enable row level security;
alter table public.sessoes_chat enable row level security;
alter table public.configuracoes_usuario enable row level security;
alter table public.dados_empresa enable row level security;
alter table public.simulacoes_precos enable row level security;
alter table public.comparador_produtos enable row level security;
alter table public.lancebot_config enable row level security;

-- Políticas de Acesso
-- ⚠️ Cada linha pertence a um usuário e só pode ser lida/escrita por ele.
-- Políticas permissivas (using (true)) deixariam qualquer portador da chave
-- publicável ler a tabela inteira — incluindo as chaves de API em
-- configuracoes_usuario. O cast para text mantém a comparação válida tanto
-- para colunas user_id uuid quanto text.

drop policy if exists "Permitir tudo planilhas_disputas" on public.planilhas_disputas;
drop policy if exists "Acesso proprio planilhas_disputas" on public.planilhas_disputas;
create policy "Acesso proprio planilhas_disputas" on public.planilhas_disputas
  for all using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

drop policy if exists "Permitir tudo editais_analisados" on public.editais_analisados;
drop policy if exists "Acesso proprio editais_analisados" on public.editais_analisados;
create policy "Acesso proprio editais_analisados" on public.editais_analisados
  for all using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

drop policy if exists "Permitir tudo documentos_sincronizados" on public.documentos_sincronizados;
drop policy if exists "Acesso proprio documentos_sincronizados" on public.documentos_sincronizados;
create policy "Acesso proprio documentos_sincronizados" on public.documentos_sincronizados
  for all using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

drop policy if exists "Permitir tudo certidoes_fiscais" on public.certidoes_fiscais;
drop policy if exists "Acesso proprio certidoes_fiscais" on public.certidoes_fiscais;
create policy "Acesso proprio certidoes_fiscais" on public.certidoes_fiscais
  for all using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

drop policy if exists "Permitir tudo historico_concorrentes" on public.historico_concorrentes;
drop policy if exists "Acesso proprio historico_concorrentes" on public.historico_concorrentes;
create policy "Acesso proprio historico_concorrentes" on public.historico_concorrentes
  for all using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

drop policy if exists "Permitir tudo sessoes_chat" on public.sessoes_chat;
drop policy if exists "Acesso proprio sessoes_chat" on public.sessoes_chat;
create policy "Acesso proprio sessoes_chat" on public.sessoes_chat
  for all using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

drop policy if exists "Permitir tudo configuracoes_usuario" on public.configuracoes_usuario;
drop policy if exists "Acesso proprio configuracoes_usuario" on public.configuracoes_usuario;
create policy "Acesso proprio configuracoes_usuario" on public.configuracoes_usuario
  for all using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

drop policy if exists "Permitir tudo dados_empresa" on public.dados_empresa;
drop policy if exists "Acesso proprio dados_empresa" on public.dados_empresa;
create policy "Acesso proprio dados_empresa" on public.dados_empresa
  for all using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

drop policy if exists "Permitir tudo simulacoes_precos" on public.simulacoes_precos;
drop policy if exists "Acesso proprio simulacoes_precos" on public.simulacoes_precos;
create policy "Acesso proprio simulacoes_precos" on public.simulacoes_precos
  for all using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

drop policy if exists "Permitir tudo comparador_produtos" on public.comparador_produtos;
drop policy if exists "Acesso proprio comparador_produtos" on public.comparador_produtos;
create policy "Acesso proprio comparador_produtos" on public.comparador_produtos
  for all using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

drop policy if exists "Permitir tudo lancebot_config" on public.lancebot_config;
drop policy if exists "Acesso proprio lancebot_config" on public.lancebot_config;
create policy "Acesso proprio lancebot_config" on public.lancebot_config
  for all using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);
`;
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
  model = "gemini-3.7-flash", 
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
      gemini_model: config.geminiModel || "gemini-3.6-flash",
      openai_key: config.openaiKey || "",
      openai_model: config.openaiModel || "gpt-4o",
      anthropic_key: config.anthropicKey || "",
      anthropic_model: config.anthropicModel || "claude-sonnet-5",
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

