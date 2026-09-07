import axios from "axios";
import { Movie, MOCK_MOVIES } from "./mockMovies.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w780";
const TMDB_BACKDROP_BASE = "https://image.tmdb.org/t/p/w1280";

const cache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached<T>(key: string): T | null {
  const item = cache.get(key);
  if (item && item.expiry > Date.now()) {
    return item.data as T;
  }
  return null;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
}

interface TmdbAuth {
  type: "v3" | "v4";
  key: string;
}

/**
 * Robust TMDB credential detector supporting:
 * - TMDB_API_KEY
 * - VITE_TMDB_API_KEY
 * - TMDB_READ_ACCESS_TOKEN
 * - TMDB_ACCESS_TOKEN
 * - TMDB_API_READ_ACCESS_TOKEN
 * - TMDB_TOKEN
 * Handles both v3 32-hex keys and v4 JWT Read Access Tokens seamlessly.
 */
function getTmdbAuth(): TmdbAuth | null {
  const rawKey =
    process.env.TMDB_API_KEY ||
    process.env.VITE_TMDB_API_KEY ||
    process.env.TMDB_READ_ACCESS_TOKEN ||
    process.env.TMDB_ACCESS_TOKEN ||
    process.env.TMDB_API_READ_ACCESS_TOKEN ||
    process.env.TMDB_TOKEN ||
    process.env.TMDB_KEY ||
    process.env.VITE_TMDB_READ_ACCESS_TOKEN;

  if (!rawKey) return null;
  const cleanKey = rawKey.trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim();
  if (!cleanKey) return null;

  // TMDB v4 tokens are JWT strings (~200 chars, begins with ey...)
  if (cleanKey.startsWith("ey") || cleanKey.length > 50) {
    return { type: "v4", key: cleanKey };
  }

  return { type: "v3", key: cleanKey };
}

async function tmdbGet(endpoint: string, params: Record<string, any> = {}): Promise<any> {
  const auth = getTmdbAuth();
  if (!auth) {
    throw new Error("No TMDB API key configured");
  }

  const queryParams: Record<string, any> = { ...params };
  const headers: Record<string, string> = {
    accept: "application/json",
  };

  if (auth.type === "v4") {
    headers["Authorization"] = `Bearer ${auth.key}`;
  } else {
    queryParams["api_key"] = auth.key;
  }

  const url = endpoint.startsWith("http") ? endpoint : `${TMDB_BASE_URL}${endpoint}`;
  const response = await axios.get(url, {
    params: queryParams,
    headers,
    timeout: 5000,
  });

  return response.data;
}

const GENRE_MAP: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Sci-Fi",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western"
};

function formatTmdbMovie(item: any): Movie {
  const genres = item.genres || (item.genre_ids ? item.genre_ids.map((id: number) => ({ id, name: GENRE_MAP[id] || "Cinema" })) : []);
  
  const poster = item.poster_path
    ? (item.poster_path.startsWith("http") ? item.poster_path : `${TMDB_IMAGE_BASE}${item.poster_path}`)
    : "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500";
    
  const backdrop = item.backdrop_path
    ? (item.backdrop_path.startsWith("http") ? item.backdrop_path : `${TMDB_BACKDROP_BASE}${item.backdrop_path}`)
    : poster;

  return {
    id: item.id,
    title: item.title || item.name || "Untitled",
    original_title: item.original_title,
    overview: item.overview || "No overview available.",
    poster_path: poster,
    backdrop_path: backdrop,
    release_date: item.release_date || item.first_air_date || "2024",
    vote_average: Number((item.vote_average || 7.0).toFixed(1)),
    vote_count: item.vote_count || 100,
    runtime: item.runtime || 120,
    genres,
    tagline: item.tagline || "",
    popularity: item.popularity || 80
  };
}

