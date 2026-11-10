# Landing page

A single self-contained HTML file. No build step, no CDN, no analytics.

Deployed by `.github/workflows/pages.yml` to GitHub Pages.

## Custom domain

- **Domain:** `winnow.borck.education`
- **DNS record:** `CNAME` from `winnow` to `michael-borck.github.io`
- **Cloudflare:** set the record to DNS-only (grey cloud) while GitHub
  provisions the certificate. Proxying can interfere with validation.
- **GitHub settings:** Settings → Pages → Source: GitHub Actions, then set the
  custom domain and enable **Enforce HTTPS**.

The certificate can take up to 24 hours after DNS resolves.
