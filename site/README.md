# Landing page

A single self-contained HTML file. No build step, no CDN, no analytics.

Deployed by `.github/workflows/pages.yml` to GitHub Pages.

## Custom domain

Configured and verified.

- **Domain:** `winnow.borck.education`
- **Live:** <https://winnow.borck.education>
- **DNS:** `CNAME` from `winnow` to `michael-borck.github.io`
- **Cloudflare:** keep the record DNS-only (grey cloud). Proxying can interfere
  with certificate validation.
- **GitHub Pages:** Source is GitHub Actions, the custom domain is set, and
  **Enforce HTTPS** is on.

If the certificate is ever reissued, it can take up to 24 hours after DNS
resolves. The default `https://michael-borck.github.io/winnow/` remains a
fallback.
