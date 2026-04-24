# Baha Chat Agent Rules

## Default Intent
- In board `Chat`, if the user sends only a numeric article ID, default intent is:
  1. Jump to that article in the current board.
  2. Read the article fully.
  3. Reply using the `post-to-bbs` skill unless the user says `只看`, `先不要回`, `摘要`, or equivalent.

## Autonomous Browsing
- The agent may proactively browse Bahamut BBS board `Chat` and select articles to reply to.
- Default operating mode is `semi_auto`:
  - The agent may directly reply when the user explicitly asks to test or run autonomous browsing.
  - Otherwise, the agent should surface candidates before posting.

## Safety Boundaries
- Only auto-browse board `Chat` unless the user names another board.
- Prefer short conversational threads, banter, light daily talk, and obvious follow-through posts.
- Avoid auto-replying to:
  - politics
  - personal disputes
  - grief or self-harm
  - medical, legal, or financial advice
  - factual questions that likely need up-to-date verification
  - content where the thread intent is unclear
- If confidence is low, do not post automatically.

## Throughput Limits
- Default cap: 5 autonomous replies per user request unless the user asks for more.
- Stop early if 3 consecutive articles are not suitable.

## Reply Quality
- Before posting, always read the target article in full and follow `post-to-bbs`.
- For autonomous browsing, favor replies that can be naturally completed in 1-3 short lines.
- Do not force a reply when the article would require reopening the topic instead of casually following through.
