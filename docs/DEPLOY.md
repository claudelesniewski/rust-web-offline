# Deploying and installing (Chrome only)

Everything here is done in Chrome on github.com (and, for option B,
dash.cloudflare.com). No terminal needed.

## Option A: GitHub Pages (repository must be public)

Free GitHub Pages only serves public repositories.

1. Make the repository public: on github.com open the repository, **Settings**
   → **General** → scroll to **Danger Zone** → **Change visibility** →
   **Make public**.
2. Turn on Pages: **Settings** → **Pages** → **Build and deployment** →
   **Source**: choose **GitHub Actions**.
3. Merge the pull request that added this app (or push any change to `main`).
   Then open the **Actions** tab: the **Deploy to GitHub Pages** workflow runs.
   If it ran before step 2 and failed, open it and click **Re-run all jobs**
   (or choose the workflow and **Run workflow**).
4. When it is green, the site is at
   `https://<your-user-name>.github.io/rust-web-offline/` (also shown on the
   **Settings** → **Pages** page).

## Option B: Cloudflare Pages (repository can stay private)

1. Sign up at dash.cloudflare.com (free).
2. **Workers & Pages** → **Create** → **Pages** → **Connect to Git** →
   authorize GitHub and pick this repository.
3. Build settings: framework preset **None**; build command
   `scripts/build.sh`; build output directory `build/site`. Under
   **Environment variables** add `NODE_VERSION` = `22`.
4. **Save and Deploy**. The site is at `https://<project>.pages.dev/`, and
   redeploys on every push to `main`.

## Install and check offline use

1. Open the site. The first visit downloads about 74 MB (compiler and docs); the top-right shows
   "Saving for offline: … MB" and then **✓ Ready for offline use**. (On GitHub
   Pages the page reloads itself once while setting up; that's expected.)
2. Install it: click the install icon at the right end of the address bar,
   or Chrome menu (⋮) → **Cast, save, and share** → **Install page as app…**.
   It then opens in its own window and appears in the ChromeOS launcher.
3. Test: turn off Wi-Fi, close the app, open it from the launcher, and press
   **Run** on `main.rs` (hello world) and `shapes.rs` (Vec, String, a struct
   with impl blocks). The **Docs** menu works offline too.

Hovering over "Ready for offline use" says whether the browser granted
persistent storage (installed apps normally get it), which stops it evicting
the offline copy and your files when disk space is low. Use **Export all**
now and then to keep a backup of your code.