export const tmdbService = {
  hasApiKey(): boolean {
    return Boolean(getTmdbAuth());
  },

  async getTrending(): Promise<Movie[]> {
    const auth = getTmdbAuth();
    const cacheKey = "movies_trending";
    const cached = getCached<Movie[]>(cacheKey);
    if (cached) return cached;

    if (!auth) {
      return MOCK_MOVIES.slice(0, 10);
    }

    try {
      const data = await tmdbGet("/trending/movie/week");
      const results: Movie[] = (data.results || []).map(formatTmdbMovie);
      setCache(cacheKey, results);
      return results;
    } catch (err: any) {
      console.warn(`[TMDB] getTrending fallback triggered: ${err.message}`);
      return MOCK_MOVIES.slice(0, 10);
    }
  },

  async getPopular(): Promise<Movie[]> {
    const auth = getTmdbAuth();
    const cacheKey = "movies_popular";
    const cached = getCached<Movie[]>(cacheKey);
    if (cached) return cached;

    if (!auth) {
      return [...MOCK_MOVIES].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 10);
    }

    try {
      const data = await tmdbGet("/movie/popular");
      const results: Movie[] = (data.results || []).map(formatTmdbMovie);
      setCache(cacheKey, results);
      return results;
    } catch (err: any) {
      console.warn(`[TMDB] getPopular fallback triggered: ${err.message}`);
      return [...MOCK_MOVIES].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 10);
    }
  },

  async getTopRated(): Promise<Movie[]> {
    const auth = getTmdbAuth();
    const cacheKey = "movies_top_rated";
    const cached = getCached<Movie[]>(cacheKey);
    if (cached) return cached;

    if (!auth) {
      return [...MOCK_MOVIES].sort((a, b) => b.vote_average - a.vote_average).slice(0, 10);
    }

    try {
      const data = await tmdbGet("/movie/top_rated");
      const results: Movie[] = (data.results || []).map(formatTmdbMovie);
      setCache(cacheKey, results);
      return results;
    } catch (err: any) {
      console.warn(`[TMDB] getTopRated fallback triggered: ${err.message}`);
      return [...MOCK_MOVIES].sort((a, b) => b.vote_average - a.vote_average).slice(0, 10);
    }
  },

  async getUpcoming(): Promise<Movie[]> {
    const auth = getTmdbAuth();
    const cacheKey = "movies_upcoming";
    const cached = getCached<Movie[]>(cacheKey);
    if (cached) return cached;

    if (!auth) {
      return MOCK_MOVIES.filter(m => m.release_date.startsWith("2024") || m.release_date.startsWith("2023")).slice(0, 8);
    }

    try {
      const data = await tmdbGet("/movie/upcoming");
      const results: Movie[] = (data.results || []).map(formatTmdbMovie);
      setCache(cacheKey, results);
      return results;
    } catch (err: any) {
      console.warn(`[TMDB] getUpcoming fallback triggered: ${err.message}`);
      return MOCK_MOVIES.slice(0, 8);
    }
  },

  async searchMovies(query: string): Promise<Movie[]> {
    const cleanQuery = (query || "").trim().toLowerCase();
    if (!cleanQuery) return [];

    const auth = getTmdbAuth();
    if (!auth) {
      return MOCK_MOVIES.filter(m =>
        m.title.toLowerCase().includes(cleanQuery) ||
        m.overview.toLowerCase().includes(cleanQuery) ||
        (m.director && m.director.toLowerCase().includes(cleanQuery)) ||
        m.genres.some(g => g.name.toLowerCase().includes(cleanQuery)) ||
        (m.cast && m.cast.some(c => c.name.toLowerCase().includes(cleanQuery)))
      );
    }

    try {
      const data = await tmdbGet("/search/movie", { query: cleanQuery });
      return (data.results || []).map(formatTmdbMovie);
    } catch (err: any) {
      console.warn(`[TMDB] searchMovies fallback triggered: ${err.message}`);
      return MOCK_MOVIES.filter(m =>
        m.title.toLowerCase().includes(cleanQuery) ||
        m.overview.toLowerCase().includes(cleanQuery)
      );
    }
  },

  async getMoviesByGenre(genreName: string): Promise<Movie[]> {
    const cleanGenre = (genreName || "").trim().toLowerCase();
    const localMatches = MOCK_MOVIES.filter(m =>
      m.genres.some(g => g.name.toLowerCase() === cleanGenre || cleanGenre.includes(g.name.toLowerCase()))
    );

    const auth = getTmdbAuth();
    if (!auth) return localMatches.length > 0 ? localMatches : MOCK_MOVIES.slice(0, 8);

    const genreEntry = Object.entries(GENRE_MAP).find(([_, name]) => name.toLowerCase() === cleanGenre);
    if (!genreEntry) return localMatches;

    try {
      const data = await tmdbGet("/discover/movie", {
        with_genres: genreEntry[0],
        sort_by: "popularity.desc"
      });
      return (data.results || []).map(formatTmdbMovie);
    } catch {
      return localMatches;
    }
  },

  async getMovieDetails(movieId: number): Promise<Movie | null> {
    const mock = MOCK_MOVIES.find(m => m.id === Number(movieId));
    const auth = getTmdbAuth();

    if (!auth) {
      return mock || null;
    }

    const cacheKey = `movie_details_${movieId}`;
    const cached = getCached<Movie>(cacheKey);
    if (cached) return cached;

    try {
      const [data, creditsData, videosData] = await Promise.all([
        tmdbGet(`/movie/${movieId}`),
        tmdbGet(`/movie/${movieId}/credits`).catch(() => ({ crew: [], cast: [] })),
        tmdbGet(`/movie/${movieId}/videos`).catch(() => ({ results: [] }))
      ]);

      const formatted = formatTmdbMovie(data);
      formatted.runtime = data.runtime || (mock ? mock.runtime : 120);

      const directorObj = (creditsData.crew || []).find((c: any) => c.job === "Director");
      if (directorObj) formatted.director = directorObj.name;
      else if (mock?.director) formatted.director = mock.director;

      formatted.cast = (creditsData.cast || []).slice(0, 8).map((c: any) => ({
        id: c.id,
        name: c.name,
        character: c.character,
        profile_path: c.profile_path ? `${TMDB_IMAGE_BASE}${c.profile_path}` : undefined
      }));

      const trailer = (videosData.results || []).find((v: any) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"));
      if (trailer) formatted.trailer_key = trailer.key;
      else if (mock?.trailer_key) formatted.trailer_key = mock.trailer_key;

      setCache(cacheKey, formatted);
      return formatted;
    } catch (err: any) {
      console.warn(`[TMDB] getMovieDetails fallback for ${movieId}: ${err.message}`);
      return mock || null;
    }
  },

  async getSimilarMovies(movieId: number): Promise<Movie[]> {
    const auth = getTmdbAuth();
    if (!auth) {
      return MOCK_MOVIES.filter(m => m.id !== Number(movieId)).slice(0, 6);
    }

    try {
      const data = await tmdbGet(`/movie/${movieId}/similar`);
      const results = (data.results || []).map(formatTmdbMovie);
      return results.length > 0 ? results : MOCK_MOVIES.filter(m => m.id !== Number(movieId)).slice(0, 6);
    } catch {
      return MOCK_MOVIES.filter(m => m.id !== Number(movieId)).slice(0, 6);
    }
  },

  async getMovieCredits(movieId: number): Promise<{ director?: string; cast: any[] }> {
    const mock = MOCK_MOVIES.find(m => m.id === Number(movieId));
    const auth = getTmdbAuth();

    if (!auth) {
      return {
        director: mock?.director,
        cast: mock?.cast || []
      };
    }

    try {
      const data = await tmdbGet(`/movie/${movieId}/credits`);
      const directorObj = (data.crew || []).find((c: any) => c.job === "Director");
      return {
        director: directorObj ? directorObj.name : mock?.director,
        cast: (data.cast || []).slice(0, 10).map((c: any) => ({
          id: c.id,
          name: c.name,
          character: c.character,
          profile_path: c.profile_path ? `${TMDB_IMAGE_BASE}${c.profile_path}` : undefined
        }))
      };
    } catch {
      return {
        director: mock?.director,
        cast: mock?.cast || []
      };
    }
  }
};
