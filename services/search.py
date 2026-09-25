import os
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv

load_dotenv()

# Try importing official TavilyClient
try:
    from tavily import TavilyClient
    TAVILY_AVAILABLE = True
except ImportError:
    TAVILY_AVAILABLE = False
    import requests


# News-specific triggers
NEWS_KEYWORDS = [
    "news",
    "headline",
    "headlines",
    "breaking",
    "what happened",
    "current events",
    "update",
    "updates",
    "latest events",
    "world news",
    "tech news",
    "ai news",
    "crypto news",
    "sports news",
    "market news",
    "war",
    "election",
    "politics",
    "today's news",
    "daily news",
]

# General real-time search triggers
SEARCH_KEYWORDS = [
    "latest",
    "today",
    "current",
    "currently",
    "recent",
    "recently",
    "right now",
    "this week",
    "this month",
    "this year",
    "2025",
    "2026",
    "weather",
    "stock price",
    "who won",
    "score",
    "release date",
    "search for",
    "look up",
    "browse",
    "find out",
]


def get_tavily_api_key() -> Optional[str]:
    """Retrieve the Tavily API key from environment variables."""
    return os.getenv("TAVILY_API_KEY")


def is_memory_or_conversation_query(text: str) -> bool:
    """
    Check if the query is referring to conversation context or personal memory,
    which should NOT be searched on the live web.
    """
    text_lower = text.lower().strip()

    # Explicit web search requests should still use web search
    for web_kw in ["search web", "search online", "search for", "google", "look up online"]:
        if web_kw in text_lower:
            return False

    conversation_indicators = [
        "remember",
        "don't forget",
        "dont forget",
        "keep in mind",
        "what did i say",
        "what did you say",
        "what were we talking about",
        "what did we talk about",
        "earlier you said",
        "earlier i said",
        "in this chat",
        "in our chat",
        "in our conversation",
        "who am i",
        "what is my",
        "what's my",
        "what was my",
        "do you remember",
        "what do you remember",
        "repeat that",
        "save to memory",
        "clear memory",
        "forget that",
    ]

    return any(ind in text_lower for ind in conversation_indicators)


def is_news_query(text: str) -> bool:
    """Determine whether the user query specifically asks for news."""
    text_lower = text.lower()
    for kw in NEWS_KEYWORDS:
        if kw in text_lower:
            return True
    return False


def needs_web_search(text: str) -> bool:
    """
    Determine whether the user query needs web search or live news.
    """
    if is_memory_or_conversation_query(text):
        return False

    text_lower = text.lower()

    if is_news_query(text_lower):
        return True

    for kw in SEARCH_KEYWORDS:
        if kw in text_lower:
            return True

    return False


def search_tavily(
    query: str,
    max_results: int = 5,
    topic: str = "auto",
    days: int = 3
) -> Dict[str, Any]:
    """
    Perform a search query using Tavily API.
    
    Args:
        query: User search query or question
        max_results: Number of search results to return (default: 5)
        topic: 'news', 'general', or 'auto' (detect automatically)
        days: For news topic, look back over last N days (default: 3)
        
    Returns:
        Dict containing success status, sources, answer summary, and formatted context.
    """
    api_key = get_tavily_api_key()

    if not api_key:
        return {
            "success": False,
            "error": "MISSING_KEY",
            "message": "TAVILY_API_KEY is missing from .env file. Please add your Tavily API key to enable live news & web search."
        }

    # Resolve search topic
    if topic == "auto":
        topic = "news" if is_news_query(query) else "general"

    try:
        if TAVILY_AVAILABLE:
            client = TavilyClient(api_key=api_key)
            kwargs = {
                "query": query,
                "max_results": max_results,
                "topic": topic,
                "include_answer": True,
            }
            if topic == "news":
                kwargs["days"] = days

            raw_response = client.search(**kwargs)
        else:
            # Fallback to direct HTTP REST API via requests
            import requests
            payload = {
                "api_key": api_key,
                "query": query,
                "max_results": max_results,
                "topic": topic,
                "include_answer": True,
            }
            if topic == "news":
                payload["days"] = days

            res = requests.post(
                "https://api.tavily.com/search",
                json=payload,
                timeout=15
            )
            res.raise_for_status()
            raw_response = res.json()

        results = raw_response.get("results", [])
        answer_summary = raw_response.get("answer", "")

        sources = []
        context_parts = [
            f"=== REAL-TIME {'NEWS' if topic == 'news' else 'WEB'} SEARCH RESULTS ===",
            f"Query: {query}",
            f"Topic: {topic.upper()}"
        ]

        if answer_summary:
            context_parts.append(f"\nTavily Direct Summary:\n{answer_summary}\n")

        context_parts.append("Articles & Sources:")

        for i, item in enumerate(results, 1):
            title = item.get("title", "Untitled")
            url = item.get("url", "")
            content = item.get("content", "").strip()
            published_date = item.get("published_date", "")

            source_item = {
                "title": title,
                "url": url,
                "content": content,
                "published_date": published_date
            }
            sources.append(source_item)

            snippet = content[:300] + ("..." if len(content) > 300 else "")
            entry = f"{i}. [{title}]({url})"
            if published_date:
                entry += f" (Published: {published_date})"
            entry += f"\n   Snippet: {snippet}\n"
            context_parts.append(entry)

        context_parts.append("================================================")
        formatted_context = "\n".join(context_parts)

        return {
            "success": True,
            "query": query,
            "topic": topic,
            "summary": answer_summary,
            "sources": sources,
            "context": formatted_context,
            "response_time": raw_response.get("response_time")
        }

    except Exception as exc:
        return {
            "success": False,
            "error": "API_ERROR",
            "message": f"Tavily search error: {str(exc)}"
        }
