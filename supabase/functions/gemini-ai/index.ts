// Supabase Edge Function for Gemini AI Analysis
// Place this inside supabase/functions/gemini-ai/index.ts
// Deploy using: supabase functions deploy gemini-ai

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { prompt, systemInstruction, model = "gemini-1.5-flash", jsonMode = false } = await req.json();

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Missing required 'prompt' parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY environment variable is not configured in Supabase Secrets" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Supabase Edge AI] Analyzing via ${model} | JSON Mode: ${jsonMode}`);

    // Build the request body for standard Gemini Developer API
    const contents = [{ parts: [{ text: prompt }] }];
    const config: any = {};
    
    if (systemInstruction) {
      config.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    
    if (jsonMode) {
      config.responseMimeType = "application/json";
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents,
        generationConfig: config,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Supabase Edge AI] Gemini API returned error:", errorText);
      return new Response(
        JSON.stringify({ error: "Error from Google Gemini API", details: errorText }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return new Response(
      JSON.stringify({ 
        text: candidateText,
        model: model,
        status: "success",
        processed_by: "Supabase Edge Function"
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[Supabase Edge AI] Exception in handler:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal Server Error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
