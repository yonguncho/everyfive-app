"""
EveryFive v2.0 — WordPress draft post creator
Creates a draft blog post on choiceguidelab.com via REST API
"""
import requests
import json
import base64
import sys

WP_URL = "https://choiceguidelab.com"
WP_USERNAME = "jayden"
WP_APP_PASSWORD = "iiRG3OR6HFqviSxK3L8Ix3PL"

credentials = base64.b64encode(f"{WP_USERNAME}:{WP_APP_PASSWORD}".encode()).decode()
HEADERS = {
    "Authorization": f"Basic {credentials}",
    "Content-Type": "application/json",
}

POST_CONTENT = """<h2>Overview</h2>

<p>EveryFive v2.0 is a major release that transforms the app into a production-ready SM-2 spaced repetition app. Furthermore, it brings a 10,000-word database across six category tracks. As a result, learners can study business English, TOEIC vocabulary, and everyday collocations within a single progressive web app.</p>

<p>This release addresses five critical bugs from v1.x. In addition, it expands the word database nearly fivefold. Moreover, three new features ship in this version: interactive progress charts, achievement badges, and reverse learning mode. Every fix was validated through two rounds of code review before merging.</p>

<h2>What Is an SM-2 Spaced Repetition App?</h2>

<p>SM-2 is a scientifically proven memory algorithm developed by SuperMemo. It schedules each word review at the optimal moment — just before you forget it. Consequently, vocabulary retention improves dramatically compared to traditional flashcard repetition. <a href="https://www.supermemo.com/en/blog/twenty-rules-of-formulating-knowledge" rel="noopener noreferrer" target="_blank">Research from SuperMemo</a> shows that spaced repetition can reduce learning time by up to 70%.</p>

<p>EveryFive implements SM-2 with an ease factor and interval ladder. In addition, it caps the maximum review interval at 365 days. Furthermore, pronunciation quality scores from 0 to 100 adjust future intervals automatically, rewarding accurate speech.</p>

<h2>What's New in v2.0</h2>

<h3>Five Critical Bug Fixes</h3>

<p>First, the Edge Function fallback limit is corrected. The query now uses <code>.limit(count * 3)</code> instead of a hard 300-row ceiling. Therefore, users with higher word-count plans no longer see empty daily queues.</p>

<p>Second, the SM-2 interval is now capped at 365 days. Previously, intervals grew unboundedly after the longest ladder rung was exceeded. As a result, long-term learners no longer encounter silent overflow in their review schedules.</p>

<p>Third, parallel database calls use <code>Promise.allSettled</code> instead of <code>Promise.all</code>. However, when one query fails, remaining data still loads correctly. Consequently, a single Supabase timeout no longer crashes the entire progress page.</p>

<p>Fourth, microphone permission errors are now handled gracefully. When the browser returns a <code>NotAllowedError</code>, the app silently switches to quiet mode and shows a toast notification. Therefore, users no longer encounter a blank screen after denying microphone access.</p>

<p>Fifth, the SAMPLE_WORDS fallback uses a deterministic seed shuffle. Thus, offline users see the same word order on page reload within the same day, instead of a random sequence on every render.</p>

<h3>Word Database: 2,013 → 10,000 Words</h3>

<p>The word database grows from 2,013 entries to 10,000 across six category tracks. Each entry includes a Korean definition, an English definition, a difficulty rating from 1 to 5, and an example sentence with Korean translation. The six new category tracks are:</p>

<ul>
<li><strong>Business English</strong> — 2,000 words covering meetings, emails, negotiation, and presentations</li>
<li><strong>CEFR A2–B2</strong> — 2,000 words based on the Google 10,000 frequency list</li>
<li><strong>TOEIC vocabulary</strong> — 1,500 words covering all major TOEIC test domains</li>
<li><strong>Collocations</strong> — 1,000 common verb-noun and adjective-noun pairings</li>
<li><strong>Industry terms</strong> — 1,500 words across IT, finance, and marketing tracks</li>
<li><strong>Everyday expressions</strong> — 1,000 idioms and conversational phrases</li>
</ul>

<h3>Three New Features</h3>

<p>The progress page now displays a 7-day activity bar chart and a 7-day review forecast line chart. Therefore, learners can visualize their study patterns and upcoming review load at a glance. Both charts update automatically after each session ends.</p>

<p>Achievement badges reward consistent study habits. For example, 7-day and 30-day streaks each unlock a unique badge. Similarly, word count milestones of 100 words and 500 words trigger badge notifications immediately after the session completes.</p>

<p>Reverse learning mode shows a Korean hint and asks the learner to type the English word. On the other hand, standard mode shows the English word and tests pronunciation. Learners can toggle between modes by tapping the mode button during any session.</p>

<h2>Key Features</h2>

<ul>
<li>SM-2 spaced repetition with ease factor and 365-day maximum interval cap</li>
<li>10,000 words across six learning category tracks</li>
<li>Web Speech API pronunciation scoring from 0 to 100</li>
<li>Recharts progress visualization — 7-day activity chart and review forecast</li>
<li>Achievement badge system for streak and word count milestones</li>
<li>Reverse learning mode (Korean → English typing challenge)</li>
<li>Offline-capable PWA with IndexedDB sync queue</li>
<li>Supabase Auth, Row-Level Security, and Edge Functions</li>
</ul>

<h2>Installation</h2>

<pre><code># Clone the repository
git clone https://github.com/yonguncho/everyfive-app-v2-0-srs
cd everyfive-app-v2-0-srs

# Install dependencies
npm install

# Configure environment variables
cp .env.local.example .env.local
# Add your Supabase URL, anon key, and Lemon Squeezy key to .env.local

# Apply all database migrations
supabase db push

# Start the development server
npm run dev</code></pre>

<p>The app requires Node.js 20 or later. Furthermore, a Supabase project with the included migration files is needed. Run <code>supabase db push</code> to apply all 17 migrations in correct order automatically.</p>

<h2>Usage</h2>

<p>After signing in, complete the onboarding level test to set your CEFR level. The app then selects words that match your difficulty range. Moreover, due words from previous sessions always appear first. Therefore, SM-2 review timing is respected even when new words are available in the pool.</p>

<p>Each session shows 5 to 30 words, depending on your subscription plan. However, the free tier includes five words per day so new users can experience the full learning flow. Each word progresses through meaning, pronunciation, scenario, and quiz steps. Similarly, reverse mode presents the same word as a Korean-to-English typing challenge.</p>

<p>For an overview of the SM-2 daily queue architecture that v2.0 builds on, see the <a href="https://choiceguidelab.com/everyfive-v1-3-sm2-spaced-repetition-daily-vacancy-queue/">EveryFive v1.3 post</a>. That post covers the daily queue design and SRS algorithm foundations in detail.</p>

<h2>GitHub</h2>

<p>The full source code, database migration files, and word seeding scripts are available on GitHub. In addition, the repository includes Playwright end-to-end tests and a Supabase Edge Function for daily queue generation.</p>

<pre><code>https://github.com/yonguncho/everyfive-app-v2-0-srs</code></pre>"""


