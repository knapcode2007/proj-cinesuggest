import { GoogleGenAI } from "@google/genai";

let aiClient: GoogleGenAI | null = null;

// Fallback cascade of models supported in the environment
const GEMINI_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest"
];

// Prefer the last known healthy model to minimize latency during high-demand spikes
let preferredModelIndex = 0;
let lastModelSwitchTime = 0;
const MODEL_RESET_WINDOW = 5 * 60 * 1000; // 5 minutes

function getAI(): GoogleGenAI | null {
  const rawKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.VITE_GEMINI_API_KEY;
  if (!rawKey) return null;
  const key = rawKey.trim().replace(/^["']|["']$/g, "").trim();
  if (!key) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

export function hasGeminiKey(): boolean {
  return Boolean(getAI());
}

/**
 * Resilient content generator that handles 503 High Demand spikes and 429 rate limits
 * by cascading across alternative models and retrying with jitter.
 */
async function generateWithFallback(contents: string): Promise<string> {
  const ai = getAI();
  if (!ai) {
    throw new Error("No Gemini API key configured");
  }

  // If a temporary switch was made more than 5 minutes ago, reset to primary
  if (preferredModelIndex !== 0 && Date.now() - lastModelSwitchTime > MODEL_RESET_WINDOW) {
    preferredModelIndex = 0;
  }

  // Order models starting from the current preferred index
  const modelQueue = [
    ...GEMINI_MODELS.slice(preferredModelIndex),
    ...GEMINI_MODELS.slice(0, preferredModelIndex)
  ];

  let lastError: any = null;

  for (let i = 0; i < modelQueue.length; i++) {
    const model = modelQueue[i];
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
      });

      const text = (response.text || "").trim();
      if (text) {
        // If this model succeeded and wasn't the initial preferred, remember it
        const newPreferred = GEMINI_MODELS.indexOf(model);
        if (newPreferred !== preferredModelIndex) {
          preferredModelIndex = newPreferred;
          lastModelSwitchTime = Date.now();
        }
        return text;
      }
    } catch (err: any) {
      lastError = err;
      const isHighDemand =
        err?.message?.includes("503") ||
        err?.message?.includes("high demand") ||
        err?.status === 503 ||
        err?.error?.code === 503;
      const isRateLimited =
        err?.message?.includes("429") ||
        err?.message?.includes("quota") ||
        err?.status === 429 ||
        err?.error?.code === 429;

      if (isHighDemand || isRateLimited) {
        console.warn(`[Gemini] ${model} unavailable (${isHighDemand ? "503 High Demand" : "429 Rate Limit"}). Cascading to next fallback model.`);
        // Brief pause before trying next model to allow transient network jitter to settle
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // If it is another fatal error (e.g. invalid key format), don't loop endlessly
      console.warn(`[Gemini] ${model} failed: ${err.message || err}`);
    }
  }

  throw lastError || new Error("All Gemini models exhausted");
}

export interface StructuredMovieQuery {
  query: string;
  genres: string[];
  keywords: string[];
  mood: string;
  similarToTitles: string[];
  suggestedTitles: string[];
  summary: string;
}

const GENRE_SYNONYMS: Record<string, string[]> = {
  "Sci-Fi": ["sci-fi", "science fiction", "space", "interstellar", "alien", "futuristic", "cyberpunk", "time travel", "multiverse", "dystopian", "cosmos", "galaxy"],
  "Action": ["action", "explosive", "martial arts", "chase", "combat", "fight", "superhero", "spy", "secret agent", "mission", "heist"],
  "Thriller": ["thriller", "suspense", "tension", "psychological", "plot twist", "murder", "conspiracy", "intense", "gripping", "edge of your seat"],
  "Drama": ["drama", "emotional", "tearjerker", "crying", "moving", "deep", "character study", "heartwarming", "family", "tragedy"],
  "Horror": ["horror", "scary", "spooky", "creepy", "ghost", "monster", "demon", "slasher", "haunted", "supernatural", "fear"],
  "Comedy": ["comedy", "funny", "hilarious", "laugh", "humor", "parody", "satire", "lighthearted", "fun"],
  "Mystery": ["mystery", "detective", "whodunit", "clues", "investigation", "crime solving", "sherlock", "secret"],
  "Romance": ["romance", "romantic", "love story", "lovers", "relationship", "dating", "heartfelt", "romcom"],
  "Adventure": ["adventure", "journey", "quest", "exploration", "treasure", "expedition", "voyage"],
  "Animation": ["animation", "animated", "anime", "pixar", "cartoon", "ghibli", "disney"],
  "Crime": ["crime", "gangster", "mafia", "robbery", "cartel", "police", "detective"],
  "Fantasy": ["fantasy", "magic", "sorcery", "dragons", "mythology", "wizards", "medieval", "enchanted"]
};

function extractGenresFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const [genre, keywords] of Object.entries(GENRE_SYNONYMS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matched.push(genre);
    }
  }

  return matched.length > 0 ? matched : ["Drama", "Sci-Fi"];
}

