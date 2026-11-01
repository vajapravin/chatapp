import json
import logging
import urllib.request
import asyncio
from typing import Any

from ..config import settings

logger = logging.getLogger("chatapp.api.llm")

SYSTEM_INSTRUCTION = """You are an expert music curator for a synchronized private radio station.
Turn the user's request into precise YouTube Music search queries.
Return ONLY valid JSON matching this schema:
{
  "interpretation": "short string describing the vibe and mood",
  "search_queries": ["search query 1", "search query 2", "search query 3"],
  "seed_artists": ["artist 1", "artist 2"],
  "target_minutes": 60,
  "exclude": ["slow", "live"]
}
Rules:
1. Provide 3 to 6 search_queries, each 2 to 6 words, mixing genre, mood, tempo, and era keywords.
2. If seed artists fit the prompt, list them in seed_artists.
3. If the user mentions specific artists, actors, or movie genres (e.g. Hrithik Roshan, A.R. Rahman, 80s synthwave, EDM, lofi), generate specific targeted search queries for their top hits and signature songs.
4. Never output video IDs, YouTube URLs, or markdown fences. Output pure valid JSON only.
"""


def _call_gemini_sync(prompt: str, target_minutes: int, queue_context: list[str] | None, api_key: str) -> dict[str, Any]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={api_key}"

    user_text = f"User Request: {prompt}\nTarget Duration: {target_minutes} minutes."
    if queue_context:
        user_text += f"\nRecent queue tracks context: {', '.join(queue_context[:8])}."

    req_data = {
        "contents": [{"parts": [{"text": user_text}]}],
        "system_instruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "generationConfig": {
            "response_mime_type": "application/json",
            "temperature": 0.7,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(req_data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )

    with urllib.request.urlopen(req, timeout=20) as resp:
        res_json = json.loads(resp.read().decode("utf-8"))
        raw_text = res_json["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(raw_text)


async def curate_music_with_llm(
    prompt: str,
    target_minutes: int = 60,
    current_queue_titles: list[str] | None = None,
) -> dict[str, Any]:
    """Curate YouTube Music search queries using Gemini LLM with structured JSON output and fallback."""
    clean_prompt = prompt.strip()
    api_key = settings.GEMINI_API_KEY.strip()

    if settings.LLM_PROVIDER.lower() in ("gemini", "default") and api_key:
        try:
            logger.info("Calling Gemini LLM for music curation: '%s' (target: %dm)", clean_prompt, target_minutes)
            data = await asyncio.to_thread(_call_gemini_sync, clean_prompt, target_minutes, current_queue_titles, api_key)
            if isinstance(data, dict) and "search_queries" in data and isinstance(data["search_queries"], list):
                if not data.get("interpretation"):
                    data["interpretation"] = f"Curated vibe for '{clean_prompt}' (~{target_minutes} min)"
                data["target_minutes"] = target_minutes
                return data
        except Exception as e:
            logger.warning("Gemini LLM curation request failed: %s. Using structured fallback.", e)

    # Fallback when LLM is unavailable or unconfigured
    fallback_queries = [
        f"{clean_prompt} hits",
        f"best of {clean_prompt}",
        f"{clean_prompt} essentials",
        f"{clean_prompt} party dance",
    ]
    return {
        "interpretation": f"Curated selections for '{clean_prompt}' (~{target_minutes} min)",
        "search_queries": fallback_queries,
        "seed_artists": [],
        "target_minutes": target_minutes,
        "exclude": ["slow", "live"],
    }