FOCUS_KW = "SM-2 spaced repetition app"
SEO_TITLE = "EveryFive v2.0 — SM-2 Spaced Repetition App | 10,000 Words"
META_DESC = "EveryFive v2.0 is a production-ready SM-2 spaced repetition app with 10,000 words, progress charts, achievement badges, and a reverse learning mode."

TAG_NAMES = [
    "Spaced Repetition", "SRS", "Vocabulary Learning", "English Learning",
    "Next.js", "Supabase", "PWA", "Language App", "Open Source"
]

CATEGORIES = [708, 541]


def get_or_create_tag(name: str) -> int:
    r = requests.get(f"{WP_URL}/wp-json/wp/v2/tags", headers=HEADERS, params={"search": name})
    existing = [t for t in r.json() if t["name"].lower() == name.lower()]
    if existing:
        return existing[0]["id"]
    r = requests.post(f"{WP_URL}/wp-json/wp/v2/tags", headers=HEADERS, json={"name": name})
    return r.json()["id"]


def main():
    print("Resolving tags...")
    tag_ids = [get_or_create_tag(t) for t in TAG_NAMES]
    print(f"Tag IDs: {tag_ids}")

    post_data = {
        "title": "[New Tool] EveryFive v2.0 — SM-2 Spaced Repetition App with 10,000 Words",
        "content": POST_CONTENT,
        "status": "draft",
        "slug": "everyfive-v2-0-sm2-spaced-repetition-app-10000-words",
        "categories": CATEGORIES,
        "tags": tag_ids,
        "meta": {
            "_yoast_wpseo_focuskw": FOCUS_KW,
            "_yoast_wpseo_title": SEO_TITLE,
            "_yoast_wpseo_metadesc": META_DESC,
        },
    }

    print("Creating draft post...")
    r = requests.post(f"{WP_URL}/wp-json/wp/v2/posts", headers=HEADERS, json=post_data)
    if r.status_code not in (200, 201):
        print(f"ERROR {r.status_code}: {r.text[:500]}")
        sys.exit(1)

    post = r.json()
    post_id = post["id"]
    edit_url = f"{WP_URL}/wp-admin/post.php?post={post_id}&action=edit"
    preview_url = f"{WP_URL}/?p={post_id}"
    print(f"\n✓ Draft created — ID: {post_id}")
    print(f"  Edit:    {edit_url}")
    print(f"  Preview: {preview_url}")

    # Save URL to state file
    with open(r"C:\AI_WORKPLACE\state\blog_post_url.txt", "w") as f:
        f.write(f"Post ID: {post_id}\n")
        f.write(f"Edit URL: {edit_url}\n")
        f.write(f"Preview URL: {preview_url}\n")
        f.write(f"Title: {post['title']['rendered']}\n")
        f.write(f"Focus KW: {FOCUS_KW}\n")
        f.write(f"SEO Title: {SEO_TITLE}\n")
        f.write(f"Meta Desc: {META_DESC}\n")

    print("\nSaved to C:\\AI_WORKPLACE\\state\\blog_post_url.txt")
    return post_id


if __name__ == "__main__":
    main()