function buildSmartLocalFallback(query: string): StructuredMovieQuery {
  const detectedGenres = extractGenresFromText(query);
  const words = query
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 3 && !["movie", "movies", "film", "films", "watch", "about", "with", "like", "recommend", "suggest"].includes(w.toLowerCase()));

  // Deduce curated suggestions based on detected keywords
  const lower = query.toLowerCase();
  const suggested: string[] = [];
  const similar: string[] = [];

  if (lower.includes("space") || lower.includes("time") || lower.includes("black hole")) {
    suggested.push("Interstellar", "Arrival", "Contact");
    similar.push("2001: A Space Odyssey");
  } else if (lower.includes("heist") || lower.includes("mind") || lower.includes("dream")) {
    suggested.push("Inception", "Shutter Island", "The Prestige");
    similar.push("Tenet");
  } else if (lower.includes("dark") || lower.includes("detective") || lower.includes("crime")) {
    suggested.push("Se7en", "Zodiac", "The Batman");
    similar.push("Blade Runner 2049");
  } else if (lower.includes("love") || lower.includes("romantic")) {
    suggested.push("La La Land", "Eternal Sunshine of the Spotless Mind", "Her");
    similar.push("Before Sunrise");
  } else if (lower.includes("scary") || lower.includes("horror")) {
    suggested.push("Hereditary", "A Quiet Place", "The Conjuring");
    similar.push("Get Out");
  } else {
    suggested.push("Interstellar", "Inception", "Dune: Part Two");
  }

  return {
    query,
    genres: detectedGenres,
    keywords: words.length > 0 ? words : ["cinematic", "gripping"],
    mood: detectedGenres.includes("Horror") ? "chilling" : detectedGenres.includes("Comedy") ? "lighthearted" : "atmospheric and engaging",
    similarToTitles: similar,
    suggestedTitles: suggested,
    summary: `Cinematic recommendations tailored for: "${query}"`
  };
}

export async function parseMovieQueryWithAI(query: string): Promise<StructuredMovieQuery> {
  const localFallback = buildSmartLocalFallback(query);

  if (!hasGeminiKey()) {
    return localFallback;
  }

  try {
    const prompt = `You are an expert film recommendation engine.
Analyze the following natural language user movie query:
"${query}"

Extract structured search preferences in valid JSON format only, with no markdown code fences or backticks.
Schema:
{
  "genres": ["Sci-Fi", "Mystery"],
  "keywords": ["space travel", "time dilation", "existential"],
  "mood": "mind-bending, contemplative",
  "similarToTitles": ["Interstellar", "Arrival"],
  "suggestedTitles": ["Blade Runner 2049", "2001: A Space Odyssey", "Contact"],
  "summary": "Looking for cosmic, thought-provoking sci-fi narratives with deep emotional arcs."
}`;

    const text = await generateWithFallback(prompt);

    // Clean any accidental markdown backticks or commentary
    let cleanJson = text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanJson = jsonMatch[0];
    } else {
      cleanJson = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    }

    const parsed = JSON.parse(cleanJson);

    return {
      query,
      genres: Array.isArray(parsed.genres) && parsed.genres.length > 0 ? parsed.genres : localFallback.genres,
      keywords: Array.isArray(parsed.keywords) && parsed.keywords.length > 0 ? parsed.keywords : localFallback.keywords,
      mood: parsed.mood || localFallback.mood,
      similarToTitles: Array.isArray(parsed.similarToTitles) && parsed.similarToTitles.length > 0 ? parsed.similarToTitles : localFallback.similarToTitles,
      suggestedTitles: Array.isArray(parsed.suggestedTitles) && parsed.suggestedTitles.length > 0 ? parsed.suggestedTitles : localFallback.suggestedTitles,
      summary: parsed.summary || localFallback.summary
    };
  } catch (err: any) {
    console.warn(`[Gemini] Using resilient query interpretation fallback: ${err.message}`);
    return localFallback;
  }
}

export async function generatePersonalizedReason(movieTitle: string, userGenres: string[], referenceMovie?: string): Promise<string> {
  const fallbackReason = referenceMovie
    ? `Because you liked ${userGenres.slice(0, 2).join(" and ")} and awarded high marks to ${referenceMovie}.`
    : `Recommended for your taste in ${userGenres.slice(0, 2).join(" & ")}.`;

  if (!hasGeminiKey()) {
    return fallbackReason;
  }

  try {
    const prompt = `Write a single, compelling 1-2 sentence cinematic recommendation reason explaining why a user who loves ${userGenres.join(", ")} ${referenceMovie ? `and highly rated "${referenceMovie}"` : ""} should watch "${movieTitle}". Keep it punchy, film-literate, and insightful.`;
    const text = await generateWithFallback(prompt);
    return text.replace(/^["']|["']$/g, "").trim() || fallbackReason;
  } catch {
    return fallbackReason;
  }
}
