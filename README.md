# Chada Tech Launch Tracker

A one-page web app for the Chada Tech launch, 17 to 29 November 2026. It lists every team member's daily deliverables. Anyone with the passcode can mark a task **To do**, **Done** or **Blocked** in one tap. Everyone with the link sees the change live.

- **By day:** each day's tasks, grouped by person, with a filter for one person.
- **Blocked:** every stuck task in one list, with the reason.
- **Progress:** done, blocked and overdue counts for each person and the whole team.
- **Copy summary:** a ✅ / ⛔ / ⬜ list of the day, ready to paste into the team WhatsApp group.

It's a static site on GitHub Pages, and the statuses are saved in a free Supabase database.

## Setup (once, about 10 minutes)

### 1. Create the database
1. Sign in at [supabase.com](https://supabase.com) and click **New project**. Name it `chada-launch-tracker` and pick the region nearest Nigeria (for example *West EU (Ireland)*).
2. Open **SQL Editor**, then **New query**, and paste in all of [`supabase/setup.sql`](supabase/setup.sql).
3. On the last line, change `CHANGE-ME-chada-2026` to your own editor passcode, then click **Run**.

### 2. Connect the site
1. In Supabase, open **Project Settings**, then **API** (or click **Connect**), and copy:
   - the **Project URL**
   - the **anon** or **publishable** key
2. Put both in [`config.js`](config.js) and commit.

Both values are safe on a public site. The database only accepts status changes that come with the passcode.

### 3. Turn on GitHub Pages
In the repo, go to **Settings**, then **Pages**, and set **Source: Deploy from a branch**, **Branch: main**, **Folder: / (root)**.

The site goes live at `https://okiejoedev.github.io/chada-launch-tracker/`.

## Using it
- **The team:** opens the link to view. No login needed.
- **Ope (or anyone updating):** taps a status once, enters their name and the passcode, and that phone stays unlocked. After that, each change is one tap. Tap **Lock** to stop editing on a shared device.
- **Changing the passcode:** edit the last statement of `setup.sql` and run only that statement in the Supabase SQL Editor. Everyone who's unlocked will be asked for the new passcode the next time they make a change.

## Changing the tasks
Tasks live in [`data/tasks.json`](data/tasks.json). Each task has an `id` (`t001`…`t999`), a `day`, a `label`, a person (`p`) and the text (`t`). Keep existing IDs as they are, because statuses are saved against them. After editing, run:

```
python3 build.py
```

That rebuilds `index.html` and `app.js`. Then commit.

## Files
| File | What it is |
|---|---|
| `index.html`, `app.js` | The built site (don't edit directly; edit `src/`) |
| `src/` | Page and app source |
| `data/tasks.json` | The 133 deliverables |
| `config.js` | Supabase URL and key |
| `supabase/setup.sql` | Database tables, passcode check and live updates |
| `vendor/supabase.js` | Supabase client v2.119.0 (MIT), kept here so the site doesn't depend on a CDN |
