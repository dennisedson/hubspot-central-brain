# Setting this up — start here

Written for someone who has never used Obsidian. If you already know it, `README.md` has the
conventions and you can skip this.

## What Obsidian actually is

A text editor for a folder of `.md` files on your disk. That is the whole thing.

- **A "vault" is just a folder.** Obsidian does not store anything in a cloud or a database.
- **Every note is a plain markdown file.** You could open them in TextEdit or VS Code.
- **The vault's name is the folder's name.** There is no separate setting for it.

That last point matters more than it sounds — see step 3.

Because it is only files on disk, Cowork can read and write them directly. No API, no
integration, no auth. That is exactly why the strategy doc puts Obsidian here.

---

## 1. Install Obsidian

Download from [obsidian.md](https://obsidian.md) and install it. It is free for personal use.

## 2. Get this folder onto the machine

The vault template lives in the `hubspot-central-brain` repo.

```bash
git clone https://github.com/dennisedson/hubspot-central-brain.git
cd hubspot-central-brain
```

If you already have the repo there, `git pull` instead.

## 3. Copy it to where the vault will live — and mind the folder name

**The folder you copy into becomes the vault name.** The prompts in here build links like
`obsidian://open?vault=Dev-%20Central-Brain&…`, so the folder must be named exactly:

```
Dev- Central-Brain
```

Note the hyphen right after `Dev` and the space before `Central`. Copy it somewhere sensible —
your home folder or Documents, **not** inside the git repo:

```bash
cp -R vault-template/ ~/"Dev- Central-Brain"
```

The quotes are needed because of the space.

> **If you want a different name**, that is fine — but change it in two files afterwards
> (`prompts/README.md` and `prompts/changelog-from-linear.md`), remembering that a space becomes
> `%20`. There is a test in the repo that checks this: `npx vitest run src/app/__tests__/vault-template.test.ts`

## 4. Open it in Obsidian

1. Launch Obsidian
2. **Open folder as vault**
3. Choose the `Dev- Central-Brain` folder you just created
4. Trust the author when prompted — it is your own folder

Obsidian creates a hidden `.obsidian/` folder inside it for your settings. That is normal, and it
is yours — nothing in this template touches it.

You will see the folders from `README.md`: `daily/`, `meetings/`, `content/`, and so on. They look
empty because they are. The `.gitkeep` files inside them start with a dot, so Obsidian hides them.
They exist only so the empty folders survive being copied out of git.

## 5. Turn on Templates

The files in `templates/` do nothing until you tell Obsidian where they are.

1. **Settings** (gear, bottom left) → **Core plugins**
2. Turn on **Templates**
3. Go to **Settings → Templates** and set **Template folder location** to `templates`

Now: create a new note, then use the command palette (`Cmd+P`) → **Templates: Insert template** →
pick one. It drops the whole structure in, frontmatter included.

## 6. Understand the `---` block at the top

Every template starts with something like this:

```yaml
---
hubspot_object: content_piece
hubspot_id: ""
hubspot_portal: 51869810
content_type: blog_post
---
```

That is **frontmatter** — structured data about the note, which Obsidian shows as "properties" and
Cowork can read and filter on. It must be the very first thing in the file, fenced by `---` above
and below.

The important pair is `hubspot_id` and `hubspot_portal`. Together they say *which HubSpot record
this note is about*. You fill `hubspot_id` in when the record is created; leave it as `""` until
then.

Full explanation of every field is in `README.md` under "The linkage contract".

## 7. Connect the folder in Cowork

In Cowork, add `~/Dev- Central-Brain` as a connected folder. Cowork can then read and write these
notes directly.

Then open `prompts/README.md` — those are ready-made instructions to paste into Cowork. Start with
`prompts/enterpret-sync.md`.

> **The prompts are unverified.** The HubSpot ids and property names in them are checked against
> the live portal, but nobody has watched Cowork run them. Expect to edit them. When one is wrong,
> fix the file so the next run starts better.

---

## Things that confuse everyone at first

**`[[Double brackets]]` make a link.** `[[webhook-retries]]` links to a note of that name anywhere
in the vault. That is how a draft points at the Enterpret theme behind it.

**There is no save button.** Obsidian writes to disk as you type.

**Folders are a convenience, not a rule.** Links work across the whole vault regardless of where a
note sits. Do not agonise over which folder something belongs in.

**Dotfiles are invisible.** `.gitkeep` and `.obsidian/` exist on disk but Obsidian hides them.

**This vault is not in git.** You copied the template *out* of the repo. Your actual notes are
just files on your machine — back them up however you back up anything else.

## If a link does not open

`obsidian://` links only work when the vault name matches exactly, encoded. Given a vault named
`Dev- Central-Brain`, a correct link is:

```
obsidian://open?vault=Dev-%20Central-Brain&file=content%2Fmy-note.md
```

`%20` is the space. `%2F` is the `/` between folder and filename. A raw space produces a link that
silently does nothing — no error, no dialog. If a link from HubSpot does not open, this is almost
always why.
