#!/usr/bin/env python3
"""
AI Monitor - RSS Feed Updater
Downloads and parses open AI RSS/Atom feeds, compiles and sorts news items,
and writes the result to news.json for GitHub Pages and fast static loading.
No third-party dependencies; uses only Python standard library.
"""

import os
import re
import ssl
import json
import html
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

IMPORTANT_KEYWORDS = [
    r"\bgpt\b", r"\bclaude\b", r"\bgemini\b", r"\brelease\b",
    r"\bopen-source\b", r"\bopensource\b", r"\bmodel\b", r"\bmodels\b",
    r"\bbreakthrough\b", r"\bdeepseek\b", r"\bo1\b", r"\bo3\b",
    r"\breasoning\b", r"\bagent\b", r"\bagents\b", r"\bllama\b",
    r"\bmistral\b", r"\bweights\b", r"\bbenchmark\b"
]
KEYWORD_PATTERN = re.compile("|".join(IMPORTANT_KEYWORDS), re.IGNORECASE)

FEEDS = [
    {
        "source": "OpenAI",
        "url": "https://openai.com/news/rss.xml",
        "type": "rss"
    },
    {
        "source": "TechCrunch",
        "url": "https://techcrunch.com/category/artificial-intelligence/feed/",
        "type": "rss"
    },
    {
        "source": "The Verge",
        "url": "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
        "type": "atom"
    },
    {
        "source": "Hugging Face",
        "url": "https://huggingface.co/blog/feed.xml",
        "type": "atom"
    },
    {
        "source": "Hacker News",
        "url": "https://hn.algolia.com/api/v1/search_by_date?query=AI+OR+LLM+OR+GPT+OR+Claude+OR+Gemini&tags=story&hitsPerPage=20",
        "type": "hn_json"
    },
    {
        "source": "MIT Tech Review",
        "url": "https://www.technologyreview.com/topic/artificial-intelligence/feed/",
        "type": "rss"
    }
]

def clean_text(raw_html: str, max_len: int = 240) -> str:
    """Strips HTML tags, decodes entities, and cleans whitespace."""
    if not raw_html:
        return ""
    text = re.sub(r"<[^>]+>", " ", raw_html)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_len:
        text = text[:max_len].rsplit(" ", 1)[0] + "..."
    return text

def parse_date_to_iso(date_str: str) -> str:
    """Normalizes various RSS/Atom date formats to ISO 8601 UTC."""
    if not date_str:
        return datetime.now(timezone.utc).isoformat()
    date_str = date_str.strip()
    # Try RFC 2822
    try:
        dt = parsedate_to_datetime(date_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        pass

    # Try ISO 8601 variants
    iso_clean = date_str.replace("Z", "+00:00")
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d"
    ):
        try:
            dt = datetime.strptime(iso_clean, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except ValueError:
            continue

    return datetime.now(timezone.utc).isoformat()

def check_is_important(title: str, summary: str) -> bool:
    content = f"{title} {summary}"
    return bool(KEYWORD_PATTERN.search(content))

def fetch_feed(feed_info: dict) -> list:
    source_name = feed_info["source"]
    url = feed_info["url"]
    items = []

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
    }

    try:
        ctx = ssl.create_default_context()
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=12, context=ctx) as response:
            content = response.read()
    except Exception as e:
        print(f"[{source_name}] Warning: failed to fetch feed ({e})")
        return []

    if feed_info.get("type") == "hn_json":
        try:
            data = json.loads(content.decode("utf-8"))
            for hit in data.get("hits", []):
                title = clean_text(hit.get("title") or "")
                link = hit.get("url") or f"https://news.ycombinator.com/item?id={hit.get('objectID')}"
                created_at = hit.get("created_at") or datetime.now(timezone.utc).isoformat()
                author = hit.get("author", "hn")
                points = hit.get("points") or 0
                summary = f"Обговорення на Hacker News ({points} балів, автор: {author})"
                if not title:
                    continue
                is_imp = check_is_important(title, summary)
                items.append({
                    "title": title,
                    "link": link,
                    "source": source_name,
                    "published": parse_date_to_iso(created_at),
                    "summary": summary,
                    "is_important": is_imp
                })
            print(f"[{source_name}] Loaded {len(items)} items")
            return items
        except Exception as e:
            print(f"[{source_name}] Error parsing HN json ({e})")
            return []

    try:
        root = ET.fromstring(content)
    except Exception as e:
        print(f"[{source_name}] Warning: XML parsing error ({e})")
        return []

    # Strip XML namespace tags for easy querying
    for elem in root.iter():
        if "}" in elem.tag:
            elem.tag = elem.tag.split("}", 1)[1]

    # Process RSS 2.0 / 1.0 items
    for item in root.findall(".//item"):
        title_el = item.find("title")
        link_el = item.find("link")
        desc_el = item.find("description")
        if desc_el is None:
            desc_el = item.find("encoded")
        date_el = item.find("pubDate")
        if date_el is None:
            date_el = item.find("date")

        title = clean_text(title_el.text if title_el is not None else "", max_len=300)
        link = (link_el.text or "").strip() if link_el is not None else ""
        summary = clean_text(desc_el.text if desc_el is not None else "")
        published = parse_date_to_iso(date_el.text if date_el is not None else "")

        if not title or not link:
            continue

        if feed_info.get("filter_ai"):
            # Only include Hacker News items related to AI
            if not check_is_important(title, summary) and not re.search(r"\b(ai|llm|ml|neural|agi)\b", title, re.I):
                continue

        is_imp = check_is_important(title, summary)
        items.append({
            "title": title,
            "link": link,
            "source": source_name,
            "published": published,
            "summary": summary,
            "is_important": is_imp
        })

    # Process Atom entries
    for entry in root.findall(".//entry"):
        title_el = entry.find("title")
        link_el = entry.find("link")
        summary_el = entry.find("summary")
        if summary_el is None:
            summary_el = entry.find("content")
        date_el = entry.find("published")
        if date_el is None:
            date_el = entry.find("updated")

        title = clean_text(title_el.text if title_el is not None else "", max_len=300)

        link = ""
        if link_el is not None:
            link = link_el.attrib.get("href") or link_el.text or ""
        link = link.strip()

        summary = clean_text(summary_el.text if summary_el is not None else "")
        published = parse_date_to_iso(date_el.text if date_el is not None else "")

        if not title or not link:
            continue

        is_imp = check_is_important(title, summary)
        items.append({
            "title": title,
            "link": link,
            "source": source_name,
            "published": published,
            "summary": summary,
            "is_important": is_imp
        })

    print(f"[{source_name}] Loaded {len(items)} items")
    return items

def main():
    print("AI Monitor: Starting RSS feed compilation...")
    all_news = []
    seen_links = set()

    for feed in FEEDS:
        items = fetch_feed(feed)
        for item in items:
            key = item["link"].rstrip("/")
            if key not in seen_links:
                seen_links.add(key)
                all_news.append(item)

    # Sort descending by published date
    all_news.sort(key=lambda x: x.get("published", ""), reverse=True)

    output = {
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "total_count": len(all_news),
        "sources": [f["source"] for f in FEEDS],
        "items": all_news[:60]  # Keep top 60 freshest items
    }

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    output_path = os.path.join(base_dir, "news.json")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Successfully saved {len(output['items'])} news items to {output_path}")

if __name__ == "__main__":
    main()
